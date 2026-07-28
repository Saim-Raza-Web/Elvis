import express from 'express';
import PDFDocument from 'pdfkit';
import { protect } from '../middleware/auth.js';
import Order from '../models/Order.js';
import ASN from '../models/ASN.js';
import Return from '../models/Return.js';
import Company from '../models/Company.js';

const router = express.Router();
router.use(protect);

function drawHeader(doc, company, docType, docNumber) {
  doc.fontSize(20).font('Helvetica-Bold').text('Elvis WMS', 50, 50);
  doc.fontSize(10).font('Helvetica').fillColor('#666').text(company?.name || 'Warehouse', 50, 75);
  doc.fillColor('#000').fontSize(16).font('Helvetica-Bold').text(docType, 350, 50, { align: 'right' });
  doc.fontSize(10).font('Helvetica').text(`#${docNumber}`, 350, 72, { align: 'right' });
  doc.text(`Date: ${new Date().toLocaleDateString()}`, 350, 86, { align: 'right' });
  doc.moveTo(50, 110).lineTo(550, 110).strokeColor('#e5e7eb').lineWidth(1).stroke();
  doc.y = 130;
}

function drawSection(doc, label, value, indent = 50) {
  doc.fontSize(9).font('Helvetica-Bold').fillColor('#6b7280').text(label.toUpperCase(), indent, doc.y);
  doc.fontSize(11).font('Helvetica').fillColor('#111').text(value || '—', indent, doc.y + 2);
  doc.y += 20;
}

function drawTable(doc, headers, rows) {
  const colWidths = headers.map(h => h.width);
  const startX = 50;
  let x = startX;
  let y = doc.y + 10;

  // Header row
  doc.rect(startX, y, colWidths.reduce((a, w) => a + w, 0), 22).fillColor('#f3f4f6').fill();
  x = startX;
  headers.forEach(h => {
    doc.fontSize(9).font('Helvetica-Bold').fillColor('#374151').text(h.label, x + 5, y + 6, { width: h.width - 10 });
    x += h.width;
  });
  y += 22;

  // Data rows
  rows.forEach((row, i) => {
    if (i % 2 === 0) {
      doc.rect(startX, y, colWidths.reduce((a, w) => a + w, 0), 20).fillColor('#f9fafb').fill();
    }
    x = startX;
    headers.forEach((h, hi) => {
      doc.fontSize(9).font('Helvetica').fillColor('#111827').text(String(row[hi] ?? '—'), x + 5, y + 5, { width: h.width - 10 });
      x += h.width;
    });
    y += 20;
  });

  doc.y = y + 15;
}

