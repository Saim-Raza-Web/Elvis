import PDFDocument from 'pdfkit';

/**
 * Generates a standard logistics thermal shipping label (4x6 inch / 288x432 pt) in PDF format.
 *
 * @param {object} params
 * @param {string} params.carrierName - e.g. "CTT Express", "Correos España"
 * @param {string} params.carrierCode - e.g. "CTT", "CORREOS"
 * @param {string} params.serviceType - e.g. "PAQ 24", "EXPRESS 14H"
 * @param {string} params.trackingNumber - e.g. "CTT-ES-2026-000123"
 * @param {string} params.orderNumber - e.g. "ORD-2026-001"
 * @param {number} params.weightKg - parcel weight
 * @param {number} params.parcelIndex - parcel 1 of N
 * @param {number} params.totalParcels - total parcels
 * @param {object} params.sender - { name, address, city, postcode, country }
 * @param {object} params.recipient - { name, contact, street, city, postcode, province, country, phone }
 * @returns {Promise<Buffer>}
 */
export async function generateShippingLabelPDF({
  carrierName = 'CARRIER',
  carrierCode = 'CARRIER',
  serviceType = 'STANDARD 24H',
  trackingNumber,
  orderNumber = 'ORD-000',
  weightKg = 1.0,
  parcelIndex = 1,
  totalParcels = 1,
  sender = {},
  recipient = {},
  routingCode = ''
}) {
  return new Promise((resolve, reject) => {
    try {
      // 4 x 6 inch standard logistics label size: 288 pt wide x 432 pt high
      const doc = new PDFDocument({
        size: [288, 432],
        margins: { top: 12, bottom: 12, left: 12, right: 12 }
      });

      const chunks = [];
      doc.on('data', chunk => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', err => reject(err));

      // 1. Header Box: Carrier Name & Service
      doc.rect(12, 12, 264, 40).lineWidth(1.5).stroke('#000000');
      doc.font('Helvetica-Bold').fontSize(14).fillColor('#000000')
        .text(carrierName.toUpperCase(), 18, 18, { width: 150 });
      doc.font('Helvetica-Bold').fontSize(10).fillColor('#000000')
        .text(serviceType.toUpperCase(), 180, 18, { width: 90, align: 'right' });
      doc.font('Helvetica').fontSize(8).fillColor('#555555')
        .text(`PARCEL: ${parcelIndex} / ${totalParcels} | WT: ${weightKg.toFixed(2)} KG`, 18, 36, { width: 250 });

      // 2. Sender Section
      doc.rect(12, 56, 264, 44).lineWidth(0.5).stroke('#888888');
      doc.font('Helvetica-Bold').fontSize(7).fillColor('#666666')
        .text('REMITENTE / SENDER:', 16, 60);
      doc.font('Helvetica-Bold').fontSize(8).fillColor('#000000')
        .text(sender.name || 'House Logistic 3PL / Central Hub', 16, 70, { width: 250 });
      doc.font('Helvetica').fontSize(7).fillColor('#333333')
        .text(`${sender.address || 'Polígono Industrial Can Salvatella, Nave 4'} · ${sender.postcode || '08210'} ${sender.city || 'Barberà del Vallès'} (${sender.country || 'ES'})`, 16, 82, { width: 250 });

      // 3. Recipient Section (Large, High Contrast)
      doc.rect(12, 104, 264, 80).lineWidth(1.5).stroke('#000000');
      doc.font('Helvetica-Bold').fontSize(8).fillColor('#666666')
        .text('DESTINATARIO / DELIVER TO:', 16, 110);
      doc.font('Helvetica-Bold').fontSize(11).fillColor('#000000')
        .text(recipient.name || 'CLIENT NAME', 16, 122, { width: 250 });
      doc.font('Helvetica').fontSize(9).fillColor('#000000')
        .text(recipient.street || 'Street Address, Line 1', 16, 137, { width: 250 });
      doc.font('Helvetica-Bold').fontSize(11).fillColor('#000000')
        .text(`${recipient.postcode || '00000'} ${recipient.city || 'CITY'}`, 16, 151, { width: 250 });
      doc.font('Helvetica').fontSize(8).fillColor('#333333')
        .text(`${recipient.province || ''} ${recipient.country || 'ES'} ${recipient.phone ? `· TEL: ${recipient.phone}` : ''}`, 16, 167, { width: 250 });

      // 4. Routing Barcode Area
      doc.rect(12, 188, 264, 40).fillAndStroke('#f3f4f6', '#888888');
      doc.font('Helvetica-Bold').fontSize(14).fillColor('#000000')
        .text(routingCode || `${recipient.postcode ? recipient.postcode.slice(0, 2) : '08'}-${carrierCode}-HUB`, 18, 196, { align: 'center', width: 252 });
      doc.font('Helvetica').fontSize(7).fillColor('#555555')
        .text(`SORT ROUTE · ORDER: ${orderNumber}`, 18, 214, { align: 'center', width: 252 });

      // 5. Tracking Barcode Representation
      doc.rect(12, 234, 264, 130).lineWidth(1).stroke('#000000');
      doc.font('Helvetica-Bold').fontSize(8).fillColor('#000000')
        .text('TRACKING / NÚMERO DE SEGUIMIENTO:', 16, 240);
      doc.font('Courier-Bold').fontSize(13).fillColor('#000000')
        .text(trackingNumber, 16, 252, { align: 'center', width: 252 });

      // Draw simulated Code128 barcode lines
      const barcodeTop = 272;
      const barcodeHeight = 65;
      const barcodeLeft = 24;
      const totalWidth = 240;
      doc.rect(barcodeLeft - 4, barcodeTop - 4, totalWidth + 8, barcodeHeight + 8).fill('#ffffff');

      // Pseudo-random deterministic stripes based on tracking string
      let seed = 0;
      for (let i = 0; i < trackingNumber.length; i++) {
        seed += trackingNumber.charCodeAt(i);
      }

      let currentX = barcodeLeft;
      while (currentX < barcodeLeft + totalWidth - 6) {
        seed = (seed * 9301 + 49297) % 233280;
        const barWidth = (seed % 3) + 1; // 1 to 3 pt
        doc.rect(currentX, barcodeTop, barWidth, barcodeHeight).fill('#000000');
        seed = (seed * 9301 + 49297) % 233280;
        const spaceWidth = (seed % 3) + 1;
        currentX += barWidth + spaceWidth;
      }
      // Guard bars at start and end
      doc.rect(barcodeLeft, barcodeTop, 2, barcodeHeight).fill('#000000');
      doc.rect(barcodeLeft + totalWidth - 4, barcodeTop, 2, barcodeHeight).fill('#000000');

      // Text below barcode
      doc.font('Courier').fontSize(9).fillColor('#000000')
        .text(trackingNumber, 16, barcodeTop + barcodeHeight + 6, { align: 'center', width: 252 });

      // 6. Footer: Warehouse Origin & Timestamp
      doc.rect(12, 368, 264, 52).lineWidth(0.5).stroke('#888888');
      doc.font('Helvetica').fontSize(7).fillColor('#444444')
        .text(`WMS: Elvis 3PL House Logistic · DEPOSITARIO CENTRAL`, 16, 374);
      doc.font('Helvetica').fontSize(6).fillColor('#666666')
        .text(`LABEL CREATED: ${new Date().toISOString()} · AUTH ID: ${carrierCode}-OK`, 16, 386);
      doc.font('Helvetica-Bold').fontSize(7).fillColor('#000000')
        .text('FIRMA / FECHA DE ENTREGA:', 16, 400);

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

export const generateThermalShippingLabelPdf = generateShippingLabelPDF;

