/**
 * AEAT Service — VeriFactu + SII SOAP Integration
 * ─────────────────────────────────────────────────
 * Implements:
 *   1. AES-256-GCM certificate storage (existing, preserved)
 *   2. VeriFactu hash-chain generation (corrected canonical format)
 *   3. VeriFactu XML payload construction per AEAT specs (RD 1007/2023 / HAC/1177/2024)
 *   4. PFX/P12 certificate loading via node-forge
 *   5. XAdES-compatible TLS mutual-auth SOAP submission using cert as client cert
 *   6. AEAT SOAP response parsing
 *   7. Accepted / Rejected / Error state persistence
 *   8. SII XML payload construction + SOAP submission
 *
 * ENDPOINTS (from official AEAT documentation):
 *   VeriFactu Sandbox: https://prewww1.aeat.es/wlpl/TIKE-CONT/ws/SistemaFacturacion/VerifactuSOAP
 *   SII FE Sandbox:    https://prewww1.aeat.es/wlpl/SSII-FACT/ws/fe/SiiFactFEV1SOAP
 *   SII FR Sandbox:    https://prewww1.aeat.es/wlpl/SSII-FACT/ws/fr/SiiFactFRV1SOAP
 *
 * Required environment variables:
 *   AEAT_ENCRYPTION_KEY  — 64-char hex string (32 bytes) for AES-256-GCM storage encryption
 *   AEAT_SANDBOX         — "true" to target pre-production endpoints (recommended for dev/test)
 *
 * External dependencies installed:
 *   xmlbuilder2  — XML construction
 *   node-forge   — PFX parsing and PKCS#12 handling
 *   axios        — HTTPS SOAP transport
 */

import crypto from 'crypto';
import https from 'https';
import forge from 'node-forge';
import { create as xmlCreate } from 'xmlbuilder2';
import axios from 'axios';

import ComplianceConfig from '../models/ComplianceConfig.js';
import VeriFactuRecord from '../models/VeriFactuRecord.js';
import SIIRecord from '../models/SIIRecord.js';

// ── Constants ─────────────────────────────────────────────────────────────────

const VERIFACTU_SANDBOX_URL =
  'https://prewww1.aeat.es/wlpl/TIKE-CONT/ws/SistemaFacturacion/VerifactuSOAP';
const VERIFACTU_PROD_URL =
  'https://www1.agenciatributaria.gob.es/wlpl/TIKE-CONT/ws/SistemaFacturacion/VerifactuSOAP';

const SII_FE_SANDBOX_URL =
  'https://prewww1.aeat.es/wlpl/SSII-FACT/ws/fe/SiiFactFEV1SOAP';
const SII_FR_SANDBOX_URL =
  'https://prewww1.aeat.es/wlpl/SSII-FACT/ws/fr/SiiFactFRV1SOAP';
const SII_FE_PROD_URL =
  'https://www1.agenciatributaria.gob.es/wlpl/SSII-FACT/ws/fe/SiiFactFEV1SOAP';
const SII_FR_PROD_URL =
  'https://www1.agenciatributaria.gob.es/wlpl/SSII-FACT/ws/fr/SiiFactFRV1SOAP';

// ── Key derivation ────────────────────────────────────────────────────────────

function getEncryptionKey() {
  const raw = process.env.AEAT_ENCRYPTION_KEY || '';
  // Pad/truncate to exactly 64 hex chars (32 bytes)
  return Buffer.from(raw.padEnd(64, '0').slice(0, 64), 'hex');
}

// ── AES-256-GCM helpers ───────────────────────────────────────────────────────

function encryptBuffer(buffer) {
  const iv  = crypto.randomBytes(16);
  const key = getEncryptionKey();
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);

  const encrypted = Buffer.concat([cipher.update(buffer), cipher.final()]);
  const authTag   = cipher.getAuthTag();

  return {
    encrypted: encrypted.toString('base64'),
    iv: iv.toString('hex'),
    authTag: authTag.toString('hex'),
  };
}

