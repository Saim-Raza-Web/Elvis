import PDFDocument from 'pdfkit';

/**
 * Generate an in-memory binary PDF Buffer for a Purchase Order using PDFKit.
 * Serverless / Vercel safe (zero filesystem write dependencies).
 */
export async function generatePurchaseOrderPDFBuffer(po, company) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ margin: 40, size: 'A4', compress: false });
      const buffers = [];

      doc.on('data', b => buffers.push(b));
      doc.on('end', () => resolve(Buffer.concat(buffers)));

      const companyName = company?.name || 'Elvis Logistics S.L.';
      const tradingName = company?.tradingName ? ` (${company.tradingName})` : '';
      const companyVat = company?.vatNumber || 'ES-B12345678';
      const companyEmail = company?.email || 'purchasing@demologistics.io';
      const companyPhone = company?.phone || '+34 912 345 678';
      const addr = company?.address || {};
      const companyAddressStr = [
        addr.street,
        addr.number,
        addr.postcode,
        addr.city,
        addr.region,
        addr.country
      ].filter(Boolean).join(', ') || 'Calle Principal 100, 28001 Madrid, Spain';

      const currency = po.currency || company?.currency || 'EUR';
      const currSymbol = currency === 'USD' ? '$' : '€';

      // ── 1. Top Header Banner ──────────────────────────────────────────────
      doc.fontSize(22).font('Helvetica-Bold').fillColor('#0f172a').text(companyName + tradingName, { align: 'left' });
      doc.fontSize(9).font('Helvetica').fillColor('#64748b');
      doc.text(`VAT/Tax ID: ${companyVat} • Email: ${companyEmail} • Phone: ${companyPhone}`);
      doc.text(`Address: ${companyAddressStr}`);
      doc.moveDown(0.8);

      // Separator Line
      doc.strokeColor('#e2e8f0').lineWidth(1.5).moveTo(40, doc.y).lineTo(555, doc.y).stroke();
      doc.moveDown(0.8);

      // ── 2. PO Meta & Title ────────────────────────────────────────────
      const startY = doc.y;

      // Left Column: Document Title & Metadata
      doc.fontSize(18).font('Helvetica-Bold').fillColor('#0284c7').text('PURCHASE ORDER', 40, startY);
      doc.fontSize(10).font('Helvetica-Bold').fillColor('#0f172a');
      doc.text(`PO Number: `, 40, startY + 26, { continued: true }).font('Helvetica').text(po.poNumber);
      doc.font('Helvetica-Bold').text(`Issue Date: `, { continued: true }).font('Helvetica').text(po.createdAt ? new Date(po.createdAt).toLocaleDateString() : new Date().toLocaleDateString());
      doc.font('Helvetica-Bold').text(`Delivery Date: `, { continued: true }).font('Helvetica').text(po.expectedDeliveryDate ? new Date(po.expectedDeliveryDate).toLocaleDateString() : 'ASAP');
      doc.font('Helvetica-Bold').text(`Delivery Warehouse: `, { continued: true }).font('Helvetica').text(po.warehouse || 'MIA');

      // Right Column: Supplier Info
      const statusColor = po.status === 'CONFIRMED' ? '#15803d' : '#0284c7';
      doc.fontSize(11).font('Helvetica-Bold').fillColor(statusColor).text(`STATUS: ${(po.status || 'DRAFT').toUpperCase()}`, 340, startY, { align: 'right' });

      doc.moveDown(0.5);
      doc.fontSize(11).font('Helvetica-Bold').fillColor('#0f172a').text('TO SUPPLIER:', 320, startY + 26);
      doc.fontSize(10).font('Helvetica-Bold').fillColor('#1e293b').text(po.supplierId?.name || 'Supplier', 320, startY + 40);
      doc.font('Helvetica').fontSize(9).fillColor('#475569');
      if (po.supplierId?.contactEmail) doc.text(`Email: ${po.supplierId.contactEmail}`, 320);
      if (po.supplierId?.contactPhone) doc.text(`Phone: ${po.supplierId.contactPhone}`, 320);
      if (po.supplierReference) doc.text(`Supplier Ref: ${po.supplierReference}`, 320);

      doc.y = Math.max(doc.y, startY + 110);
      doc.moveDown(0.8);

      // ── 3. Line Items Table ────────────────────────────────────────────────
      doc.fontSize(11).font('Helvetica-Bold').fillColor('#0f172a').text('Order Lines:');
      doc.moveDown(0.3);

      const tableTop = doc.y;
      doc.fontSize(9).font('Helvetica-Bold').fillColor('#ffffff');
      
      // Header Background
      doc.rect(40, tableTop, 515, 20).fill('#0f172a');
      doc.fillColor('#ffffff');
      doc.text('#', 45, tableTop + 5, { width: 20 });
      doc.text('SKU', 70, tableTop + 5, { width: 85 });
      doc.text('Description', 160, tableTop + 5, { width: 170 });
      doc.text('Qty', 335, tableTop + 5, { width: 35, align: 'right' });
      doc.text('Cost', 375, tableTop + 5, { width: 50, align: 'right' });
      doc.text('Tax', 430, tableTop + 5, { width: 40, align: 'right' });
      doc.text('Total', 475, tableTop + 5, { width: 75, align: 'right' });

      let currentY = tableTop + 24;
      doc.font('Helvetica').fontSize(8.5).fillColor('#334155');

      const lines = Array.isArray(po.lines) ? po.lines : [];
      let subtotal = 0;
      let totalTax = 0;
      let grandTotal = 0;

      lines.forEach((item, idx) => {
        if (idx % 2 === 1) {
          doc.rect(40, currentY - 2, 515, 18).fill('#f8fafc');
        }
        doc.fillColor('#334155');
        doc.text(String(idx + 1), 45, currentY, { width: 20 });
        doc.text(item.sku || 'ITEM', 70, currentY, { width: 85 });
        doc.text((item.description || '').slice(0, 32), 160, currentY, { width: 170 });
        doc.text(`${item.quantityOrdered}`, 335, currentY, { width: 35, align: 'right' });
        doc.text(`${currSymbol}${(item.unitCost || 0).toFixed(2)}`, 375, currentY, { width: 50, align: 'right' });
        doc.text(`${item.taxRate || 0}%`, 430, currentY, { width: 40, align: 'right' });
        doc.text(`${currSymbol}${(item.lineTotal || 0).toFixed(2)}`, 475, currentY, { width: 75, align: 'right' });
        
        subtotal += item.lineSubtotal || 0;
        totalTax += item.taxAmount || 0;
        grandTotal += item.lineTotal || 0;

        currentY += 18;
      });

      doc.strokeColor('#e2e8f0').lineWidth(1).moveTo(40, currentY).lineTo(555, currentY).stroke();
      doc.y = currentY + 10;

      // ── 4. Totals Box ──────────────────────────────────────
      const totalsY = doc.y;

      doc.fontSize(9).font('Helvetica-Bold').fillColor('#475569');
      doc.text('Subtotal:', 360, totalsY, { width: 100, align: 'right' });
      doc.font('Helvetica').text(`${currSymbol}${subtotal.toFixed(2)}`, 465, totalsY, { width: 90, align: 'right' });

      doc.font('Helvetica-Bold').text('Total Tax:', 360, totalsY + 16, { width: 100, align: 'right' });
      doc.font('Helvetica').text(`${currSymbol}${totalTax.toFixed(2)}`, 465, totalsY + 16, { width: 90, align: 'right' });

      // Grand Total Highlight Box
      doc.rect(350, totalsY + 34, 205, 26).fill('#0284c7');
      doc.fontSize(11).font('Helvetica-Bold').fillColor('#ffffff');
      doc.text('GRAND TOTAL:', 360, totalsY + 41, { width: 95, align: 'left' });
      doc.text(`${currSymbol}${grandTotal.toFixed(2)}`, 455, totalsY + 41, { width: 95, align: 'right' });

      // ── 5. Footer & Legal ──────────────────────────────────────────────────
      doc.fontSize(8).font('Helvetica-Oblique').fillColor('#94a3b8');
      if (po.notes) {
        doc.text(`Notes: ${po.notes}`, 40, 720, { align: 'left', width: 515 });
      }
      doc.text(
        `This is an official purchase order generated by ${companyName}.`,
        40,
        740,
        { align: 'center', width: 515 }
      );
      doc.text(
        `PO Ref: ${po.poNumber} • Page 1 of 1`,
        40,
        752,
        { align: 'center', width: 515 }
      );

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}
