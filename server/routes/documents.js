import express from 'express';
import PDFDocument from 'pdfkit';
import { protect } from '../middleware/auth.js';
import Order from '../models/Order.js';
import ASN from '../models/ASN.js';
import Return from '../models/Return.js';
import Company from '../models/Company.js';
import Counter from '../models/Counter.js';
import ActivityLog from '../models/ActivityLog.js';

async function logActivity(req, action, module, detail) {
  try {
    await ActivityLog.create({
      logId: 'LOG-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
      user: req.user?.email || req.user?.name || 'system',
      role: req.user?.role || 'unknown',
      action, module, detail,
      ip: req.ip || req.headers['x-forwarded-for'] || '',
      timestamp: new Date(),
      company: req.user?.company,
    });
  } catch (_) {}
}

const router = express.Router();
router.use(protect);

// ─────────────────────────────────────────────────────────
//   PDF Drawing Helpers
// ─────────────────────────────────────────────────────────
const BRAND_BLUE = '#1e40af';
const GRAY      = '#6b7280';
const LIGHT_BG  = '#f8fafc';
const BORDER    = '#e2e8f0';

function safeStr(v) {
  if (v === undefined || v === null || v === '') return '—';
  return String(v);
}

function drawHeader(doc, company, docType, docNumber, dnDate) {
  // Left: company branding
  doc.rect(0, 0, 595, 90).fill(BRAND_BLUE);
  doc.fillColor('#ffffff').fontSize(22).font('Helvetica-Bold').text('House Logistic', 50, 28);
  doc.fillColor('rgba(255,255,255,0.7)').fontSize(9).font('Helvetica').text(safeStr(company?.name), 50, 55);

  // Right: document type & number
  doc.fillColor('#ffffff').fontSize(18).font('Helvetica-Bold').text(docType, 0, 28, { align: 'right', width: 545 });
  doc.fillColor('rgba(255,255,255,0.85)').fontSize(10).font('Helvetica')
    .text(`#${safeStr(docNumber)}`, 0, 53, { align: 'right', width: 545 })
    .text(`Date: ${dnDate || new Date().toLocaleDateString('en-GB')}`, 0, 67, { align: 'right', width: 545 });

  doc.fillColor('#000000');
  doc.y = 110;
}

function drawSection(doc, label, value, x = 50) {
  const y = doc.y;
  doc.fontSize(7).font('Helvetica-Bold').fillColor(GRAY).text(label.toUpperCase(), x, y, { lineBreak: false });
  doc.fontSize(10).font('Helvetica').fillColor('#111827').text(safeStr(value), x, y + 10);
  doc.y += 28;
}

function drawSectionInline(doc, label, value, x, y, width = 150) {
  doc.fontSize(7).font('Helvetica-Bold').fillColor(GRAY).text(label.toUpperCase(), x, y, { width, lineBreak: false });
  doc.fontSize(10).font('Helvetica').fillColor('#111827').text(safeStr(value), x, y + 10, { width });
}

function drawSectionHeader(doc, title) {
  const y = doc.y + 8;
  doc.rect(50, y, 495, 20).fill('#1e3a5f');
  doc.fontSize(9).font('Helvetica-Bold').fillColor('#ffffff').text(title.toUpperCase(), 58, y + 5);
  doc.fillColor('#000000');
  doc.y = y + 28;
}

function drawTable(doc, headers, rows) {
  const totalWidth = headers.reduce((s, h) => s + h.width, 0);
  const startX = 50;
  let y = doc.y + 6;

  // Header row
  doc.rect(startX, y, totalWidth, 22).fill('#1e40af');
  let x = startX;
  headers.forEach(h => {
    doc.fontSize(8).font('Helvetica-Bold').fillColor('#ffffff')
      .text(h.label, x + 4, y + 6, { width: h.width - 8, align: h.align || 'left' });
    x += h.width;
  });
  y += 22;

  // Data rows
  rows.forEach((row, i) => {
    const rowH = 20;
    if (i % 2 === 0) {
      doc.rect(startX, y, totalWidth, rowH).fill(LIGHT_BG);
    }
    doc.rect(startX, y, totalWidth, rowH).strokeColor(BORDER).lineWidth(0.5).stroke();
    x = startX;
    headers.forEach((h, hi) => {
      doc.fontSize(9).font('Helvetica').fillColor('#111827')
        .text(safeStr(row[hi]), x + 4, y + 5, { width: h.width - 8, align: h.align || 'left' });
      x += h.width;
    });
    y += rowH;
  });

  doc.y = y + 12;
}