function decryptToBuffer(encryptedBase64, ivHex, authTagHex) {
  const key     = getEncryptionKey();
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(authTagHex, 'hex'));

  return Buffer.concat([
    decipher.update(Buffer.from(encryptedBase64, 'base64')),
    decipher.final(),
  ]);
}

// ── Certificate loading ───────────────────────────────────────────────────────

/**
 * Decrypts stored PFX and password from ComplianceConfig.
 * Returns { pfxBuffer, password } or throws.
 */
function loadCertificateFromConfig(config) {
  if (!config || !config.certificatePfxEncrypted) {
    throw Object.assign(
      new Error('AEAT certificate not configured. Upload a PFX/P12 certificate via the Compliance settings.'),
      { code: 'NO_CERT' }
    );
  }

  const [pfxEnc, pfxTag]   = config.certificatePfxEncrypted.split(':');
  const [pwdEnc, pwdTag]   = config.certificatePasswordEncrypted.split(':');
  const iv                  = config.encryptionIv;

  const pfxBuffer  = decryptToBuffer(pfxEnc, iv, pfxTag);
  const pwdBuffer  = decryptToBuffer(pwdEnc, iv, pwdTag);
  const password   = pwdBuffer.toString('utf8');

  return { pfxBuffer, password };
}

/**
 * Parses a PFX buffer (using node-forge) and returns PEM key + cert strings.
 * These are used for TLS mutual authentication against AEAT.
 */
function parsePfx(pfxBuffer, password) {
  const pfxDer = forge.util.createBuffer(pfxBuffer.toString('binary'));
  const pfx    = forge.pkcs12.pkcs12FromAsn1(forge.asn1.fromDer(pfxDer), password);

  // Extract private key
  const keyBags  = pfx.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag });
  const keyBag   = keyBags[forge.pki.oids.pkcs8ShroudedKeyBag]?.[0];
  if (!keyBag?.key) throw new Error('No private key found in PFX certificate.');

  // Extract certificate
  const certBags = pfx.getBags({ bagType: forge.pki.oids.certBag });
  const certBag  = certBags[forge.pki.oids.certBag]?.[0];
  if (!certBag?.cert) throw new Error('No certificate found in PFX certificate.');

  const privateKeyPem = forge.pki.privateKeyToPem(keyBag.key);
  const certificatePem = forge.pki.certificateToPem(certBag.cert);

  // Extract NIF from CN if present (e.g. "CN=A12345678 - EMPRESA SL")
  const cnField = certBag.cert.subject.getField('CN')?.value || '';
  const nifMatch = cnField.match(/^([A-Z0-9]{9})/);
  const nif = nifMatch ? nifMatch[1] : '';

  return { privateKeyPem, certificatePem, nif };
}

// ── SOAP transmission helper ──────────────────────────────────────────────────

/**
 * Sends a raw SOAP envelope to an AEAT endpoint using TLS mutual auth.
 * @param {string} url             — AEAT SOAP endpoint
 * @param {string} soapAction      — SOAPAction header value
 * @param {string} soapEnvelope    — Complete SOAP XML string
 * @param {string} privateKeyPem   — PEM private key for mTLS
 * @param {string} certificatePem  — PEM certificate for mTLS
 * @returns {string} raw XML response body
 */
async function sendSoapRequest(url, soapAction, soapEnvelope, privateKeyPem, certificatePem) {
  const httpsAgent = new https.Agent({
    key:  privateKeyPem,
    cert: certificatePem,
    // Allow AEAT pre-production servers which use their own CA
    rejectUnauthorized: process.env.AEAT_SANDBOX === 'true' ? false : true,
  });

  const response = await axios.post(url, soapEnvelope, {
    httpsAgent,
    timeout: 30_000,
    headers: {
      'Content-Type': 'text/xml; charset=utf-8',
      'SOAPAction':   soapAction,
    },
    // Return raw string so we can parse SOAP XML
    responseType: 'text',
  });

  return response.data;
}

