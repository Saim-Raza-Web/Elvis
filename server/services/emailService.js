/**
 * Email Dispatch Service
 * ─────────────────────
 * Real SMTP delivery via Nodemailer.
 *
 * Required environment variables:
 *   SMTP_HOST       — mail server hostname  (e.g. smtp.sendgrid.net)
 *   SMTP_PORT       — port (defaults to 587)
 *   SMTP_USER       — SMTP username / API key
 *   SMTP_PASSWORD   — SMTP password / API key value
 *   SMTP_FROM       — From address (e.g. "Elvis ERP <noreply@elvis.es>")
 *   SMTP_SECURE     — "true" for port 465 (TLS), omit for STARTTLS (587)
 *
 * When SMTP_HOST is not configured the functions throw an explicit
 * SMTP_NOT_CONFIGURED error rather than returning fake success.
 */

import nodemailer from 'nodemailer';

// ── Helpers ──────────────────────────────────────────────────────────────────

export function isValidEmail(email) {
  if (!email || typeof email !== 'string') return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

/**
 * Creates (and caches per-process) a Nodemailer transporter.
 * Throws SMTP_NOT_CONFIGURED if SMTP_HOST is absent.
 */
let _transporter = null;

function getTransporter() {
  if (_transporter) return _transporter;

  const host = process.env.SMTP_HOST;
  if (!host) {
    throw Object.assign(
      new Error(
        'SMTP is not configured. Set SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD, and SMTP_FROM ' +
        'environment variables to enable real email delivery.'
      ),
      { code: 'SMTP_NOT_CONFIGURED' }
    );
  }

  const port   = parseInt(process.env.SMTP_PORT || '587', 10);
  const secure = process.env.SMTP_SECURE === 'true'; // true → TLS (465), false → STARTTLS

  _transporter = nodemailer.createTransport({
    host,
    port,
    secure,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASSWORD,
    },
    // 30-second timeout — avoids silent hang on network issues
    connectionTimeout: 30_000,
    socketTimeout: 30_000,
  });

  return _transporter;
}

// Expose for testing so tests can override
export function _resetTransporter() {
  _transporter = null;
}

// ── sendInvoiceEmail ─────────────────────────────────────────────────────────

/**
 * Sends a commercial invoice PDF to a customer via SMTP.
 *
 * @returns {object} dispatch record containing messageId, recipient, timestamp
 * @throws  when validation fails or SMTP delivery fails
 */
export async function sendInvoiceEmail({
  to,
  invoiceNumber,
  customerName,
  grandTotal,
  currency = 'EUR',
  pdfBuffer,
  companyName = 'Elvis Logistics S.L.',
}) {
  // 1. Validation
  if (!to || !to.trim()) throw new Error('Recipient email address is required.');
  const cleanEmail = to.trim().toLowerCase();
  if (!isValidEmail(cleanEmail))
    throw new Error(`Invalid recipient email address: '${cleanEmail}'.`);

  if (!pdfBuffer || !(pdfBuffer instanceof Buffer) || pdfBuffer.length === 0)
    throw new Error('Invoice PDF attachment is missing or empty.');

  if (!invoiceNumber) throw new Error('invoiceNumber is required.');

  // 2. Build transport (throws SMTP_NOT_CONFIGURED if env absent)
  const transporter = getTransporter();
  const fromAddress = process.env.SMTP_FROM || `"${companyName}" <noreply@elvis.es>`;
  const currSymbol  = currency === 'USD' ? '$' : '€';

  const mailOptions = {
    from: fromAddress,
    to: cleanEmail,
    subject: `Commercial Invoice ${invoiceNumber} from ${companyName}`,
    text: [
      `Dear ${customerName || 'Valued Customer'},`,
      '',
      `Please find attached Commercial Invoice ${invoiceNumber}`,
      `for the total amount of ${currSymbol}${Number(grandTotal).toFixed(2)}.`,
      '',
      `Best regards,`,
      companyName,
    ].join('\n'),
    html: `<p>Dear <strong>${customerName || 'Valued Customer'}</strong>,</p>
<p>Please find attached <strong>Commercial Invoice ${invoiceNumber}</strong>
for the total amount of <strong>${currSymbol}${Number(grandTotal).toFixed(2)}</strong>.</p>
<p>Best regards,<br/>${companyName}</p>`,
    attachments: [
      {
        filename: `Invoice-${invoiceNumber}.pdf`,
        content: pdfBuffer,
        contentType: 'application/pdf',
      },
    ],
  };

  // 3. Real SMTP delivery
  let info;
  try {
    info = await transporter.sendMail(mailOptions);
  } catch (smtpErr) {
    // Wrap with clear context for upstream error handling
    throw Object.assign(
      new Error(`SMTP Delivery Error: ${smtpErr.message}`),
      { code: 'SMTP_DELIVERY_FAILED', cause: smtpErr }
    );
  }

  const dispatchRecord = {
    success: true,
    messageId: info.messageId,
    recipient: cleanEmail,
    subject: mailOptions.subject,
    pdfAttached: true,
    pdfSize: pdfBuffer.length,
    timestamp: new Date(),
    smtpResponse: info.response,
  };

  console.log(
    `[EMAIL SERVICE] Invoice ${invoiceNumber} dispatched to ${cleanEmail} ` +
    `(messageId: ${info.messageId})`
  );

  return dispatchRecord;
}