function drawDivider(doc) {
  doc.moveTo(50, doc.y + 4).lineTo(545, doc.y + 4).strokeColor(BORDER).lineWidth(1).stroke();
  doc.y += 16;
}

function formatAddress(addr) {
  if (!addr) return '—';
  const parts = [
    addr.street && addr.number ? `${addr.street}, ${addr.number}` : (addr.street || addr.number || null),
    addr.postcode && addr.city ? `${addr.postcode} ${addr.city}` : (addr.postcode || addr.city || null),
    addr.region || null,
    addr.country || null,
  ].filter(Boolean);
  return parts.length > 0 ? parts.join('\n') : '—';
}

// ─────────────────────────────────────────────────────────
//   Sequential Number Helper
// ─────────────────────────────────────────────────────────
async function getNextDeliveryNoteNumber(company) {
  const counter = await Counter.findOneAndUpdate(
    { _id: 'delivery_note', company },
    { $inc: { seq: 1 } },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
  return `DN-${String(counter.seq).padStart(6, '0')}`;
}

// ─────────────────────────────────────────────────────────
//   GET /delivery-note/:orderId  — Generate & Download PDF
// ─────────────────────────────────────────────────────────
router.get('/delivery-note/:orderId', async (req, res, next) => {
  try {
    if (!req.user?.company) return res.status(403).json({ message: 'Company context required' });

    const order = await Order.findOne({ _id: req.params.orderId, company: req.user.company });
    if (!order) return res.status(404).json({ message: 'Order not found' });

    let company = null;
    try {
      company = await Company.findById(req.user.company);
    } catch (_) {
      // Non-fatal — we'll use fallbacks
    }

    // Assign a sequential DN number if not already assigned
    let dnNumber = order.delivery_note_number;
    const isFirstGeneration = !dnNumber;
    if (!dnNumber) {
      dnNumber = await getNextDeliveryNoteNumber(req.user.company);
      order.delivery_note_number = dnNumber;
      order.delivery_note_generated_at = new Date();
      await order.save();
    }

    // Activity log
    await logActivity(
      req,
      isFirstGeneration ? 'GENERATE_DELIVERY_NOTE' : 'REPRINT_DELIVERY_NOTE',
      'Documents',
      `${isFirstGeneration ? 'Generated' : 'Reprinted'} delivery note ${dnNumber} for order ${order.orderId} (${order.customer})`
    );

    const dnDate = order.delivery_note_generated_at
      ? new Date(order.delivery_note_generated_at).toLocaleDateString('en-GB')
      : new Date().toLocaleDateString('en-GB');

    // ── Build PDF ──────────────────────────────────────
    const doc = new PDFDocument({ margin: 0, size: 'A4', bufferPages: true });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="DeliveryNote-${dnNumber}.pdf"`);
    doc.pipe(res);

    // Header
    drawHeader(doc, company, 'DELIVERY NOTE', dnNumber, dnDate);
    doc.y += 10;

    const isB2B = order.order_type === 'B2B';

    // ── BUYER / RECIPIENT SECTION ──────────────────────
    drawSectionHeader(doc, isB2B ? 'Buyer Information' : 'Customer Information');

    if (isB2B) {
      const leftX = 50, rightX = 310;
      const startY = doc.y;
      drawSectionInline(doc, 'Company Name', order.company_name, leftX, startY, 240);
      drawSectionInline(doc, 'VAT Number (CIF/NIF)', order.vat_number, rightX, startY, 230);
      doc.y = startY + 36;
      const r2Y = doc.y;
      drawSectionInline(doc, 'Contact Person', order.contact_person, leftX, r2Y, 240);
      drawSectionInline(doc, 'Contact Phone', order.contact_phone, rightX, r2Y, 230);
      doc.y = r2Y + 36;
    } else {
      const startY = doc.y;
      drawSectionInline(doc, 'Customer', order.customer, 50, startY, 240);
      drawSectionInline(doc, 'Email', order.email, 310, startY, 230);
      doc.y = startY + 36;
    }

    // Delivery address
    const addrY = doc.y;
    drawSectionInline(doc, 'Delivery Address', formatAddress(order.delivery_address), 50, addrY, 300);
    const orderDateStr = order.date ? new Date(order.date).toLocaleDateString('en-GB') : '—';
    drawSectionInline(doc, 'Order Date', orderDateStr, 360, addrY, 175);
    doc.y = addrY + 48;

    drawDivider(doc);

    // ── ORDER INFORMATION ─────────────────────────────
    drawSectionHeader(doc, 'Order Details');
    const ordY = doc.y;
    drawSectionInline(doc, 'Order ID', order.orderId, 50, ordY, 150);
    drawSectionInline(doc, 'Order Type', isB2B ? 'B2B — Wholesale' : 'B2C — E-commerce', 210, ordY, 170);
    drawSectionInline(doc, 'Status', String(order.status || '').toUpperCase(), 390, ordY, 150);
    doc.y = ordY + 36;

    if (isB2B) {
      const b2bY = doc.y;
      drawSectionInline(doc, 'PO Reference', order.po_reference, 50, b2bY, 150);
      drawSectionInline(doc, 'Delivery Terms', order.delivery_terms || '—', 210, b2bY, 150);
      const agreeDate = order.agreed_delivery_date ? new Date(order.agreed_delivery_date).toLocaleDateString('en-GB') : '—';
      drawSectionInline(doc, 'Agreed Delivery Date', agreeDate, 370, b2bY, 170);
      doc.y = b2bY + 36;
    }

    drawDivider(doc);

    // ── PRODUCT LINES TABLE ────────────────────────────
    drawSectionHeader(doc, 'Product Lines');

    const lines = order.product_lines || [];
    if (lines.length > 0) {
      drawTable(doc,
        [
          { label: 'SKU',          width: 90,  align: 'left'  },
          { label: 'Product',      width: 195, align: 'left'  },
          { label: 'Qty',          width: 55,  align: 'center'},
          { label: 'Unit Price',   width: 80,  align: 'right' },
          { label: 'Line Total',   width: 75,  align: 'right' },
        ],
        lines.map(l => [
          l.sku,
          l.product_name,
          l.qty,
          `€${(l.unit_price || 0).toFixed(2)}`,
          `€${(l.line_total || 0).toFixed(2)}`,
        ])
      );
    } else {
      // Fallback for legacy orders without product_lines
      drawTable(doc,
        [
          { label: 'Order ID', width: 150 }, { label: 'Items', width: 100 },
          { label: 'Channel', width: 120 }, { label: 'Total', width: 125 },
        ],
        [[order.orderId, order.items ?? 0, order.channel || '—', `€${(order.total || 0).toFixed(2)}`]]
      );
    }

    // ── FINANCIAL TOTALS ──────────────────────────────
    const totalsX = 350;
    let totY = doc.y + 4;
    const subtotal = order.subtotal || order.total || 0;
    const vatRate  = order.vat_rate || 21;
    const vatAmt   = order.vat_amount || 0;
    const grandTot = order.total || subtotal;

    doc.rect(totalsX - 5, totY - 3, 200, 72).fill('#f1f5f9').stroke();

    doc.fontSize(9).font('Helvetica').fillColor('#374151')
      .text('Subtotal:', totalsX, totY, { width: 90 })
      .text(`€${subtotal.toFixed(2)}`, totalsX + 90, totY, { width: 100, align: 'right' });
    totY += 18;

    doc.text(`VAT (${vatRate}%):`, totalsX, totY, { width: 90 })
      .text(`€${vatAmt.toFixed(2)}`, totalsX + 90, totY, { width: 100, align: 'right' });
    totY += 18;

    doc.rect(totalsX - 5, totY - 3, 200, 22).fill(BRAND_BLUE).stroke();
    doc.fontSize(11).font('Helvetica-Bold').fillColor('#ffffff')
      .text('TOTAL:', totalsX, totY + 2, { width: 90 })
      .text(`€${grandTot.toFixed(2)}`, totalsX + 90, totY + 2, { width: 100, align: 'right' });

    doc.fillColor('#000000');
    doc.y = totY + 36;
    drawDivider(doc);

    // ── B2B SHIPMENT INFORMATION ──────────────────────
    if (isB2B && (order.pallet_count || order.shipment_weight)) {
      drawSectionHeader(doc, 'Shipment Information');
      const shipY = doc.y;
      drawSectionInline(doc, 'Number of Pallets', order.pallet_count, 50, shipY, 150);
      drawSectionInline(doc, 'Shipment Weight', order.shipment_weight, 210, shipY, 150);
      drawSectionInline(doc, 'Delivery Terms', order.delivery_terms, 370, shipY, 170);
      doc.y = shipY + 44;
      drawDivider(doc);
    }

    // ── B2C SHIPPING INFO ─────────────────────────────
    if (!isB2B && (order.tracking_number || order.package_weight)) {
      drawSectionHeader(doc, 'Shipping Information');
      const shipY = doc.y;
      drawSectionInline(doc, 'Tracking Number', order.tracking_number, 50, shipY, 150);
      drawSectionInline(doc, 'Package Weight', order.package_weight, 210, shipY, 150);
      drawSectionInline(doc, 'Dimensions', order.package_dimensions, 370, shipY, 170);
      doc.y = shipY + 44;
      drawDivider(doc);
    }

    // ── NOTES ────────────────────────────────────────
    if (order.notes) {
      drawSectionHeader(doc, 'Notes');
      doc.fontSize(9).font('Helvetica').fillColor('#374151').text(order.notes, 50, doc.y, { width: 495 });
      doc.y += 20;
      drawDivider(doc);
    }

    // ── SIGNATURE BLOCK ───────────────────────────────
    const sigY = doc.y + 10;
    doc.rect(50, sigY, 220, 60).strokeColor(BORDER).lineWidth(1).stroke();
    doc.rect(305, sigY, 220, 60).strokeColor(BORDER).lineWidth(1).stroke();
    doc.fontSize(8).fillColor(GRAY)
      .text('Sender Signature', 50, sigY + 44, { width: 220, align: 'center' })
      .text('Driver / Recipient Signature', 305, sigY + 44, { width: 220, align: 'center' });

    doc.y = sigY + 80;

    // ── FOOTER ────────────────────────────────────────
    doc.fontSize(7).fillColor(GRAY)
      .text(`Generated by Elvis WMS — House Logistic · ${dnNumber} · ${dnDate}`, 50, doc.y, { align: 'center', width: 495 });

    doc.end();
  } catch (err) {
    console.error('Delivery note generation error:', err);
    next(err);
  }
});

// ─────────────────────────────────────────────────────────
//   GET /goods-received/:asnId
// ─────────────────────────────────────────────────────────
router.get('/goods-received/:asnId', async (req, res, next) => {
  try {
    if (!req.user?.company) return res.status(403).json({ message: 'Company context required' });
    const asn = await ASN.findOne({ _id: req.params.asnId, company: req.user.company });
    if (!asn) return res.status(404).json({ message: 'ASN not found' });
    let company = null;
    try { company = await Company.findById(req.user.company); } catch (_) {}

    const doc = new PDFDocument({ margin: 0, size: 'A4' });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="GoodsReceived-${asn.asnId}.pdf"`);
    doc.pipe(res);

    drawHeader(doc, company, 'GOODS RECEIVED NOTE', asn.asnId);
    doc.y += 10;
    drawSectionHeader(doc, 'Supplier Information');

    const r1Y = doc.y;
    drawSectionInline(doc, 'Supplier', asn.supplier, 50, r1Y, 230);
    drawSectionInline(doc, 'Status', String(asn.status || '').toUpperCase(), 310, r1Y, 230);
    doc.y = r1Y + 36;
    const r2Y = doc.y;
    drawSectionInline(doc, 'Warehouse', asn.warehouse, 50, r2Y, 230);
    const expDate = asn.expectedDate ? new Date(asn.expectedDate).toLocaleDateString('en-GB') : '—';
    drawSectionInline(doc, 'Expected Arrival', expDate, 310, r2Y, 230);
    doc.y = r2Y + 44;

    drawDivider(doc);
    drawSectionHeader(doc, 'Items Received');

    if (asn.items && asn.items.length > 0) {
      drawTable(doc,
        [
          { label: 'SKU',          width: 100 },
          { label: 'Description',  width: 145 },
          { label: 'Expected Qty', width: 90,  align: 'center' },
          { label: 'Received Qty', width: 90,  align: 'center' },
          { label: 'QC Status',    width: 70,  align: 'center' },
        ],
        asn.items.map(i => [i.sku, i.name || i.description || '—', i.expected_qty, i.received_qty ?? '—', i.qc_status || 'pending'])
      );
    } else {
      doc.y += 8;
      doc.fontSize(10).font('Helvetica').fillColor(GRAY).text('No items recorded for this ASN.', 50, doc.y);
      doc.y += 20;
    }

    drawDivider(doc);
    const sigY = doc.y + 10;
    doc.rect(50, sigY, 220, 60).strokeColor(BORDER).lineWidth(1).stroke();
    doc.rect(305, sigY, 220, 60).strokeColor(BORDER).lineWidth(1).stroke();
    doc.fontSize(8).fillColor(GRAY)
      .text('Warehouse Signature', 50, sigY + 44, { width: 220, align: 'center' })
      .text('Supplier Signature', 305, sigY + 44, { width: 220, align: 'center' });

    doc.end();
  } catch (err) {
    console.error('Goods received note error:', err);
    next(err);
  }
});