// ── SOAP response parsing ─────────────────────────────────────────────────────

/**
 * Minimal parser for AEAT SOAP responses.
 * Returns { accepted: boolean, csv: string, errors: string[], rawXml: string }
 *
 * AEAT returns either:
 *   <EstadoEnvio>Correcto</EstadoEnvio>  → accepted
 *   <EstadoEnvio>Incorrecto</EstadoEnvio> with <CodigoErrorRegistro> → rejected
 */
function parseSoapResponse(rawXml) {
  const csvMatch    = rawXml.match(/<CSV>(.*?)<\/CSV>/);
  const estadoMatch = rawXml.match(/<EstadoEnvio>(.*?)<\/EstadoEnvio>/);
  const errMatches  = [...rawXml.matchAll(/<DescripcionErrorRegistro>(.*?)<\/DescripcionErrorRegistro>/g)];
  const codeMatches = [...rawXml.matchAll(/<CodigoErrorRegistro>(.*?)<\/CodigoErrorRegistro>/g)];

  const estado  = estadoMatch ? estadoMatch[1].trim() : '';
  const accepted = estado === 'Correcto';
  const csv      = csvMatch ? csvMatch[1].trim() : '';

  const errors = [];
  errMatches.forEach((m, i) => {
    const code = codeMatches[i] ? codeMatches[i][1].trim() : '';
    errors.push(code ? `[${code}] ${m[1].trim()}` : m[1].trim());
  });

  return { accepted, csv, estado, errors, rawXml };
}

// ── VeriFactu hash generation ─────────────────────────────────────────────────

/**
 * Generates the VeriFactu hash according to RD 1007/2023 / HAC/1177/2024.
 *
 * Canonical string format (from AEAT spec):
 *   IDEmisorFactura + "|" + NumSerieFactura + "|" + FechaExpedicionFactura +
 *   "|" + TipoFactura + "|" + CuotaTotal + "|" + ImporteTotal + "|" + Huella anterior
 *
 * All values trimmed, date in DD-MM-YYYY format.
 */
async function generateVeriFactuHash(companyId, invoiceData) {
  // Find previous record for chaining (sorted by creation, most recent last)
  const previousRecord = await VeriFactuRecord.findOne({
    company:    companyId,
    recordType: invoiceData.recordType || 'ISSUED',
    status:     { $in: ['PENDING', 'SUBMITTED', 'ACCEPTED'] },
  }).sort({ createdAt: -1 });

  const previousHash = previousRecord?.currentHash || '';

  // Date must be DD-MM-YYYY per AEAT spec
  const dateStr = invoiceData.date
    ? String(invoiceData.date).replace(/^(\d{4})-(\d{2})-(\d{2}).*/, '$3-$2-$1')
    : new Date().toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' }).replace(/\//g, '-');

  const canonicalString = [
    invoiceData.issuerNif || '',
    invoiceData.invoiceNumber || '',
    dateStr,
    invoiceData.type || 'F1',
    Number(invoiceData.taxAmount || 0).toFixed(2),
    Number(invoiceData.totalAmount || 0).toFixed(2),
    previousHash,
  ].join('|');

  const hash = crypto.createHash('sha256').update(canonicalString, 'utf8').digest('hex').toUpperCase();

  return { hash, canonicalString, previousHash };
}

// ── VeriFactu XML builder ─────────────────────────────────────────────────────

/**
 * Builds the SOAP envelope for VeriFactu SuministroLRFacturasEmitidas.
 * Based on official AEAT XSD:
 *   https://www2.agenciatributaria.gob.es/static_files/common/internet/dep/aplicaciones/es/aeat/tike/cont/ws/SuministroLR.xsd
 */
