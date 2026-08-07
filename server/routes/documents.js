import express from 'express';
import PDFDocument from 'pdfkit';
import fs from 'fs';
import { protect } from '../middleware/auth.js';
import Order from '../models/Order.js';
import ASN from '../models/ASN.js';
import Document from '../models/Document.js';
import Return from '../models/Return.js';
import Company from '../models/Company.js';
import Counter from '../models/Counter.js';
import ActivityLog from '../models/ActivityLog.js';

const router = express.Router();
router.use(protect);

// ── Activity Log Helper ─────────────────────────────────────────
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

// ── Color Palette (Matching Client Mockup 3.1 & 3.2) ───────────
const DARK_BLUE = '#1a4971';   // Banner and table header dark blue
const LIGHT_BLUE = '#edf4f9';  // Box header / background light blue
const BORDER_BLUE = '#b0c4de'; // Box border line color
const LIGHT_GRAY = '#f8fafc';
const BORDER_GRAY = '#cbd5e1';
const YELLOW_BG = '#fffbeb';
const YELLOW_BORDER = '#fde047';
const YELLOW_HEADER = '#d97706';

function safeStr(v, fallback = '—') {
  if (v === undefined || v === null || v === '') return fallback;
  return String(v);
}

async function getLogoBuffer(logoStr) {
  if (!logoStr || typeof logoStr !== 'string') return null;
  try {
    if (logoStr.startsWith('data:image/')) {
      const base64Data = logoStr.split(',')[1];
      return Buffer.from(base64Data, 'base64');
    } else if (logoStr.startsWith('http://') || logoStr.startsWith('https://')) {
      const res = await fetch(logoStr);
      if (res.ok) {
        const arrayBuf = await res.arrayBuffer();
        return Buffer.from(arrayBuf);
      }
    } else if (fs.existsSync(logoStr)) {
      return fs.readFileSync(logoStr);
    }
  } catch (_) {
    return null;
  }
  return null;
}