// ─────────────────────────────────────────────────────────
//   GET /return-note/:returnId
// ─────────────────────────────────────────────────────────
router.get('/return-note/:returnId', async (req, res, next) => {
  try {
    if (!req.user?.company) return res.status(403).json({ message: 'Company context required' });
    const ret = await Return.findOne({ _id: req.params.returnId, company: req.user.company });
    if (!ret) return res.status(404).json({ message: 'Return not found' });
    let company = null;
    try { company = await Company.findById(req.user.company); } catch (_) {}

    const doc = new PDFDocument({ margin: 0, size: 'A4' });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="ReturnNote-${ret.returnId}.pdf"`);
    doc.pipe(res);

    drawHeader(doc, company, 'RETURN NOTE', ret.returnId);
    doc.y += 10;
    drawSectionHeader(doc, 'Return Information');

    const r1Y = doc.y;
    drawSectionInline(doc, 'Order Reference', ret.orderId || ret.order, 50, r1Y, 230);
    drawSectionInline(doc, 'Customer', ret.customer, 310, r1Y, 230);
    doc.y = r1Y + 36;
    const r2Y = doc.y;
    drawSectionInline(doc, 'Return Reason', ret.reason, 50, r2Y, 230);
    drawSectionInline(doc, 'Status', String(ret.status || '').toUpperCase(), 310, r2Y, 230);
    doc.y = r2Y + 36;
    const r3Y = doc.y;
    const retDate = ret.createdAt ? new Date(ret.createdAt).toLocaleDateString('en-GB') : '—';
    drawSectionInline(doc, 'Date', retDate, 50, r3Y, 230);
    doc.y = r3Y + 44;

    drawDivider(doc);
    drawSectionHeader(doc, 'Items Returned');

    if (ret.items_details && ret.items_details.length > 0) {
      drawTable(doc,
        [
          { label: 'SKU',       width: 120 },
          { label: 'Qty',       width: 70,  align: 'center' },
          { label: 'QC Status', width: 120 },
          { label: 'Reason',    width: 185 },
        ],
        ret.items_details.map(i => [i.sku, i.qty, i.qc_status, i.reason || '—'])
      );
    } else {
      doc.fontSize(10).font('Helvetica').fillColor(GRAY).text('No item details recorded.', 50, doc.y);
      doc.y += 20;
    }

    drawDivider(doc);
    doc.fontSize(7).fillColor(GRAY).text('Generated by Elvis WMS — House Logistic', 50, doc.y, { align: 'center', width: 495 });

    doc.end();
  } catch (err) {
    console.error('Return note error:', err);
    next(err);
  }
});

export default router;