// ── sendPurchaseOrderEmail ───────────────────────────────────────────────────

/**
 * Sends a Purchase Order PDF to a supplier via SMTP.
 *
 * @returns {object} dispatch record containing messageId, recipient, timestamp
 * @throws  when validation fails or SMTP delivery fails
 */
export async function sendPurchaseOrderEmail({
  to,
  poNumber,
  supplierName,
  grandTotal,
  currency = 'EUR',
  pdfBuffer,
  companyName = 'Elvis Logistics S.L.',
}) {
  // 1. Validation
  if (!to || !to.trim()) throw new Error('Recipient email address is required.');
  const cleanEmail = to.trim().toLowerCase();
  if (!isValidEmail(cleanEmail))
    throw new Error(`Invalid recipient email address: '${cleanEmail}'.`);

  if (!pdfBuffer || !(pdfBuffer instanceof Buffer) || pdfBuffer.length === 0)
    throw new Error('Purchase Order PDF attachment is missing or empty.');

  if (!poNumber) throw new Error('poNumber is required.');

  // 2. Build transport
  const transporter = getTransporter();
  const fromAddress = process.env.SMTP_FROM || `"${companyName}" <noreply@elvis.es>`;
  const currSymbol  = currency === 'USD' ? '$' : '€';

  const mailOptions = {
    from: fromAddress,
    to: cleanEmail,
    subject: `New Purchase Order ${poNumber} from ${companyName}`,
    text: [
      `Dear ${supplierName || 'Supplier'},`,
      '',
      `Please find attached Purchase Order ${poNumber}`,
      `for the total amount of ${currSymbol}${Number(grandTotal).toFixed(2)}.`,
      '',
      `Please confirm receipt and expected delivery date.`,
      '',
      `Best regards,`,
      companyName,
    ].join('\n'),
    html: `<p>Dear <strong>${supplierName || 'Supplier'}</strong>,</p>
<p>Please find attached <strong>Purchase Order ${poNumber}</strong>
for the total amount of <strong>${currSymbol}${Number(grandTotal).toFixed(2)}</strong>.</p>
<p>Please confirm receipt and expected delivery date.</p>
<p>Best regards,<br/>${companyName}</p>`,
    attachments: [
      {
        filename: `PurchaseOrder-${poNumber}.pdf`,
        content: pdfBuffer,
        contentType: 'application/pdf',
      },
    ],
  };

  // 3. Real SMTP delivery
  let info;
  try {
    info = await transporter.sendMail(mailOptions);
  } catch (smtpErr) {
    throw Object.assign(
      new Error(`SMTP Delivery Error: ${smtpErr.message}`),
      { code: 'SMTP_DELIVERY_FAILED', cause: smtpErr }
    );
  }

  const dispatchRecord = {
    success: true,
    messageId: info.messageId,
    recipient: cleanEmail,
    subject: mailOptions.subject,
    pdfAttached: true,
    pdfSize: pdfBuffer.length,
    timestamp: new Date(),
    smtpResponse: info.response,
  };

  console.log(
    `[EMAIL SERVICE] PO ${poNumber} dispatched to ${cleanEmail} ` +
    `(messageId: ${info.messageId})`
  );

  return dispatchRecord;
}