function buildVeriFactuSoapEnvelope(record, issuerNif, issuerName) {
  const issueDate = new Date(record.issueDate);
  // AEAT date: DD-MM-YYYY
  const dateDDMMYYYY = `${String(issueDate.getDate()).padStart(2, '0')}-${String(issueDate.getMonth() + 1).padStart(2, '0')}-${issueDate.getFullYear()}`;

  const root = xmlCreate({ version: '1.0', encoding: 'UTF-8' })
    .ele('soapenv:Envelope', {
      'xmlns:soapenv': 'http://schemas.xmlsoap.org/soap/envelope/',
      'xmlns:sum':     'https://www2.agenciatributaria.gob.es/static_files/common/internet/dep/aplicaciones/es/aeat/tike/cont/ws/SuministroLR.xsd',
      'xmlns:sf':      'https://www2.agenciatributaria.gob.es/static_files/common/internet/dep/aplicaciones/es/aeat/tike/cont/ws/SuministroInformacion.xsd',
    })
      .ele('soapenv:Header').up()
      .ele('soapenv:Body')
        .ele('sum:SuministroLRFacturasEmitidas')
          .ele('sum:Cabecera')
            .ele('sf:IDVersion').txt('1.0').up()
            .ele('sf:Titular')
              .ele('sf:NombreRazon').txt(issuerName).up()
              .ele('sf:NIF').txt(issuerNif).up()
            .up()
            .ele('sf:TipoEnvio').txt('A').up() // A = Alta (new submission)
          .up()
          .ele('sum:RegistroFacturacion')
            .ele('sum:IDFactura')
              .ele('sum:IDEmisorFactura').txt(issuerNif).up()
              .ele('sum:NumSerieFactura').txt(record.invoiceNumber).up()
              .ele('sum:FechaExpedicionFactura').txt(dateDDMMYYYY).up()
            .up()
            .ele('sum:DatosFactura')
              .ele('sum:TipoFactura').txt('F1').up() // F1 = standard invoice
              .ele('sum:DescripcionOperacion').txt('Prestación de servicios / Venta de bienes').up()
              .ele('sum:ImporteTotal').txt(Number(record.totalAmount).toFixed(2)).up()
            .up()
            .ele('sum:DatosAdicionalesFactura')
              .ele('sum:Huella').txt(record.currentHash).up()
              .ele('sum:FechaHoraHusoGenRegistro')
                .txt(new Date().toISOString().replace('T', ' ').replace('Z', '+00:00')).up()
            .up()
          .up()
        .up()
      .up()
    .up();

  return root.end({ prettyPrint: false });
}

// ── VeriFactu submission ──────────────────────────────────────────────────────

