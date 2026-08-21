import Counter from '../models/Counter.js';
import Document from '../models/Document.js';
import ASN from '../models/ASN.js';
import Discrepancy from '../models/Discrepancy.js';
import ActivityLog from '../models/ActivityLog.js';
import PDFDocument from 'pdfkit';

/** Helper to render a binary PDF Buffer in memory using PDFKit */
export async function generatePDFBuffer(asn, dnNumber, discrepancies, companyId, operator) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ margin: 40, size: 'A4' });
      const buffers = [];
      doc.on('data', b => buffers.push(b));
      doc.on('end', () => resolve(Buffer.concat(buffers)));

      const totalExpected = asn.items.reduce((s, i) => s + (Number(i.expected_qty) || 0), 0);
      const totalReceived = asn.items.reduce((s, i) => s + (Number(i.received_qty) || 0), 0);
      const hasDiscrepancies = asn.status === 'completed_with_discrepancies' || (discrepancies && discrepancies.length > 0);

      // Header Banner
      doc.fontSize(22).font('Helvetica-Bold').fillColor('#0f172a').text('INBOUND DELIVERY NOTE', { align: 'left' });
      doc.fontSize(11).font('Helvetica-Bold').fillColor('#0284c7').text('OFFICIAL RECEIVING MANIFEST', { align: 'left' });
      doc.moveDown(0.5);

      // Metadata Block
      doc.fontSize(10).font('Helvetica-Bold').fillColor('#334155');
      doc.text(`Document No: ${dnNumber}`);
      doc.font('Helvetica');
      doc.text(`ASN Number: ${asn.asnId || asn.asnNumber}`);
      doc.text(`PO Reference: ${asn.poNumber || asn.po || 'N/A'}`);
      doc.text(`Supplier: ${asn.supplier}`);
      doc.text(`Owner (3PL): ${asn.owner || 'Default Owner'}`);
      doc.text(`Warehouse: ${asn.warehouse || 'MIA'}`);
      doc.text(`Receiving Dock: ${asn.receivingDock || 'Dock 1'}`);
      doc.text(`Receiving Operator: ${operator}`);
      doc.text(`Receiving Date: ${new Date().toLocaleString()}`);
      doc.moveDown(0.5);

      // Status Pill
      doc.fontSize(12).font('Helvetica-Bold').fillColor(hasDiscrepancies ? '#b91c1c' : '#15803d');
      doc.text(`STATUS: ${hasDiscrepancies ? 'COMPLETED WITH DISCREPANCIES' : 'COMPLETED'}`);
      doc.moveDown();

      // Product Summary Header
      doc.fontSize(11).font('Helvetica-Bold').fillColor('#0f172a').text('Received Product Line Items Summary:');
      doc.moveDown(0.3);

      doc.fontSize(9).font('Helvetica-Bold').fillColor('#1e293b');
      doc.text('#   SKU           Description                    Expected   Received   Lot #         Status');
      doc.text('-----------------------------------------------------------------------------------------');

      doc.font('Helvetica').fillColor('#334155');
      asn.items.forEach((item, idx) => {
        const skuStr = (item.sku || '').padEnd(14, ' ');
        const nameStr = (item.name || '').slice(0, 24).padEnd(26, ' ');
        const expStr = String(item.expected_qty || 0).padEnd(10, ' ');
        const recStr = String(item.received_qty || 0).padEnd(10, ' ');
        const lotStr = (item.lotNumber || 'DEFAULT').padEnd(12, ' ');
        const statusStr = item.received_qty >= item.expected_qty ? 'RECEIVED' : 'PARTIAL';
        doc.text(`${String(idx + 1).padEnd(3, ' ')}${skuStr}${nameStr}${expStr}${recStr}${lotStr}${statusStr}`);
      });
      doc.moveDown();

      // Discrepancies Table
      if (discrepancies && discrepancies.length > 0) {
        doc.fontSize(11).font('Helvetica-Bold').fillColor('#9f1239').text('Discrepancy Exception Report:');
        doc.moveDown(0.3);
        doc.fontSize(9).font('Helvetica').fillColor('#881337');
        discrepancies.forEach((d, i) => {
          doc.text(`${i + 1}. SKU: ${d.sku} | Type: ${d.type.toUpperCase()} | Expected: ${d.expectedQty} | Received: ${d.receivedQty} | Diff: ${d.difference} | Notes: ${d.notes || 'N/A'}`);
        });
        doc.moveDown();
      }

      // Totals & Signature Block
      doc.fontSize(10).font('Helvetica-Bold').fillColor('#0f172a');
      doc.text(`TOTAL EXPECTED UNITS: ${totalExpected} ${asn.items[0]?.uom || 'pcs'}`);
      doc.text(`TOTAL RECEIVED UNITS: ${totalReceived} ${asn.items[0]?.uom || 'pcs'}`);
      doc.moveDown();

      doc.fontSize(10).font('Helvetica-Bold').fillColor('#0284c7').text('RECEIVING INSPECTOR SIGNATURE: Verified & Sealed');
      doc.fontSize(9).font('Helvetica-Oblique').fillColor('#64748b').text(`Enterprise WMS Inbound Logistics Manifest • ${dnNumber} • Company ID: ${companyId}`);

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Generate sequential Inbound Delivery Note (DN-2026-000001) for an ASN upon completion.
 * Zero filesystem dependencies (Vercel Serverless read-only safe).
 */