// GET delivery note for an order
router.get('/delivery-note/:orderId', async (req, res, next) => {
  try {
    if (!req.user?.company) return res.status(403).json({ message: 'Company context required' });
    const order = await Order.findOne({ _id: req.params.orderId, company: req.user.company });
    if (!order) return res.status(404).json({ message: 'Order not found' });
    const company = await Company.findById(req.user.company);

    const doc = new PDFDocument({ margin: 50 });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="DeliveryNote-${order.orderId}.pdf"`);
    doc.pipe(res);

    drawHeader(doc, company, 'DELIVERY NOTE', order.orderId);

    doc.y += 5;
    doc.fontSize(11).font('Helvetica-Bold').fillColor('#111').text('Ship To:', 50, doc.y);
    doc.y += 15;
    drawSection(doc, 'Customer', order.customer);
    drawSection(doc, 'Email', order.email);
    drawSection(doc, 'Warehouse', order.warehouse);
    drawSection(doc, 'Order Date', order.date ? new Date(order.date).toLocaleDateString() : '—');
    drawSection(doc, 'Order Type', order.order_type || 'B2C');
    drawSection(doc, 'Status', order.status);

    doc.y += 10;
    doc.moveTo(50, doc.y).lineTo(550, doc.y).strokeColor('#e5e7eb').lineWidth(1).stroke();
    doc.y += 10;

    drawTable(doc,
      [{ label: 'Order ID', width: 150 }, { label: 'Items', width: 100 }, { label: 'Total', width: 150 }, { label: 'Channel', width: 150 }],
      [[order.orderId, order.items ?? 0, `€${(order.total ?? 0).toFixed(2)}`, order.channel || '—']]
    );

    if (order.notes) {
      doc.y += 10;
      doc.fontSize(9).font('Helvetica-Bold').fillColor('#6b7280').text('NOTES');
      doc.fontSize(10).font('Helvetica').fillColor('#111').text(order.notes);
    }

    doc.y += 30;
    doc.fontSize(8).fillColor('#9ca3af').text('This document was generated automatically by Elvis WMS. No signature required.', { align: 'center' });

    doc.end();
  } catch (err) { next(err); }
});

// GET goods received note for an ASN
router.get('/goods-received/:asnId', async (req, res, next) => {
  try {
    if (!req.user?.company) return res.status(403).json({ message: 'Company context required' });
    const asn = await ASN.findOne({ _id: req.params.asnId, company: req.user.company });
    if (!asn) return res.status(404).json({ message: 'ASN not found' });
    const company = await Company.findById(req.user.company);

    const doc = new PDFDocument({ margin: 50 });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="GoodsReceived-${asn.asnId}.pdf"`);
    doc.pipe(res);

    drawHeader(doc, company, 'GOODS RECEIVED NOTE', asn.asnId);

    doc.y += 5;
    drawSection(doc, 'Supplier', asn.supplier);
    drawSection(doc, 'Owner / Client', asn.owner || '—');
    drawSection(doc, 'Warehouse', asn.warehouse);
    drawSection(doc, 'Expected Arrival', asn.expectedDate ? new Date(asn.expectedDate).toLocaleDateString() : '—');
    drawSection(doc, 'Status', asn.status);

    doc.y += 10;
    doc.moveTo(50, doc.y).lineTo(550, doc.y).strokeColor('#e5e7eb').lineWidth(1).stroke();
    doc.y += 10;

    if (asn.items && asn.items.length > 0) {
      drawTable(doc,
        [
          { label: 'SKU', width: 100 },
          { label: 'Description', width: 150 },
          { label: 'Expected Qty', width: 100 },
          { label: 'Received Qty', width: 100 },
          { label: 'QC Status', width: 100 }
        ],
        asn.items.map(i => [i.sku, i.name || i.description || '—', i.expected_qty, i.received_qty ?? '—', i.qc_status || 'pending'])
      );
    }

    doc.y += 30;
    doc.fontSize(8).fillColor('#9ca3af').text('This document was generated automatically by Elvis WMS.', { align: 'center' });
    doc.end();
  } catch (err) { next(err); }
});

// GET returns document
router.get('/return-note/:returnId', async (req, res, next) => {
  try {
    if (!req.user?.company) return res.status(403).json({ message: 'Company context required' });
    const ret = await Return.findOne({ _id: req.params.returnId, company: req.user.company });
    if (!ret) return res.status(404).json({ message: 'Return not found' });
    const company = await Company.findById(req.user.company);

    const doc = new PDFDocument({ margin: 50 });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="ReturnNote-${ret.returnId}.pdf"`);
    doc.pipe(res);

    drawHeader(doc, company, 'RETURN NOTE', ret.returnId);

    drawSection(doc, 'Order Reference', ret.orderId);
    drawSection(doc, 'Customer', ret.customer);
    drawSection(doc, 'Return Reason', ret.reason);
    drawSection(doc, 'Status', ret.status);
    drawSection(doc, 'Date', ret.createdAt ? new Date(ret.createdAt).toLocaleDateString() : '—');

    doc.y += 10;
    doc.moveTo(50, doc.y).lineTo(550, doc.y).strokeColor('#e5e7eb').lineWidth(1).stroke();
    doc.y += 10;

    if (ret.items_details && ret.items_details.length > 0) {
      drawTable(doc,
        [{ label: 'SKU', width: 120 }, { label: 'Qty', width: 80 }, { label: 'QC Status', width: 120 }, { label: 'Reason', width: 180 }],
        ret.items_details.map(i => [i.sku, i.qty, i.qc_status, i.reason || '—'])
      );
    }

    doc.y += 30;
    doc.fontSize(8).fillColor('#9ca3af').text('This document was generated automatically by Elvis WMS.', { align: 'center' });
    doc.end();
  } catch (err) { next(err); }
});

export default router;