async function submitVeriFactu(companyId, recordId) {
  const config = await ComplianceConfig.findOne({ company: companyId });
  const record  = await VeriFactuRecord.findOne({ _id: recordId, company: companyId });

  if (!record) throw new Error('VeriFactuRecord not found');

  // Guard: only submit PENDING/ERROR records
  if (record.status === 'ACCEPTED') {
    return record; // already accepted, idempotent
  }

  // 1. Load certificate
  let privateKeyPem, certificatePem, nif;
  try {
    const { pfxBuffer, password } = loadCertificateFromConfig(config);
    ({ privateKeyPem, certificatePem, nif } = parsePfx(pfxBuffer, password));
  } catch (certErr) {
    record.status     = 'ERROR';
    record.lastError  = certErr.message;
    record.retryCount = (record.retryCount || 0) + 1;
    await record.save();
    throw certErr;
  }

  const isSandbox = process.env.AEAT_SANDBOX !== 'false'; // default to sandbox
  const endpoint  = isSandbox ? VERIFACTU_SANDBOX_URL : VERIFACTU_PROD_URL;
  const issuerNif  = nif || record.issuerTaxId;
  const issuerName = 'EMPRESA CONTRIBUYENTE'; // In production derive from Company profile

  // 2. Build SOAP XML
  const soapEnvelope = buildVeriFactuSoapEnvelope(record, issuerNif, issuerName);

  // 3. Mark as submitting
  record.status              = 'SUBMITTING';
  record.submissionTimestamp = new Date();
  await record.save();

  // 4. Send SOAP request
  let rawResponse;
  try {
    rawResponse = await sendSoapRequest(
      endpoint,
      'SuministroLRFacturasEmitidas',
      soapEnvelope,
      privateKeyPem,
      certificatePem
    );
  } catch (httpErr) {
    record.status    = 'ERROR';
    record.lastError = `HTTPS error: ${httpErr.message}`;
    record.retryCount++;
    record.aeatRawResponse = null;
    await record.save();
    throw Object.assign(new Error(`AEAT transmission failed: ${httpErr.message}`), { code: 'AEAT_HTTP_ERROR' });
  }

  // 5. Parse response
  const parsed = parseSoapResponse(rawResponse);
  record.aeatRawResponse       = rawResponse.slice(0, 4000); // trim very long XML
  record.aeatResponseCode       = parsed.csv || parsed.estado;
  record.aeatResponseDescription = parsed.errors.join('; ') || parsed.estado;

  if (parsed.accepted) {
    record.status = 'ACCEPTED';
    record.lastError = '';
  } else {
    record.status = 'REJECTED';
    record.lastError = parsed.errors.join('; ') || 'AEAT rejected the submission';
    record.retryCount++;
  }

  await record.save();
  return record;
}

// ── SII XML builders ──────────────────────────────────────────────────────────

/**
 * Builds the SII SOAP envelope for FacturasEmitidas (issued invoices).
 * Based on official AEAT SII XSD / WSDL.
 */
function buildSiiFeSoapEnvelope(siiRecord, issuerNif, issuerName) {
  const invoiceDate = new Date(siiRecord.invoiceDate);
  const dateDDMMYYYY = `${String(invoiceDate.getDate()).padStart(2, '0')}-${String(invoiceDate.getMonth() + 1).padStart(2, '0')}-${invoiceDate.getFullYear()}`;

  // Tax period: YYYY/MM
  const [year, month] = (siiRecord.taxPeriod || '').split('-');
  const ejercicio = year || String(new Date().getFullYear());
  const periodo   = month || '01';

  const vatRate = siiRecord.taxAmount && siiRecord.taxBase
    ? Math.round((siiRecord.taxAmount / siiRecord.taxBase) * 100)
    : 21;

  const root = xmlCreate({ version: '1.0', encoding: 'UTF-8' })
    .ele('soapenv:Envelope', {
      'xmlns:soapenv': 'http://schemas.xmlsoap.org/soap/envelope/',
      'xmlns:siiRL':   'https://www2.agenciatributaria.gob.es/static_files/common/internet/dep/aplicaciones/es/aeat/ssii/fact/ws/SuministroLR.xsd',
      'xmlns:siiRI':   'https://www2.agenciatributaria.gob.es/static_files/common/internet/dep/aplicaciones/es/aeat/ssii/fact/ws/SuministroInformacion.xsd',
    })
      .ele('soapenv:Header').up()
      .ele('soapenv:Body')
        .ele('siiRL:SuministroLRFacturasEmitidas')
          .ele('siiRI:Cabecera')
            .ele('siiRI:IDVersion').txt('1.1').up()
            .ele('siiRI:Titular')
              .ele('siiRI:NombreRazon').txt(issuerName).up()
              .ele('siiRI:NIF').txt(issuerNif).up()
            .up()
            .ele('siiRI:TipoComunicacion').txt('A0').up() // A0 = Alta (new)
          .up()
          .ele('siiRL:RegistroLRFacturasEmitidas')
            .ele('siiRL:PeriodoLiquidacion')
              .ele('siiRI:Ejercicio').txt(ejercicio).up()
              .ele('siiRI:Periodo').txt(periodo).up()
            .up()
            .ele('siiRL:IDFactura')
              .ele('siiRI:IDEmisorFactura')
                .ele('siiRI:NIF').txt(issuerNif).up()
              .up()
              .ele('siiRI:NumSerieFacturaEmisor').txt(siiRecord.invoiceNumber).up()
              .ele('siiRI:FechaExpedicionFacturaEmisor').txt(dateDDMMYYYY).up()
            .up()
            .ele('siiRL:FacturaExpedida')
              .ele('siiRI:TipoFactura').txt('F1').up()
              .ele('siiRI:ClaveRegimenEspecialOTrascendencia').txt('01').up()
              .ele('siiRI:ImporteTotal').txt(Number(siiRecord.totalAmount).toFixed(2)).up()
              .ele('siiRI:DescripcionOperacion').txt('Prestación de servicios / Venta de bienes').up()
              .ele('siiRL:Contraparte')
                .ele('siiRI:NombreRazon').txt(siiRecord.counterpartyName).up()
                .ele('siiRI:NIF').txt(siiRecord.counterpartyTaxId).up()
              .up()
              .ele('siiRL:TipoDesglose')
                .ele('siiRL:DesgloseFactura')
                  .ele('siiRL:Sujeta')
                    .ele('siiRL:NoExenta')
                      .ele('siiRI:TipoNoExenta').txt('S1').up()
                      .ele('siiRL:DesgloseIVA')
                        .ele('siiRL:DetalleIVA')
                          .ele('siiRI:TipoImpositivo').txt(String(vatRate)).up()
                          .ele('siiRI:BaseImponible').txt(Number(siiRecord.taxBase).toFixed(2)).up()
                          .ele('siiRI:CuotaRepercutida').txt(Number(siiRecord.taxAmount).toFixed(2)).up()
                        .up()
                      .up()
                    .up()
                  .up()
                .up()
              .up()
            .up()
          .up()
        .up()
      .up()
    .up();

  return root.end({ prettyPrint: false });
}

