import mongoose from 'mongoose';
import EdiInterchange from '../../models/EdiInterchange.js';
import Order from '../../models/Order.js';
import Product from '../../models/Product.js';
import Shipment from '../../models/Shipment.js';
import Client from '../../models/Client.js';
import { EdifactOrdersParser } from './EdifactOrdersParser.js';
import { X12OrdersParser } from './X12OrdersParser.js';
import { DesadvGenerator } from './DesadvGenerator.js';
import { defaultSftpAdapter } from './SftpAdapter.js';

export class EdiManager {
  /**
   * Ingest raw EDI message, validate, normalize, and create order with quarantine support
   * @param {Object} options
   * @param {string} options.rawPayload Raw EDI text
   * @param {string|mongoose.Types.ObjectId} options.companyId Company context
   * @param {string} [options.clientName] Authoritative client/owner override
   * @param {string} [options.standardHint] 'EDIFACT' | 'X12'
   * @returns {Promise<{ interchange: Object, order?: Object, status: string }>}
   */
  static async ingestMessage({ rawPayload, companyId, clientName = null, standardHint = null }) {
    if (!rawPayload || typeof rawPayload !== 'string') {
      throw new Error('Raw payload string is required');
    }
    if (!companyId) {
      throw new Error('Company ID context is required');
    }

    const trimmed = rawPayload.trim();

    // 1. Detect standard
    let standard = standardHint;
    if (!standard) {
      if (trimmed.startsWith('UNA') || trimmed.startsWith('UNB')) {
        standard = 'EDIFACT';
      } else if (trimmed.startsWith('ISA')) {
        standard = 'X12';
      } else {
        standard = 'EDIFACT'; // default fallback
      }
    }

    let parsed = null;
    let parseError = null;

    try {
      if (standard === 'EDIFACT') {
        parsed = EdifactOrdersParser.parse(trimmed);
      } else if (standard === 'X12') {
        parsed = X12OrdersParser.parse(trimmed);
      } else {
        throw new Error(`Unsupported EDI standard: ${standard}`);
      }
    } catch (err) {
      parseError = err;
    }

    const controlRef = parsed?.interchangeControlRef || `UNREF-${Date.now()}`;
    const senderId = parsed?.senderId || 'UNKNOWN_SENDER';
    const recipientId = parsed?.recipientId || 'ELVIS_WMS';

    // 2. Idempotency check: see if interchange already exists
    let interchange = await EdiInterchange.findOne({
      company: companyId,
      interchangeControlRef: controlRef,
      senderId
    });

    if (interchange && (interchange.status === 'PROCESSED' || interchange.status === 'ALREADY_PROCESSED')) {
      const existingOrder = interchange.targetOrderId
        ? await Order.findById(interchange.targetOrderId)
        : null;
      return {
        interchange,
        interchangeId: interchange._id,
        interchangeRef: interchange.interchangeControlRef,
        order: existingOrder,
        createdOrdersCount: 0,
        status: 'PROCESSED',
        isDuplicate: true,
        message: 'Interchange already processed'
      };
    }

    // 3. Handle parsing failure -> QUARANTINE / ERROR
    if (parseError) {
      if (!interchange) {
        interchange = await EdiInterchange.create({
          company: companyId,
          interchangeControlRef: controlRef,
          senderId,
          recipientId,
          direction: 'INBOUND',
          standard,
          documentType: 'ORDERS',
          rawPayload: trimmed,
          status: 'ERROR',
          errors: [parseError.message],
          errorMessage: parseError.message,
          errorStack: parseError.stack
        });
      } else {
        interchange.status = 'ERROR';
        interchange.errors = [parseError.message];
        interchange.errorMessage = parseError.message;
        interchange.errorStack = parseError.stack;
        interchange.retryCount += 1;
        await interchange.save();
      }

      return {
        interchange,
        interchangeId: interchange._id,
        interchangeRef: interchange.interchangeControlRef,
        status: 'ERROR',
        quarantined: true,
        error: parseError.message
      };
    }

    // 4. Resolve Owner / Client
    let effectiveOwner = clientName;
    if (!effectiveOwner) {
      // Try to find matching Client by sender ID or buyer name
      const matchedClient = await Client.findOne({
        company: companyId,
        $or: [
          { name: parsed.buyer?.name },
          { vat: senderId },
          { name: senderId }
        ]
      });
      effectiveOwner = matchedClient ? matchedClient.name : (parsed.buyer?.name || senderId);
    }

    // 5. Build and validate Order lines
    try {
      const orderLines = [];
      let subtotal = 0;

      for (const line of parsed.lines) {
        let prod = await Product.findOne({ sku: line.sku, company: companyId });
        const unitPrice = line.unitPrice || prod?.price || 10;
        const lineTotal = (line.quantity || 1) * unitPrice;
        subtotal += lineTotal;

        orderLines.push({
          sku: line.sku,
          product_name: line.productName || prod?.name || line.sku,
          qty: line.quantity || 1,
          unit_price: unitPrice,
          line_total: lineTotal
        });
      }

      const vatAmount = Math.round(subtotal * 0.21 * 100) / 100;
      const grandTotal = Math.round((subtotal + vatAmount) * 100) / 100;

      // 6. Check if order with this orderId already exists
      let order = await Order.findOne({ company: companyId, orderId: parsed.orderNumber });
      if (!order) {
        order = await Order.create({
          orderId: parsed.orderNumber,
          company: companyId,
          owner: effectiveOwner,
          ownerType: 'CUSTOMER',
          customer: parsed.deliveryParty?.name || parsed.buyer?.name || effectiveOwner,
          email: parsed.buyer?.id ? `${parsed.buyer.id}@edi.order` : 'edi-orders@house3pl.com',
          channel: 'EDI',
          order_type: 'B2B',
          isB2B: true,
          status: 'pending',
          date: parsed.orderDate || new Date(),
          notes: `EDI ${standard} Ingest (Ref: ${controlRef}) - ${parsed.notes}`.trim(),
          product_lines: orderLines,
          items: orderLines.length,
          subtotal,
          vat_rate: 21,
          vat_amount: vatAmount,
          total: grandTotal,
          delivery_address: {
            street: parsed.deliveryParty?.address || '',
            city: parsed.deliveryParty?.city || '',
            postcode: parsed.deliveryParty?.postcode || '',
            country: parsed.deliveryParty?.country || 'ES'
          }
        });
      }

      // 7. Update Interchange record to PROCESSED
      if (!interchange) {
        interchange = await EdiInterchange.create({
          company: companyId,
          interchangeControlRef: controlRef,
          senderId,
          recipientId,
          direction: 'INBOUND',
          standard,
          documentType: 'ORDERS',
          rawPayload: trimmed,
          parsedPayload: parsed,
          status: 'PROCESSED',
          targetOrderId: order._id,
          orderId: order.orderId
        });
      } else {
        interchange.status = 'PROCESSED';
        interchange.parsedPayload = parsed;
        interchange.targetOrderId = order._id;
        interchange.orderId = order.orderId;
        interchange.errorMessage = null;
        interchange.errorStack = null;
        await interchange.save();
      }

      return {
        interchange,
        interchangeId: interchange._id,
        interchangeRef: interchange.interchangeControlRef,
        order,
        createdOrdersCount: 1,
        status: 'PROCESSED'
      };
    } catch (validationOrSaveError) {
      if (!interchange) {
        interchange = await EdiInterchange.create({
          company: companyId,
          interchangeControlRef: controlRef,
          senderId,
          recipientId,
          direction: 'INBOUND',
          standard,
          documentType: 'ORDERS',
          rawPayload: trimmed,
          parsedPayload: parsed,
          status: 'QUARANTINED',
          errorMessage: validationOrSaveError.message,
          errorStack: validationOrSaveError.stack
        });
      } else {
        interchange.status = 'QUARANTINED';
        interchange.errorMessage = validationOrSaveError.message;
        interchange.errorStack = validationOrSaveError.stack;
        interchange.retryCount += 1;
        await interchange.save();
      }

      return {
        interchange,
        status: 'QUARANTINED',
        error: validationOrSaveError.message
      };
    }
  }