function formatAddressInline(addr) {
  if (!addr) return '—';
  const parts = [
    addr.street && addr.number ? `${addr.street}, ${addr.number}` : (addr.street || addr.number || null),
    addr.postcode && addr.city ? `${addr.postcode} ${addr.city}` : (addr.postcode || addr.city || null),
    addr.region || null,
    addr.country || null,
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(', ') : '—';
}

function formatAddressMultiline(addr) {
  if (!addr) return '—';
  const line1 = addr.street && addr.number ? `${addr.street}, ${addr.number}` : (addr.street || addr.number || '');
  const line2 = addr.postcode && addr.city ? `${addr.postcode} ${addr.city}` : (addr.postcode || addr.city || '');
  const line3 = [addr.region, addr.country].filter(Boolean).join(', ');
  return [line1, line2, line3].filter(Boolean).join('\n') || '—';
}

// ── Draw Professional Header (Tenant Branding) ───────────────
async function drawBannerHeader(doc, company) {
  const compName = company?.tradingName || company?.name || 'House Logistic S.L.';
  const compAddr = company?.address ? formatAddressInline(company.address) : 'Polígono Industrial Norte, Nave 7 · 28001 Madrid';
  const compVat = company?.vatNumber ? `CIF: ${company.vatNumber}` : 'CIF: B-12345678';
  const compPhone = company?.phone ? `Tel: ${company.phone}` : 'Tel: +34 91 000 0000';
  const compEmail = company?.email ? company.email : 'logistics@houselogistic.es';

  // Dark Blue Banner Background (Full width 595, height 85)
  doc.rect(0, 0, 595, 85).fill(DARK_BLUE);

  // Logo Area (Left: 30, 15, width: 120, height: 55)
  const logoBuffer = await getLogoBuffer(company?.logo);
  doc.rect(30, 15, 120, 55).fill('#ffffff');

  if (logoBuffer) {
    try {
      doc.image(logoBuffer, 32, 17, { fit: [116, 51], align: 'center', valign: 'center' });
    } catch (_) {
      doc.fontSize(11).font('Helvetica-Bold').fillColor(DARK_BLUE)
         .text(compName, 32, 33, { width: 116, align: 'center' });
    }
  } else {
    doc.fontSize(11).font('Helvetica-Bold').fillColor(DARK_BLUE)
       .text(compName, 32, 33, { width: 116, align: 'center' });
  }

  // Company Information Text (Center)
  doc.fontSize(13).font('Helvetica-Bold').fillColor('#ffffff').text(compName, 165, 18);
  doc.fontSize(8).font('Helvetica').fillColor('rgba(255,255,255,0.85)')
     .text(compAddr, 165, 35)
     .text(`${compVat}   ·   ${compPhone}   ·   ${compEmail}`, 165, 48);

  if (company?.website) {
    doc.text(company.website, 165, 60);
  }

  // Title Right (DELIVERY NOTE / ALBARÁN DE ENTREGA)
  doc.fontSize(16).font('Helvetica-Bold').fillColor('#ffffff')
     .text('DELIVERY NOTE', 0, 22, { align: 'right', width: 565 });
  doc.fontSize(9).font('Helvetica').fillColor('rgba(255,255,255,0.85)')
     .text('ALBARÁN DE ENTREGA', 0, 42, { align: 'right', width: 565 });

  doc.fillColor('#000000');
  doc.y = 98;
}

// ── Draw Document Meta Card (Top Right) ────────────────────────
function drawMetaCard(doc, dnNumber, orderId, dateStr, x = 360, y = 98, width = 205) {
  doc.rect(x, y, width, 78).fillAndStroke(LIGHT_BLUE, BORDER_BLUE);
  
  let currentY = y + 8;
  doc.fontSize(8).font('Helvetica').fillColor('#475569');

  doc.text('Nº Albarán:', x + 10, currentY);
  doc.font('Helvetica-Bold').fillColor('#0f172a').text(dnNumber, x + 70, currentY);
  currentY += 20;

  doc.font('Helvetica').fillColor('#475569').text('Pedido:', x + 10, currentY);
  doc.font('Helvetica-Bold').fillColor('#0f172a').text(orderId, x + 70, currentY);
  currentY += 20;

  doc.font('Helvetica').fillColor('#475569').text('Fecha:', x + 10, currentY);
  doc.font('Helvetica-Bold').fillColor('#0f172a').text(dateStr, x + 70, currentY);
}

// ── Draw Info Box Component ───────────────────────────────────
function drawInfoBox(doc, title, lines, x, y, width, height) {
  // Title Bar
  doc.rect(x, y, width, 18).fill(DARK_BLUE);
  doc.fontSize(8).font('Helvetica-Bold').fillColor('#ffffff').text(title.toUpperCase(), x + 8, y + 5);

  // Content Box
  doc.rect(x, y + 18, width, height - 18).fillAndStroke(LIGHT_GRAY, BORDER_GRAY);
  
  let textY = y + 23;
  lines.forEach(line => {
    if (line.bold) doc.font('Helvetica-Bold'); else doc.font('Helvetica');
    if (line.color) doc.fillColor(line.color); else doc.fillColor('#1e293b');
    const fSize = line.fontSize || 8;
    doc.fontSize(fSize);
    doc.text(line.text, x + 8, textY, { width: width - 16 });
    const textH = doc.heightOfString(line.text, { width: width - 16, fontSize: fSize });
    textY += textH + 2;
  });

  doc.fillColor('#000000');
}

// ── Draw Product Table (Matching Client Mockups) ───────────────
function drawProductTable(doc, lines, subtotal, vatRate, vatAmt, grandTotal, startY) {
  const startX = 30;
  const colWidths = { num: 25, sku: 95, desc: 235, qty: 55, price: 65, vat: 60 };
  const totalWidth = 535;

  let y = startY;

  // Header Row (Dark Blue Bar)
  doc.rect(startX, y, totalWidth, 20).fill(DARK_BLUE);
  doc.fontSize(8).font('Helvetica-Bold').fillColor('#ffffff');

  doc.text('#', startX + 5, y + 6, { width: colWidths.num, align: 'left' });
  doc.text('SKU', startX + colWidths.num + 5, y + 6, { width: colWidths.sku, align: 'left' });
  doc.text('Producto / Descripción', startX + colWidths.num + colWidths.sku + 5, y + 6, { width: colWidths.desc, align: 'left' });
  doc.text('Cantidad', startX + colWidths.num + colWidths.sku + colWidths.desc, y + 6, { width: colWidths.qty, align: 'center' });
  doc.text('Precio unit.', startX + colWidths.num + colWidths.sku + colWidths.desc + colWidths.qty, y + 6, { width: colWidths.price, align: 'right' });
  doc.text('IVA', startX + colWidths.num + colWidths.sku + colWidths.desc + colWidths.qty + colWidths.price, y + 6, { width: colWidths.vat, align: 'right' });

  y += 20;

  // Rows
  lines.forEach((l, idx) => {
    const bg = idx % 2 === 0 ? '#ffffff' : LIGHT_GRAY;
    doc.rect(startX, y, totalWidth, 20).fillAndStroke(bg, '#e2e8f0');

    doc.fontSize(8).font('Helvetica').fillColor('#1e293b');
    doc.text(String(idx + 1), startX + 5, y + 6, { width: colWidths.num });
    doc.text(safeStr(l.sku), startX + colWidths.num + 5, y + 6, { width: colWidths.sku - 5 });
    doc.text(safeStr(l.product_name), startX + colWidths.num + colWidths.sku + 5, y + 6, { width: colWidths.desc - 5 });
    doc.text(`${l.qty} uds`, startX + colWidths.num + colWidths.sku + colWidths.desc, y + 6, { width: colWidths.qty, align: 'center' });
    doc.text(`€${(l.unit_price || 0).toFixed(2)}`, startX + colWidths.num + colWidths.sku + colWidths.desc + colWidths.qty, y + 6, { width: colWidths.price, align: 'right' });
    doc.text(`${vatRate}%`, startX + colWidths.num + colWidths.sku + colWidths.desc + colWidths.qty + colWidths.price, y + 6, { width: colWidths.vat, align: 'right' });

    y += 20;
  });

  y += 6;

  // Totals Box (Right Aligned)
  const totalsX = 340;
  const totalsWidth = 225;

  doc.fontSize(8).font('Helvetica').fillColor('#475569');
  doc.text('Subtotal:', totalsX, y, { width: 100, align: 'right' });
  doc.font('Helvetica-Bold').fillColor('#0f172a').text(`€${subtotal.toFixed(2)}`, totalsX + 110, y, { width: 110, align: 'right' });
  y += 14;

  doc.font('Helvetica').fillColor('#475569').text(`IVA (${vatRate}%):`, totalsX, y, { width: 100, align: 'right' });
  doc.font('Helvetica-Bold').fillColor('#0f172a').text(`€${vatAmt.toFixed(2)}`, totalsX + 110, y, { width: 110, align: 'right' });
  y += 16;

  // Grand Total Dark Blue Banner Box
  doc.rect(totalsX, y, totalsWidth, 24).fill(DARK_BLUE);
  doc.fontSize(11).font('Helvetica-Bold').fillColor('#ffffff');
  doc.text('TOTAL:', totalsX + 10, y + 6, { width: 80, align: 'left' });
  doc.text(`€${grandTotal.toFixed(2)}`, totalsX + 90, y + 6, { width: 125, align: 'right' });

  return y + 36;
}

// ── Draw Signatures Section (3 Columns: Transportista, Expedidor, Destinatario) ──
function drawSignaturesSection(doc, startY) {
  const y = startY;
  const colW = 170;
  const colGap = 125;

  // Box 1: Transportista
  doc.rect(30, y, colW, 75).fillAndStroke('#ffffff', BORDER_GRAY);
  doc.fontSize(7).font('Helvetica-Bold').fillColor('#475569').text('TRANSPORTISTA', 36, y + 6);
  doc.fontSize(7).font('Helvetica').fillColor('#64748b');
  doc.text('Empresa: ________________________', 36, y + 18);
  doc.text('Matrícula: _______________________', 36, y + 30);
  doc.text('Conductor: ______________________', 36, y + 42);
  doc.text('Hora recogida: __________________', 36, y + 54);

  // Box 2: Firma Expedidor
  doc.rect(212, y, colW, 75).fillAndStroke('#ffffff', BORDER_GRAY);
  doc.fontSize(7).font('Helvetica-Bold').fillColor('#475569').text('FIRMA EXPEDIDOR', 218, y + 6, { width: colW - 12, align: 'center' });

  // Box 3: Firma Destinatario
  doc.rect(395, y, colW, 75).fillAndStroke('#ffffff', BORDER_GRAY);
  doc.fontSize(7).font('Helvetica-Bold').fillColor('#475569').text('FIRMA DESTINATARIO', 401, y + 6, { width: colW - 12, align: 'center' });

  return y + 85;
}

// ── Draw Observaciones / Notes Box ─────────────────────────────
function drawNotesSection(doc, notes, startY) {
  if (!notes || !notes.trim()) return startY;

  const y = startY;
  doc.rect(30, y, 535, 45).fillAndStroke(YELLOW_BG, YELLOW_BORDER);
  doc.fontSize(8).font('Helvetica-Bold').fillColor(YELLOW_HEADER).text('OBSERVACIONES:', 38, y + 6);
  doc.fontSize(8).font('Helvetica').fillColor('#334155').text(notes, 38, y + 18, { width: 519 });

  return y + 52;
}

// ── Draw Footer Disclaimer ─────────────────────────────────────
function drawFooterDisclaimer(doc, dnNumber, dateStr) {
  doc.fontSize(7).font('Helvetica').fillColor('#64748b')
     .text('Este documento no es una factura. / This document is not an invoice.', 30, 805, { align: 'center', width: 535 });
  doc.fontSize(6).font('Helvetica').fillColor('#94a3b8')
     .text(`Generated by Elvis WMS · ${dnNumber} · ${dateStr}`, 30, 817, { align: 'center', width: 535 });
}

// ── Sequential Number Helper ───────────────────────────────────
async function getNextDeliveryNoteNumber(company) {
  const counter = await Counter.findOneAndUpdate(
    { _id: 'delivery_note', company },
    { $inc: { seq: 1 } },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
  return `DN-2026-${String(counter.seq).padStart(6, '0')}`;
}

// ───────────────────────────────────────────────────────────────
//   GET /  — List all documents for the company
// ───────────────────────────────────────────────────────────────
router.get('/', async (req, res, next) => {
  try {
    if (!req.user?.company) return res.status(403).json({ message: 'Company context required' });
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 25;
    const skip = (page - 1) * limit;
    const filter = { company: req.user.company };
    if (req.query.type) filter.type = req.query.type;
    if (req.query.status) filter.status = req.query.status;
    const total = await Document.countDocuments(filter);
    const data = await Document.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean();
    res.json({ data, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } });
  } catch (err) {
    next(err);
  }
});

// ───────────────────────────────────────────────────────────────
//   GET /delivery-note/:orderId  — Generate & Download PDF
// ───────────────────────────────────────────────────────────────
router.get('/delivery-note/:orderId', async (req, res, next) => {
  try {
    if (!req.user?.company) return res.status(403).json({ message: 'Company context required' });

    const order = await Order.findOne({ _id: req.params.orderId, company: req.user.company });
    if (!order) return res.status(404).json({ message: 'Order not found' });

    let company = null;
    try {
      company = await Company.findById(req.user.company);
    } catch (_) {}

    // Assign sequential DN number if not already assigned
    let dnNumber = order.delivery_note_number;
    const isFirstGen = !dnNumber;
    if (!dnNumber) {
      dnNumber = await getNextDeliveryNoteNumber(req.user.company);
      order.delivery_note_number = dnNumber;
      order.delivery_note_generated_at = new Date();
      await order.save();
    }

    await logActivity(
      req,
      isFirstGen ? 'GENERATE_DELIVERY_NOTE' : 'REPRINT_DELIVERY_NOTE',
      'Documents',
      `${isFirstGen ? 'Generated' : 'Reprinted'} delivery note ${dnNumber} for order ${order.orderId}`
    );

    const dnDate = order.delivery_note_generated_at
      ? new Date(order.delivery_note_generated_at).toLocaleDateString('en-GB')
      : new Date().toLocaleDateString('en-GB');

    // Build PDF
    const doc = new PDFDocument({ margin: 0, size: 'A4', bufferPages: true });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="DeliveryNote-${dnNumber}.pdf"`);
    doc.pipe(res);

    // 1. Banner Header
    await drawBannerHeader(doc, company);

    // 2. Meta Card (Nº Albarán, Pedido, Fecha)
    drawMetaCard(doc, dnNumber, order.orderId, dnDate);

    const isB2B = order.order_type === 'B2B';

    if (isB2B) {
      // ── B2B Layout ──
      // EXPEDIDOR / FROM Box (Left)
      const compName = company?.legalName || company?.name || 'House Logistic S.L.';
      const compAddrLines = company?.address ? formatAddressMultiline(company.address) : 'Polígono Industrial Norte, Nave 7\n28001 Madrid, Spain';
      const compVat = company?.vatNumber ? `CIF: ${company.vatNumber}` : 'CIF: B-12345678';

      drawInfoBox(doc, 'EXPEDIDOR / FROM', [
        { text: compName, bold: true },
        { text: compAddrLines },
        { text: compVat, color: '#475569' }
      ], 30, 98, 315, 85);

      // DESTINATARIO / SHIP TO Box
      const destLines = [
        { text: safeStr(order.company_name || order.customer), bold: true },
        { text: `Contact: ${safeStr(order.contact_person)}   Tel: ${safeStr(order.contact_phone)}` },
        { text: formatAddressMultiline(order.delivery_address) },
      ];
      if (order.vat_number) destLines.push({ text: `CIF/NIF: ${order.vat_number}`, color: '#475569' });

      drawInfoBox(doc, 'DESTINATARIO / SHIP TO', destLines, 30, 190, 535, 85);

      // DATOS DEL ENVÍO Box
      const poRef = safeStr(order.po_reference);
      const incoterms = order.delivery_terms ? `${order.delivery_terms} (opcional)` : '—';
      const agreeDate = order.agreed_delivery_date ? new Date(order.agreed_delivery_date).toLocaleDateString('en-GB') : '—';
      const pallets = safeStr(order.pallet_count, '—');
      const weight = safeStr(order.shipment_weight, '—');
      const warehouse = safeStr(order.warehouse, 'MIA');

      drawInfoBox(doc, 'DATOS DEL ENVÍO', [
        { text: `Nº Palés: ${pallets}                                     Almacén origen: ${warehouse}` },
        { text: `Peso total: ${weight}                                  Fecha acordada: ${agreeDate}` },
        { text: `Referencia PO: ${poRef}                        Condiciones: ${incoterms}` }
      ], 30, 282, 535, 55);

    } else {
      // ── B2C Layout ──
      // DESTINATARIO / SHIP TO Box (Left)
      drawInfoBox(doc, 'DESTINATARIO / SHIP TO', [
        { text: safeStr(order.customer), bold: true },
        { text: safeStr(order.email) },
        { text: formatAddressMultiline(order.delivery_address) }
      ], 30, 98, 315, 85);

      // DATOS DEL ENVÍO Box
      const channel = safeStr(order.channel, 'Web');
      const warehouse = safeStr(order.warehouse, 'MIA');
      const dateStr = order.date ? new Date(order.date).toLocaleDateString('en-GB') : '—';

      drawInfoBox(doc, 'DATOS DEL ENVÍO', [
        { text: `Canal: ${channel}   ·   Almacén: ${warehouse}` },
        { text: `Fecha estimada entrega: ${dateStr}` }
      ], 30, 190, 535, 50);
    }

    // 3. Product Lines Table & Totals
    const tableStartY = isB2B ? 344 : 248;
    const lines = (order.product_lines && order.product_lines.length > 0) ? order.product_lines : [
      { sku: 'DEFAULT-1', product_name: 'Product Item', qty: order.items || 1, unit_price: order.total || 0, line_total: order.total || 0 }
    ];
    const subtotal = order.subtotal || order.total || 0;
    const vatRate = order.vat_rate || 21;
    const vatAmt = order.vat_amount || 0;
    const grandTotal = order.total || subtotal;

    const afterTableY = drawProductTable(doc, lines, subtotal, vatRate, vatAmt, grandTotal, tableStartY);

    // 4. Signatures
    const afterSigY = drawSignaturesSection(doc, Math.max(afterTableY, 630));

    // 5. Notes / Observaciones
    drawNotesSection(doc, order.notes, afterSigY + 5);

    // 6. Footer Disclaimer
    drawFooterDisclaimer(doc, dnNumber, dnDate);

    doc.end();
  } catch (err) {
    console.error('Delivery note generation error:', err);
    next(err);
  }
});

// ───────────────────────────────────────────────────────────────
//   GET /preview-delivery-note — Tenant Sample Preview
// ───────────────────────────────────────────────────────────────
router.get('/preview-delivery-note', async (req, res, next) => {
  try {
    if (!req.user?.company) return res.status(403).json({ message: 'Company context required' });

    let company = await Company.findById(req.user.company);

    const sampleDnNumber = 'DN-2026-000001';
    const sampleDate = new Date().toLocaleDateString('en-GB');

    const doc = new PDFDocument({ margin: 0, size: 'A4', bufferPages: true });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'inline; filename="DeliveryNote-Preview.pdf"');
    doc.pipe(res);

    await drawBannerHeader(doc, company);
    drawMetaCard(doc, sampleDnNumber, 'ORD-SAMPLE', sampleDate);

    const compName = company?.legalName || company?.name || 'House Logistic S.L.';
    const compAddr = company?.address ? formatAddressMultiline(company.address) : 'Polígono Industrial Norte, Nave 7\n28001 Madrid, Spain';
    const compVat = company?.vatNumber ? `CIF: ${company.vatNumber}` : 'CIF: B-12345678';

    drawInfoBox(doc, 'EXPEDIDOR / FROM', [
      { text: compName, bold: true },
      { text: compAddr },
      { text: compVat, color: '#475569' }
    ], 30, 98, 315, 85);

    drawInfoBox(doc, 'DESTINATARIO / SHIP TO', [
      { text: 'Sample Logistics Client S.L.', bold: true },
      { text: 'Contact: Carlos Mendoza   Tel: +34 600 111 222' },
      { text: 'Avenida de la Ilustración 42\n28034 Madrid, Spain' },
      { text: 'CIF/NIF: B-99887766', color: '#475569' }
    ], 30, 190, 535, 85);

    drawInfoBox(doc, 'DATOS DEL ENVÍO', [
      { text: 'Nº Palés: 2                                     Almacén origen: MIA' },
      { text: 'Peso total: 500 kg                                  Fecha acordada: 15/08/2026' },
      { text: 'Referencia PO: PO-SAMPLE-01                     Condiciones: DDP (opcional)' }
    ], 30, 282, 535, 55);

    const sampleLines = [
      { sku: 'SKU-001', product_name: 'Wireless Industrial Sensor', qty: 10, unit_price: 150.00, line_total: 1500.00 },
      { sku: 'SKU-002', product_name: 'Battery Pack Module 48V', qty: 2, unit_price: 450.00, line_total: 900.00 },
    ];

    const afterTableY = drawProductTable(doc, sampleLines, 2400.00, 21, 504.00, 2904.00, 344);
    const afterSigY = drawSignaturesSection(doc, Math.max(afterTableY, 630));
    drawNotesSection(doc, 'Sample Branding Preview Note — Handle with care.', afterSigY + 5);
    drawFooterDisclaimer(doc, sampleDnNumber, sampleDate);

    doc.end();
  } catch (err) {
    console.error('Preview delivery note error:', err);
    next(err);
  }
});

// ───────────────────────────────────────────────────────────────
//   GET /goods-received/:asnId
// ───────────────────────────────────────────────────────────────
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

    await drawBannerHeader(doc, company);
    doc.fontSize(14).font('Helvetica-Bold').fillColor(DARK_BLUE).text('GOODS RECEIVED NOTE', 30, 95);
    doc.fontSize(10).font('Helvetica').fillColor('#475569').text(`ASN: ${asn.asnId}`, 30, 112);

    doc.end();
  } catch (err) {
    next(err);
  }
});

// ───────────────────────────────────────────────────────────────
//   GET /inbound-delivery-note/:asnId — Download Inbound Delivery Note PDF/HTML
// ───────────────────────────────────────────────────────────────
router.get('/inbound-delivery-note/:asnId', async (req, res, next) => {
  try {
    if (!req.user?.company) return res.status(403).json({ message: 'Company context required' });

    const asn = await ASN.findOne({
      $or: [{ _id: req.params.asnId.match(/^[0-9a-fA-F]{24}$/) ? req.params.asnId : null }, { asnId: req.params.asnId }, { asnNumber: req.params.asnId }],
      company: req.user.company
    });

    if (!asn) return res.status(404).json({ message: 'ASN not found' });

    if (!asn.deliveryNoteNumber) {
      return res.status(404).json({ message: 'Inbound Delivery Note has not been generated for this ASN yet. Delivery notes generate automatically upon receiving completion.' });
    }

    const docRecord = await Document.findOne({ documentNumber: asn.deliveryNoteNumber, company: req.user.company });
    if (!docRecord) return res.status(404).json({ message: `Document record for ${asn.deliveryNoteNumber} not found.` });

    res.setHeader('Content-Type', 'text/html');
    res.send(docRecord.htmlContent);
  } catch (err) { next(err); }
});

// ───────────────────────────────────────────────────────────────
//   GET /dn/:dnNumber/pdf — Stream binary PDF for Delivery Note
// ───────────────────────────────────────────────────────────────
router.get('/dn/:dnNumber/pdf', async (req, res, next) => {
  try {
    if (!req.user?.company) return res.status(403).json({ message: 'Company context required' });

    const docRecord = await Document.findOne({ documentNumber: req.params.dnNumber, company: req.user.company });
    if (!docRecord) return res.status(404).json({ message: `Delivery Note ${req.params.dnNumber} not found.` });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${docRecord.documentNumber}.pdf"`);

    if (docRecord.pdfDataUri && docRecord.pdfDataUri.includes('base64,')) {
      const base64Data = docRecord.pdfDataUri.split('base64,')[1];
      const buffer = Buffer.from(base64Data, 'base64');
      return res.send(buffer);
    }

    res.status(404).json({ message: 'PDF binary stream data not found for this document.' });
  } catch (err) { next(err); }
});

// ───────────────────────────────────────────────────────────────
//   GET /dn/:dnNumber — Lookup Delivery Note by DN Number (HTML or PDF via ?format=pdf)
// ───────────────────────────────────────────────────────────────
router.get('/dn/:dnNumber', async (req, res, next) => {
  try {
    if (!req.user?.company) return res.status(403).json({ message: 'Company context required' });

    const docRecord = await Document.findOne({ documentNumber: req.params.dnNumber, company: req.user.company });
    if (!docRecord) return res.status(404).json({ message: `Delivery Note ${req.params.dnNumber} not found.` });

    if (req.query.format === 'pdf' && docRecord.pdfDataUri) {
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `inline; filename="${docRecord.documentNumber}.pdf"`);
      const base64Data = docRecord.pdfDataUri.split('base64,')[1];
      const buffer = Buffer.from(base64Data, 'base64');
      return res.send(buffer);
    }

    res.setHeader('Content-Type', 'text/html');
    res.send(docRecord.htmlContent);
  } catch (err) { next(err); }
});

export default router;