/**
 * Builds the SII SOAP envelope for FacturasRecibidas (received supplier bills).
 */
function buildSiiFrSoapEnvelope(siiRecord, issuerNif, issuerName) {
  const invoiceDate = new Date(siiRecord.invoiceDate);
  const dateDDMMYYYY = `${String(invoiceDate.getDate()).padStart(2, '0')}-${String(invoiceDate.getMonth() + 1).padStart(2, '0')}-${invoiceDate.getFullYear()}`;

  const [year, month] = (siiRecord.taxPeriod || '').split('-');
  const ejercicio = year || String(new Date().getFullYear());
  const periodo   = month || '01';

  const vatRate = siiRecord.taxAmount && siiRecord.taxBase
    ? Math.round((siiRecord.taxAmount / siiRecord.taxBase) * 100)
    : 21;

  const root = xmlCreate({ version: '1.0', encoding: 'UTF-8' })
    .ele('soapenv:Envelope', {
      'xmlns:soapenv': 'http://schemas.xmlsoap.org/soap/envelope/',
      'xmlns:siiRL':   'https://www2.agenciatributaria.gob.es/static_files/common/internet/dep/aplicaciones/es/aeat/ssii/fact/ws/SuministroLR.xsd',
      'xmlns:siiRI':   'https://www2.agenciatributaria.gob.es/static_files/common/internet/dep/aplicaciones/es/aeat/ssii/fact/ws/SuministroInformacion.xsd',
    })
      .ele('soapenv:Header').up()
      .ele('soapenv:Body')
        .ele('siiRL:SuministroLRFacturasRecibidas')
          .ele('siiRI:Cabecera')
            .ele('siiRI:IDVersion').txt('1.1').up()
            .ele('siiRI:Titular')
              .ele('siiRI:NombreRazon').txt(issuerName).up()
              .ele('siiRI:NIF').txt(issuerNif).up()
            .up()
            .ele('siiRI:TipoComunicacion').txt('A0').up()
          .up()
          .ele('siiRL:RegistroLRFacturasRecibidas')
            .ele('siiRL:PeriodoLiquidacion')
              .ele('siiRI:Ejercicio').txt(ejercicio).up()
              .ele('siiRI:Periodo').txt(periodo).up()
            .up()
            .ele('siiRL:IDFactura')
              .ele('siiRI:IDEmisorFacturaRecibida')
                .ele('siiRI:NIF').txt(siiRecord.counterpartyTaxId).up()
              .up()
              .ele('siiRI:NumSerieFacturaEmisor').txt(siiRecord.invoiceNumber).up()
              .ele('siiRI:FechaExpedicionFacturaEmisor').txt(dateDDMMYYYY).up()
            .up()
            .ele('siiRL:FacturaRecibida')
              .ele('siiRI:TipoFactura').txt('F1').up()
              .ele('siiRI:ClaveRegimenEspecialOTrascendencia').txt('01').up()
              .ele('siiRI:ImporteTotal').txt(Number(siiRecord.totalAmount).toFixed(2)).up()
              .ele('siiRI:DescripcionOperacion').txt('Compra de bienes / Servicios recibidos').up()
              .ele('siiRI:Contraparte')
                .ele('siiRI:NombreRazon').txt(siiRecord.counterpartyName).up()
                .ele('siiRI:NIF').txt(siiRecord.counterpartyTaxId).up()
              .up()
              .ele('siiRL:DesgloseFactura')
                .ele('siiRL:InversionSujetoPasivo').txt('N').up()
                .ele('siiRL:DesgloseIVA')
                  .ele('siiRL:DetalleIVA')
                    .ele('siiRI:TipoImpositivo').txt(String(vatRate)).up()
                    .ele('siiRI:BaseImponible').txt(Number(siiRecord.taxBase).toFixed(2)).up()
                    .ele('siiRI:CuotaSoportada').txt(Number(siiRecord.taxAmount).toFixed(2)).up()
                  .up()
                .up()
              .up()
              .ele('siiRL:FechaRegContable').txt(dateDDMMYYYY).up()
            .up()
          .up()
        .up()
      .up()
    .up();

  return root.end({ prettyPrint: false });
}

