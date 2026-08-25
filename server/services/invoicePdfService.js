import PDFDocument from 'pdfkit';

/**
 * Generate an in-memory binary PDF Buffer for an Invoice using PDFKit.
 * Serverless / Vercel safe (zero filesystem write dependencies).
 */
export async function generateInvoicePDFBuffer(invoice, company) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ margin: 40, size: 'A4', compress: false });
      const buffers = [];

      doc.on('data', b => buffers.push(b));
      doc.on('end', () => resolve(Buffer.concat(buffers)));

      const companyName = company?.name || 'Elvis Logistics S.L.';
      const tradingName = company?.tradingName ? ` (${company.tradingName})` : '';
      const companyVat = company?.vatNumber || 'ES-B12345678';
      const companyEmail = company?.email || 'billing@demologistics.io';
      const companyPhone = company?.phone || '+34 912 345 678';
      const companyWebsite = company?.website || 'www.demologistics.io';
      const addr = company?.address || {};
      const companyAddressStr = [
        addr.street,
        addr.number,
        addr.postcode,
        addr.city,
        addr.region,
        addr.country
      ].filter(Boolean).join(', ') || 'Calle Principal 100, 28001 Madrid, Spain';

      const currency = company?.currency || 'EUR';
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

      // ── 2. Invoice Meta & Title ────────────────────────────────────────────
      const startY = doc.y;

      // Left Column: Document Title & Metadata
      doc.fontSize(18).font('Helvetica-Bold').fillColor('#0284c7').text('COMMERCIAL INVOICE', 40, startY);
      doc.fontSize(10).font('Helvetica-Bold').fillColor('#0f172a');
      doc.text(`Invoice No: `, 40, startY + 26, { continued: true }).font('Helvetica').text(invoice.invoiceNumber || invoice.invoiceId);
      doc.font('Helvetica-Bold').text(`Issue Date: `, { continued: true }).font('Helvetica').text(invoice.issuedDate ? new Date(invoice.issuedDate).toLocaleDateString() : new Date().toLocaleDateString());
      doc.font('Helvetica-Bold').text(`Due Date: `, { continued: true }).font('Helvetica').text(invoice.dueDate ? new Date(invoice.dueDate).toLocaleDateString() : 'Upon Receipt');
      doc.font('Helvetica-Bold').text(`Payment Terms: `, { continued: true }).font('Helvetica').text(invoice.paymentTerms || 'Net 30');

      // Right Column: Status & Customer Bill-To
      const statusColor = invoice.status === 'paid' ? '#15803d' : invoice.status === 'sent' ? '#0284c7' : invoice.status === 'cancelled' ? '#b91c1c' : '#d97706';
      doc.fontSize(11).font('Helvetica-Bold').fillColor(statusColor).text(`STATUS: ${(invoice.status || 'DRAFT').toUpperCase()}`, 340, startY, { align: 'right' });

      doc.moveDown(0.5);
      doc.fontSize(11).font('Helvetica-Bold').fillColor('#0f172a').text('BILL TO / CUSTOMER:', 320, startY + 26);
      doc.fontSize(10).font('Helvetica-Bold').fillColor('#1e293b').text(invoice.customerName || 'Customer', 320, startY + 40);
      doc.font('Helvetica').fontSize(9).fillColor('#475569');
      if (invoice.customerVat) doc.text(`VAT/Tax ID: ${invoice.customerVat}`, 320);
      if (invoice.customerEmail) doc.text(`Email: ${invoice.customerEmail}`, 320);
      if (invoice.customerPhone) doc.text(`Phone: ${invoice.customerPhone}`, 320);
      if (invoice.customerAddress) doc.text(`Address: ${invoice.customerAddress}`, 320);

      doc.y = Math.max(doc.y, startY + 110);
      doc.moveDown(0.8);

      // ── 3. Line Items Table ────────────────────────────────────────────────
      doc.fontSize(11).font('Helvetica-Bold').fillColor('#0f172a').text('Invoice Line Items:');
      doc.moveDown(0.3);

      const tableTop = doc.y;
      doc.fontSize(9).font('Helvetica-Bold').fillColor('#ffffff');
      
      // Header Background
      doc.rect(40, tableTop, 515, 20).fill('#0f172a');
      doc.fillColor('#ffffff');
      doc.text('#', 45, tableTop + 5, { width: 20 });
      doc.text('SKU / Code', 70, tableTop + 5, { width: 85 });
      doc.text('Description', 160, tableTop + 5, { width: 170 });
      doc.text('Qty', 335, tableTop + 5, { width: 35, align: 'right' });
      doc.text('Price', 375, tableTop + 5, { width: 50, align: 'right' });
      doc.text('Tax', 430, tableTop + 5, { width: 40, align: 'right' });
      doc.text('Total', 475, tableTop + 5, { width: 75, align: 'right' });

      let currentY = tableTop + 24;
      doc.font('Helvetica').fontSize(8.5).fillColor('#334155');

      const lines = Array.isArray(invoice.lines) && invoice.lines.length > 0 
        ? invoice.lines 
        : [{ sku: 'N/A', description: invoice.notes || 'General Services', quantity: invoice.items || 1, uom: 'EA', unitPrice: invoice.amount || invoice.grandTotal || 0, taxRate: 21, lineTotal: invoice.amount || invoice.grandTotal || 0 }];

      lines.forEach((item, idx) => {
        // Alternate row background
        if (idx % 2 === 1) {
          doc.rect(40, currentY - 2, 515, 18).fill('#f8fafc');
        }
        doc.fillColor('#334155');
        doc.text(String(idx + 1), 45, currentY, { width: 20 });
        doc.text(item.sku || 'SERVICE', 70, currentY, { width: 85 });
        doc.text((item.description || '').slice(0, 32), 160, currentY, { width: 170 });
        doc.text(`${item.quantity} ${item.uom || ''}`, 335, currentY, { width: 35, align: 'right' });
        doc.text(`${currSymbol}${(item.unitPrice || 0).toFixed(2)}`, 375, currentY, { width: 50, align: 'right' });
        doc.text(`${item.taxRate || 0}%`, 430, currentY, { width: 40, align: 'right' });
        doc.text(`${currSymbol}${(item.lineTotal || 0).toFixed(2)}`, 475, currentY, { width: 75, align: 'right' });
        currentY += 18;
      });

      doc.strokeColor('#e2e8f0').lineWidth(1).moveTo(40, currentY).lineTo(555, currentY).stroke();
      doc.y = currentY + 10;

      // ── 4. Tax Breakdown & Totals Box ──────────────────────────────────────
      const totalsY = doc.y;

      // Left: Tax Breakdown Table & Payment info
      doc.fontSize(9).font('Helvetica-Bold').fillColor('#0f172a').text('Tax Breakdown:', 40, totalsY);
      doc.font('Helvetica').fontSize(8.5).fillColor('#475569');
      let taxY = totalsY + 14;

      if (Array.isArray(invoice.taxBreakdown) && invoice.taxBreakdown.length > 0) {
        invoice.taxBreakdown.forEach(tb => {
          doc.text(`• VAT ${tb.taxRate}% on ${currSymbol}${tb.taxableAmount.toFixed(2)}: ${currSymbol}${tb.taxAmount.toFixed(2)}`, 40, taxY);
          taxY += 12;
        });
      } else {
        doc.text(`• Standard VAT included`, 40, taxY);
        taxY += 12;
      }

      // Bank & Remittance
      doc.moveDown(0.5);
      doc.font('Helvetica-Bold').fontSize(9).fillColor('#0f172a').text('Bank & Remittance Details:', 40, taxY + 6);
      doc.font('Helvetica').fontSize(8.5).fillColor('#475569');
      doc.text(`Bank / IBAN: ${invoice.bankInfo || company?.iban || 'ES91 2100 0418 4502 0005 1332'}`, 40, taxY + 18);
      doc.text(`SWIFT / BIC: ${company?.swift || 'CAIXESBBXXX'}`, 40, taxY + 28);
      doc.text(`Payment Reference: ${invoice.invoiceNumber || invoice.invoiceId}`, 40, taxY + 38);

      // Right: Subtotal, Total Tax, Grand Total
      const subtotal = invoice.subtotal || invoice.amount || 0;
      const totalTax = invoice.totalTax || 0;
      const grandTotal = invoice.grandTotal || invoice.amount || 0;

      doc.fontSize(9).font('Helvetica-Bold').fillColor('#475569');
      doc.text('Subtotal (Net):', 360, totalsY, { width: 100, align: 'right' });
      doc.font('Helvetica').text(`${currSymbol}${subtotal.toFixed(2)}`, 465, totalsY, { width: 90, align: 'right' });

      doc.font('Helvetica-Bold').text('Total Tax / VAT:', 360, totalsY + 16, { width: 100, align: 'right' });
      doc.font('Helvetica').text(`${currSymbol}${totalTax.toFixed(2)}`, 465, totalsY + 16, { width: 90, align: 'right' });

      // Grand Total Highlight Box
      doc.rect(350, totalsY + 34, 205, 26).fill('#0284c7');
      doc.fontSize(11).font('Helvetica-Bold').fillColor('#ffffff');
      doc.text('GRAND TOTAL:', 360, totalsY + 41, { width: 95, align: 'left' });
      doc.text(`${currSymbol}${grandTotal.toFixed(2)}`, 455, totalsY + 41, { width: 95, align: 'right' });

      // ── 5. Footer & Legal ──────────────────────────────────────────────────
      doc.fontSize(8).font('Helvetica-Oblique').fillColor('#94a3b8');
      doc.text(
        `Thank you for your business. This is an official electronic invoice generated by ${companyName}.`,
        40,
        740,
        { align: 'center', width: 515 }
      );
      doc.text(
        `Document Ref: ${invoice.invoiceNumber || invoice.invoiceId} • Page 1 of 1`,
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