export async function generateInboundDeliveryNote(asn, companyId, operator = 'system', session = null) {
  if (!asn) return null;

  // Idempotency: Return existing Delivery Note if already generated
  if (asn.deliveryNoteNumber) {
    const existingDoc = await Document.findOne({ documentNumber: asn.deliveryNoteNumber, company: companyId });
    if (existingDoc) return existingDoc;
  }

  // 1. Generate Next Sequential Delivery Note Number (DN-YYYY-XXXXXX)
  const currentYear = new Date().getFullYear();
  const counterId = `delivery_note_${currentYear}_${companyId}`;
  const counterOpts = session ? { session, new: true, upsert: true } : { new: true, upsert: true };

  let dnNumber = '';
  let attempts = 0;
  while (!dnNumber && attempts < 50) {
    attempts++;
    const counter = await Counter.findOneAndUpdate(
      { _id: counterId, company: companyId },
      { $inc: { seq: 1 } },
      counterOpts
    );
    const candidate = `DN-${currentYear}-${String(counter.seq).padStart(6, '0')}`;
    const existsDoc = await Document.findOne({ documentNumber: candidate, company: companyId });
    if (!existsDoc) {
      dnNumber = candidate;
    }
  }

  if (!dnNumber) {
    dnNumber = `DN-${currentYear}-${Date.now().toString().slice(-6)}`;
  }

  // 2. Fetch Discrepancies if any
  const discQuery = Discrepancy.find({ asnId: asn.asnId || asn.asnNumber, company: companyId });
  if (session) discQuery.session(session);
  const discrepancies = await discQuery;

  const totalExpected = asn.items.reduce((s, i) => s + (Number(i.expected_qty) || 0), 0);
  const totalReceived = asn.items.reduce((s, i) => s + (Number(i.received_qty) || 0), 0);
  const hasDiscrepancies = asn.status === 'completed_with_discrepancies' || discrepancies.length > 0;

  // 3. Build Rich Document HTML / Printable Representation
  const formattedDate = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' });

  const itemsHtml = asn.items.map((item, idx) => `
    <tr style="border-bottom: 1px solid #e2e8f0; font-size: 13px;">
      <td style="padding: 10px; font-weight: 600; color: #1e293b;">${idx + 1}</td>
      <td style="padding: 10px; font-family: monospace; font-weight: 700; color: #0284c7;">${item.sku}</td>
      <td style="padding: 10px; color: #334155;">${item.name || ''}</td>
      <td style="padding: 10px; text-align: right;">${item.expected_qty} ${item.uom || 'pcs'}</td>
      <td style="padding: 10px; text-align: right; font-weight: 700; color: ${item.received_qty < item.expected_qty ? '#dc2626' : '#16a34a'};">${item.received_qty} ${item.uom || 'pcs'}</td>
      <td style="padding: 10px; text-align: center;">${item.lotNumber || 'DEFAULT-LOT'}</td>
      <td style="padding: 10px; text-align: center;">
        <span style="padding: 3px 8px; border-radius: 12px; font-size: 11px; font-weight: 700; background: ${item.received_qty >= item.expected_qty ? '#dcfce7; color: #15803d;' : '#fee2e2; color: #b91c1c;'};">
          ${item.received_qty >= item.expected_qty ? 'RECEIVED' : 'PARTIAL/DISCREPANT'}
        </span>
      </td>
    </tr>
  `).join('');

  const discHtml = discrepancies.length > 0 ? `
    <div style="margin-top: 24px; padding: 16px; background: #fff1f2; border: 1px solid #fecdd3; border-radius: 8px;">
      <h4 style="margin: 0 0 12px 0; color: #9f1239; font-size: 14px;">⚠️ Discrepancy Exception Report</h4>
      <table style="width: 100%; border-collapse: collapse; font-size: 12px;">
        <thead>
          <tr style="text-align: left; color: #881337; border-bottom: 1px solid #fda4af;">
            <th style="padding: 6px;">SKU</th>
            <th style="padding: 6px;">Type</th>
            <th style="padding: 6px;">Expected</th>
            <th style="padding: 6px;">Received</th>
            <th style="padding: 6px;">Difference</th>
            <th style="padding: 6px;">Notes</th>
          </tr>
        </thead>
        <tbody>
          ${discrepancies.map(d => `
            <tr style="border-bottom: 1px dashed #fecdd3;">
              <td style="padding: 6px; font-weight: 700;">${d.sku}</td>
              <td style="padding: 6px; text-transform: uppercase;">${d.type}</td>
              <td style="padding: 6px;">${d.expectedQty}</td>
              <td style="padding: 6px;">${d.receivedQty}</td>
              <td style="padding: 6px; font-weight: 700; color: #b91c1c;">${d.difference}</td>
              <td style="padding: 6px;">${d.notes || ''}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  ` : '';

  const htmlContent = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <title>Inbound Delivery Note - ${dnNumber}</title>
      <style>
        body { font-family: 'Inter', -apple-system, sans-serif; color: #0f172a; margin: 0; padding: 40px; background: #f8fafc; }
        .doc-card { max-width: 800px; margin: 0 auto; background: #ffffff; padding: 40px; border-radius: 12px; box-shadow: 0 4px 20px rgba(0,0,0,0.08); border: 1px solid #e2e8f0; }
        .header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #0284c7; padding-bottom: 20px; margin-bottom: 24px; }
        .title { font-size: 24px; font-weight: 800; color: #0f172a; margin: 0; letter-spacing: -0.5px; }
        .subtitle { font-size: 14px; font-weight: 700; color: #0284c7; margin-top: 4px; }
        .badge { display: inline-block; padding: 6px 14px; border-radius: 20px; font-size: 12px; font-weight: 800; text-transform: uppercase; }
        .badge-success { background: #dcfce7; color: #166534; }
        .badge-warning { background: #fef3c7; color: #92400e; }
        .meta-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; background: #f1f5f9; padding: 16px; border-radius: 8px; margin-bottom: 24px; }
        .meta-item label { font-size: 11px; font-weight: 700; text-transform: uppercase; color: #64748b; display: block; margin-bottom: 4px; }
        .meta-item span { font-size: 14px; font-weight: 600; color: #1e293b; }
        table { width: 100%; border-collapse: collapse; margin-top: 16px; }
        th { background: #0f172a; color: #ffffff; font-size: 12px; font-weight: 700; text-transform: uppercase; padding: 10px; text-align: left; }
        .footer { margin-top: 40px; pt: 20px; border-top: 1px solid #e2e8f0; display: flex; justify-content: space-between; font-size: 12px; color: #64748b; }
        @media print { .no-print { display: none !important; } body { padding: 0; background: #ffffff; } .doc-card { box-shadow: none; border: none; padding: 0; } }
      </style>
      <script>
        function downloadPdf() {
          const token = localStorage.getItem('jwt_token') || localStorage.getItem('token');
          fetch('/api/v1/documents/dn/${dnNumber}/pdf', {
            headers: { 'Authorization': 'Bearer ' + token }
          })
          .then(res => {
            if (!res.ok) throw new Error('Failed to download PDF stream from server');
            return res.blob();
          })
          .then(blob => {
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = '${dnNumber}.pdf';
            document.body.appendChild(a);
            a.click();
            a.remove();
            window.URL.revokeObjectURL(url);
          })
          .catch(err => alert(err.message));
        }
      </script>
    </head>
    <body>
      <div class="no-print" style="max-width: 800px; margin: 0 auto 16px auto; display: flex; justify-content: space-between; align-items: center; background: #ffffff; padding: 12px 20px; border-radius: 10px; border: 1px solid #cbd5e1; box-shadow: 0 2px 10px rgba(0,0,0,0.05);">
        <div style="font-size: 13px; font-weight: 700; color: #0f172a; display: flex; align-items: center; gap: 8px;">
          <span>📄 <strong>Inbound Delivery Note</strong> (${dnNumber})</span>
        </div>
        <div style="display: flex; gap: 10px;">
          <button onclick="window.print()" style="padding: 8px 16px; background: #f1f5f9; color: #334155; border: 1px solid #cbd5e1; border-radius: 6px; font-weight: 700; font-size: 12px; cursor: pointer;">
            🖨️ Print Manifest
          </button>
          <button onclick="downloadPdf()" style="padding: 8px 18px; background: #0284c7; color: #ffffff; border: none; border-radius: 6px; font-weight: 700; font-size: 12px; cursor: pointer; display: inline-flex; align-items: center; gap: 6px;">
            📥 Download PDF
          </button>
        </div>
      </div>
      <div class="doc-card">
        <div class="header">
          <div>
            <h1 class="title">INBOUND DELIVERY NOTE</h1>
            <div class="subtitle">OFFICIAL RECEIVING MANIFEST</div>
            <div style="font-size: 13px; color: #64748b; margin-top: 6px;">Document No: <strong style="color: #0f172a;">${dnNumber}</strong></div>
          </div>
          <div style="text-align: right;">
            <span class="badge ${hasDiscrepancies ? 'badge-warning' : 'badge-success'}">
              ${hasDiscrepancies ? 'COMPLETED WITH DISCREPANCIES' : 'COMPLETED'}
            </span>
            <div style="font-size: 12px; color: #64748b; margin-top: 8px;">Generated: ${formattedDate}</div>
          </div>
        </div>

        <div class="meta-grid">
          <div class="meta-item"><label>ASN Number</label><span>${asn.asnId || asn.asnNumber}</span></div>
          <div class="meta-item"><label>PO Reference</label><span>${asn.poNumber || asn.po || 'N/A'}</span></div>
          <div class="meta-item"><label>Supplier</label><span>${asn.supplier}</span></div>
          <div class="meta-item"><label>Owner (3PL)</label><span>${asn.owner || 'Default Owner'}</span></div>
          <div class="meta-item"><label>Warehouse</label><span>${asn.warehouse || 'MIA'}</span></div>
          <div class="meta-item"><label>Receiving Dock</label><span>${asn.receivingDock || 'Dock 1'}</span></div>
          <div class="meta-item"><label>Receiving Operator</label><span>${operator}</span></div>
        </div>

        <h3 style="font-size: 15px; margin: 24px 0 8px 0; color: #0f172a;">Received Line Items Summary</h3>
        <table>
          <thead>
            <tr>
              <th style="width: 40px;">#</th>
              <th>SKU</th>
              <th>Description</th>
              <th style="text-align: right;">Expected</th>
              <th style="text-align: right;">Received</th>
              <th style="text-align: center;">Lot #</th>
              <th style="text-align: center;">Status</th>
            </tr>
          </thead>
          <tbody>
            ${itemsHtml}
          </tbody>
        </table>

        ${discHtml}

        <div style="margin-top: 32px; padding: 16px; background: #fafafa; border-radius: 8px; border: 1px dashed #cbd5e1; display: flex; justify-content: space-between; align-items: center;">
          <div>
            <div style="font-size: 12px; font-weight: 700; color: #475569;">TOTAL UNITS EXPECTED: ${totalExpected} ${asn.items[0]?.uom || 'pcs'}</div>
            <div style="font-size: 14px; font-weight: 800; color: #0f172a; margin-top: 2px;">TOTAL UNITS RECEIVED: ${totalReceived} ${asn.items[0]?.uom || 'pcs'}</div>
          </div>
          <div style="text-align: right;">
            <div style="font-size: 11px; color: #64748b; text-transform: uppercase;">Receiving Inspector Signature</div>
            <div style="font-family: cursive; font-size: 18px; color: #0284c7; margin-top: 4px;">Verified & Sealed</div>
          </div>
        </div>

        <div class="footer">
          <div>Company ID: ${companyId}</div>
          <div>Enterprise WMS Inbound Logistics Manifest • ${dnNumber}</div>
        </div>
      </div>
    </body>
    </html>
  `;

  const fileUrl = `/api/v1/documents/dn/${dnNumber}`;

  // 4. Generate In-Memory Binary PDF Stream
  let pdfDataUri = '';
  try {
    const pdfBuf = await generatePDFBuffer(asn, dnNumber, discrepancies, companyId, operator);
    pdfDataUri = `data:application/pdf;base64,${pdfBuf.toString('base64')}`;
  } catch (pdfErr) {
    console.error('Failed to render PDF buffer:', pdfErr);
  }

  // 5. Create Document Record in MongoDB (stored 100% in database, serverless safe)
  const docCreateOpts = session ? { session } : {};
  const [docRecord] = await Document.create([{
    documentNumber: dnNumber,
    type: 'INBOUND_DELIVERY_NOTE',
    asnId: asn.asnId || asn.asnNumber,
    asnNumber: asn.asnId || asn.asnNumber,
    supplier: asn.supplier,
    owner: asn.owner || 'Default Owner',
    poNumber: asn.poNumber || asn.po || 'N/A',
    warehouse: asn.warehouse || 'MIA',
    receivingDock: asn.receivingDock || 'Dock 1',
    receivedAt: new Date(),
    totalExpected,
    totalReceived,
    hasDiscrepancies,
    discrepancyCount: discrepancies.length,
    items: asn.items.map(i => ({
      sku: i.sku,
      name: i.name,
      expected_qty: i.expected_qty,
      received_qty: i.received_qty,
      uom: i.uom,
      lotNumber: i.lotNumber || 'DEFAULT-LOT',
      status: i.received_qty >= i.expected_qty ? 'RECEIVED' : 'PARTIAL'
    })),
    pdfPath: '',
    pdfUrl: fileUrl,
    pdfDataUri,
    htmlContent,
    generatedBy: operator,
    company: companyId
  }], docCreateOpts);

  // 5. Update ASN with Delivery Note reference
  asn.deliveryNoteNumber = dnNumber;
  asn.deliveryNoteId = docRecord._id;
  asn.deliveryNoteUrl = fileUrl;

  const asnSaveOpts = session ? { session } : {};
  await asn.save(asnSaveOpts);

  // Log Activity
  try {
    const logOpts = session ? { session } : {};
    await ActivityLog.create([{
      logId: 'LOG-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
      user: operator,
      role: 'warehouse_staff',
      action: 'DELIVERY_NOTE_GENERATED',
      module: 'DOCUMENT',
      detail: `Generated Inbound Delivery Note ${dnNumber} for ASN ${asn.asnId} (${totalReceived}/${totalExpected} units received).`,
      timestamp: new Date(),
      company: companyId
    }], logOpts);
  } catch (_) {}

  return docRecord;
}