// ── SII submission ────────────────────────────────────────────────────────────

async function submitSiiRecord(companyId, siiRecordId) {
  const config    = await ComplianceConfig.findOne({ company: companyId });
  const siiRecord  = await SIIRecord.findOne({ _id: siiRecordId, company: companyId });

  if (!siiRecord) throw new Error('SIIRecord not found');
  if (siiRecord.status === 'ACCEPTED') return siiRecord; // idempotent

  // 1. Load certificate
  let privateKeyPem, certificatePem, nif;
  try {
    const { pfxBuffer, password } = loadCertificateFromConfig(config);
    ({ privateKeyPem, certificatePem, nif } = parsePfx(pfxBuffer, password));
  } catch (certErr) {
    siiRecord.status    = 'ERROR';
    siiRecord.lastError = certErr.message;
    siiRecord.retryCount++;
    await siiRecord.save();
    throw certErr;
  }

  const isSandbox  = process.env.AEAT_SANDBOX !== 'false';
  const isIssued   = siiRecord.recordType === 'ISSUED';
  const endpoint   = isIssued
    ? (isSandbox ? SII_FE_SANDBOX_URL : SII_FE_PROD_URL)
    : (isSandbox ? SII_FR_SANDBOX_URL : SII_FR_PROD_URL);

  const soapAction = isIssued
    ? 'SuministroLRFacturasEmitidas'
    : 'SuministroLRFacturasRecibidas';

  const issuerNif  = nif || 'B00000000';
  const issuerName = 'EMPRESA CONTRIBUYENTE';

  // 2. Build SOAP XML
  const soapEnvelope = isIssued
    ? buildSiiFeSoapEnvelope(siiRecord, issuerNif, issuerName)
    : buildSiiFrSoapEnvelope(siiRecord, issuerNif, issuerName);

  // 3. Mark submitting
  siiRecord.status              = 'SUBMITTING';
  siiRecord.submissionTimestamp = new Date();
  await siiRecord.save();

  // 4. Send
  let rawResponse;
  try {
    rawResponse = await sendSoapRequest(endpoint, soapAction, soapEnvelope, privateKeyPem, certificatePem);
  } catch (httpErr) {
    siiRecord.status    = 'ERROR';
    siiRecord.lastError = `HTTPS error: ${httpErr.message}`;
    siiRecord.retryCount++;
    await siiRecord.save();
    throw Object.assign(new Error(`SII transmission failed: ${httpErr.message}`), { code: 'SII_HTTP_ERROR' });
  }

  // 5. Parse
  const parsed = parseSoapResponse(rawResponse);
  siiRecord.aeatRawResponse       = rawResponse.slice(0, 4000);
  siiRecord.aeatResponseCode       = parsed.csv || parsed.estado;
  siiRecord.aeatResponseDescription = parsed.errors.join('; ') || parsed.estado;

  if (parsed.accepted) {
    siiRecord.status    = 'ACCEPTED';
    siiRecord.lastError = '';
  } else {
    siiRecord.status    = 'REJECTED';
    siiRecord.lastError = parsed.errors.join('; ') || 'AEAT SII rejected submission';
    siiRecord.retryCount++;
  }

  await siiRecord.save();
  return siiRecord;
}