  /**
   * Generate and dispatch outbound DESADV message for a shipment
   * @param {Object} options
   * @param {string|mongoose.Types.ObjectId} options.shipmentId Shipment ID
   * @param {string|mongoose.Types.ObjectId} options.companyId Company ID
   * @param {Array<string>} [options.ssccList] Optional SSCC list
   * @returns {Promise<{ interchange: Object, desadvText: string, uploadResult: Object }>}
   */
  static async generateDesadv({ shipmentId, companyId, ssccList = [] }) {
    const shipment = await Shipment.findOne({ _id: shipmentId, company: companyId });
    if (!shipment) throw new Error('Shipment not found');

    const order = await Order.findOne({ orderId: shipment.orderId, company: companyId });
    if (!order) throw new Error(`Order ${shipment.orderId} associated with shipment not found`);

    const desadvText = DesadvGenerator.generate({
      shipment,
      order,
      senderId: '8437000000001',
      recipientId: order.customer || '8412345678901',
      ssccList
    });

    const interchangeRef = `DESADV-${Date.now()}`;
    const filename = `DESADV_${order.orderId}_${Date.now()}.edi`;

    // Attempt upload via SFTP adapter
    let uploadResult = null;
    try {
      uploadResult = await defaultSftpAdapter.uploadOutboundMessage(filename, desadvText);
    } catch (err) {
      uploadResult = { success: false, error: err.message };
    }

    const interchange = await EdiInterchange.create({
      company: companyId,
      interchangeControlRef: interchangeRef,
      senderId: '8437000000001',
      recipientId: order.customer || '8412345678901',
      direction: 'OUTBOUND',
      standard: 'EDIFACT',
      documentType: 'DESADV',
      rawPayload: desadvText,
      targetOrderId: order._id,
      targetShipmentId: shipment._id,
      orderId: order.orderId,
      status: uploadResult?.success ? 'PROCESSED' : 'FAILED',
      errorMessage: uploadResult?.error || null
    });

    return {
      interchange,
      desadvText,
      uploadResult
    };
  }

  /**
   * Retry a quarantined interchange
   * @param {string|mongoose.Types.ObjectId} interchangeId
   * @returns {Promise<Object>}
   */
  static async retryInterchange(interchangeId) {
    const interchange = await EdiInterchange.findById(interchangeId);
    if (!interchange) throw new Error('Interchange not found');

    return this.ingestMessage({
      rawPayload: interchange.rawPayload,
      companyId: interchange.company,
      standardHint: interchange.standard
    });
  }
}

export const ediManager = EdiManager;
export default EdiManager;