/** Helper to render a binary PDF Buffer in memory using PDFKit for Outbound B2B Pick Delivery Notes */
export async function generatePickDeliveryNotePDFBuffer(pickTask, order, dnNumber, companyId, operator) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ margin: 40, size: 'A4' });
      const buffers = [];
      doc.on('data', b => buffers.push(b));
      doc.on('end', () => resolve(Buffer.concat(buffers)));

      const totalOrdered = pickTask.items.reduce((s, i) => s + (Number(i.orderedQty) || 0), 0);
      const totalPicked = pickTask.items.reduce((s, i) => s + (Number(i.pickedQty) || 0), 0);
      const totalShortfall = pickTask.items.reduce((s, i) => s + (Number(i.shortfallQty) || 0), 0);
      const isPartial = totalShortfall > 0 || pickTask.status === 'partially_picked';

      const isB2C = pickTask.orderType === 'B2C' || order?.order_type === 'B2C';
      const title = isB2C ? 'OUTBOUND B2C DELIVERY NOTE' : 'OUTBOUND B2B DELIVERY NOTE';
      const subtitle = isB2C ? 'OFFICIAL B2C / E-COMMERCE SHIPPING MANIFEST' : 'OFFICIAL B2B PICKING & SHIPPING MANIFEST';
      const customerLabel = isB2C ? 'Customer / Recipient:' : 'Customer / Buyer:';

      // Header Banner
      doc.fontSize(22).font('Helvetica-Bold').fillColor('#0f172a').text(title, { align: 'left' });
      doc.fontSize(11).font('Helvetica-Bold').fillColor('#0284c7').text(subtitle, { align: 'left' });
      doc.moveDown(0.5);

      // Metadata Block
      doc.fontSize(10).font('Helvetica-Bold').fillColor('#334155');
      doc.text(`Document No: ${dnNumber}`);
      doc.font('Helvetica');
      doc.text(`Order Number: ${pickTask.orderNumber || pickTask.orderId} (${isB2C ? 'B2C' : 'B2B'})`);
      doc.text(`Pick Task ID: ${pickTask.taskId}`);
      doc.text(`${customerLabel} ${pickTask.customer || order?.customer || 'Client'}`);
      doc.text(`3PL Stock Owner: ${pickTask.owner || 'Default Owner'}`);
      doc.text(`Warehouse: ${pickTask.warehouse || 'MIA'}`);
      doc.text(`Picking Operator: ${operator}`);
      doc.text(`Date & Time: ${new Date().toLocaleString()}`);
      doc.moveDown(0.5);

      // Status Pill
      doc.fontSize(12).font('Helvetica-Bold').fillColor(isPartial ? '#d97706' : '#15803d');
      doc.text(`STATUS: ${isPartial ? 'PARTIALLY PICKED WITH SHORTFALL' : 'COMPLETED - READY FOR SHIPPING'}`);
      doc.moveDown();

      // Product Summary Header
      doc.fontSize(11).font('Helvetica-Bold').fillColor('#0f172a').text('Picked Product Line Items Summary:');
      doc.moveDown(0.3);

      doc.fontSize(9).font('Helvetica-Bold').fillColor('#1e293b');
      doc.text('#   SKU           Description                    Ordered   Picked   Shortfall   Bin         Status');
      doc.text('---------------------------------------------------------------------------------------------------');

      doc.font('Helvetica').fillColor('#334155');
      pickTask.items.forEach((item, idx) => {
        const skuStr = (item.sku || '').padEnd(14, ' ');
        const nameStr = (item.productName || '').slice(0, 24).padEnd(26, ' ');
        const ordStr = String(item.orderedQty || 0).padEnd(9, ' ');
        const pickStr = String(item.pickedQty || 0).padEnd(9, ' ');
        const shortStr = String(item.shortfallQty || 0).padEnd(11, ' ');
        const binStr = (item.sourceLocation || 'STAGING-A').padEnd(11, ' ');
        const statusStr = item.pickedQty >= item.orderedQty ? 'PICKED' : 'SHORTFALL';

        doc.text(`${(idx + 1).toString().padEnd(3, ' ')}${skuStr}${nameStr}${ordStr}${pickStr}${shortStr}${binStr}${statusStr}`);
      });

      doc.moveDown();
      doc.font('Helvetica-Bold').fillColor('#0f172a');
      doc.text(`TOTALS: Ordered = ${totalOrdered} units | Picked = ${totalPicked} units | Shortfall = ${totalShortfall} units`);

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}