// ── Public aeatService export ─────────────────────────────────────────────────

export const aeatService = {
  // ── Certificate management ───────────────────────────────────────
  encryptBuffer,
  decryptToBuffer,

  saveCertificate: async (companyId, pfxBuffer, password) => {
    // Validate PFX is parseable before storing
    try {
      parsePfx(pfxBuffer, password);
    } catch (parseErr) {
      throw new Error(`Invalid PFX certificate or wrong password: ${parseErr.message}`);
    }

    const encryptedPfx      = encryptBuffer(pfxBuffer);
    const encryptedPassword = encryptBuffer(Buffer.from(password, 'utf8'));

    let config = await ComplianceConfig.findOne({ company: companyId });
    if (!config) config = new ComplianceConfig({ company: companyId });

    config.encryptionIv               = encryptedPfx.iv;
    config.certificatePfxEncrypted     = encryptedPfx.encrypted + ':' + encryptedPfx.authTag;
    config.certificatePasswordEncrypted = encryptedPassword.encrypted + ':' + encryptedPassword.authTag;

    // Parse certificate metadata
    const { nif } = parsePfx(pfxBuffer, password);
    const pfxDer   = forge.util.createBuffer(pfxBuffer.toString('binary'));
    const pfxObj   = forge.pkcs12.pkcs12FromAsn1(forge.asn1.fromDer(pfxDer), password);
    const certBags  = pfxObj.getBags({ bagType: forge.pki.oids.certBag });
    const certBag   = certBags[forge.pki.oids.certBag]?.[0];
    if (certBag?.cert) {
      const validity = certBag.cert.validity;
      config.certificateExpiry  = validity.notAfter;
      config.certificateSubject = certBag.cert.subject.getField('CN')?.value || nif || 'UNKNOWN';
    }

    await config.save();
    return config;
  },

  // ── VeriFactu ────────────────────────────────────────────────────
  generateVeriFactuHash,
  submitVeriFactu,

  // ── SII ──────────────────────────────────────────────────────────
  submitSiiRecord,

  // ── Exposed for testing ──────────────────────────────────────────
  _parseSoapResponse: parseSoapResponse,
  _buildVeriFactuSoapEnvelope: buildVeriFactuSoapEnvelope,
  _buildSiiFeSoapEnvelope: buildSiiFeSoapEnvelope,
  _buildSiiFrSoapEnvelope: buildSiiFrSoapEnvelope,
  _parsePfx: parsePfx,
};
