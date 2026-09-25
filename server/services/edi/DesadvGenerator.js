/**
 * UN/EDIFACT D96A DESADV (Despatch Advice / Delivery Note) Generator
 * Authoritative WMS implementation for outbound EDI dispatch advice (RF-P26)
 */
export class DesadvGenerator {
  /**
   * Generate EDIFACT D96A DESADV document string from shipment & order details
   * @param {Object} options
   * @param {Object} options.shipment Shipment document
   * @param {Object} options.order Order document
   * @param {string} options.senderId Sender GLN / EDI identifier (e.g. 8412345678901)
   * @param {string} options.recipientId Consignee GLN / EDI identifier
   * @param {Array<string>} [options.ssccList] Array of SSCC pallet/package barcodes
   * @returns {string} EDIFACT message string
   */
  static generate(shipmentOrOptions, extraOptions = {}) {
    let shipment, order, senderId, recipientId, ssccList, despatchAdviceNumber;

    if (shipmentOrOptions?.order || shipmentOrOptions?.shipment) {
      shipment = shipmentOrOptions.shipment;
      order = shipmentOrOptions.order;
      senderId = shipmentOrOptions.senderId || shipmentOrOptions.senderGln || '8437000000001';
      recipientId = shipmentOrOptions.recipientId || shipmentOrOptions.recipientGln || '8412345678901';
      ssccList = shipmentOrOptions.ssccList || [];
      despatchAdviceNumber = shipmentOrOptions.shipmentNumber || shipment?.tracking_number || shipment?.shipmentId || (order ? `DN-${order.orderId}` : 'DESADV-001');
    } else {
      shipment = shipmentOrOptions;
      order = extraOptions.order || {
        orderId: shipment?.orderNumber || 'ORD-001',
        product_lines: shipment?.handlingUnits?.flatMap(u => u.lines?.map(l => ({
          sku: l.sku,
          qty: l.shippedQty,
          product_name: l.description
        }))) || []
      };
      senderId = extraOptions.senderGln || extraOptions.senderId || '8437000000001';
      recipientId = extraOptions.recipientGln || extraOptions.recipientId || '8412345678901';
      ssccList = extraOptions.ssccList || shipment?.handlingUnits?.map(u => u.sscc).filter(Boolean) || [];
      despatchAdviceNumber = shipment?.shipmentNumber || shipment?.tracking_number || shipment?.shipmentId || (order ? `DN-${order.orderId}` : 'DESADV-001');
    }

    const now = new Date();
    const dateYMD = now.toISOString().slice(2, 10).replace(/-/g, ''); // YYMMDD
    const timeHM = now.toISOString().slice(11, 16).replace(/:/g, ''); // HHMM
    const fullDateYMD = now.toISOString().slice(0, 10).replace(/-/g, ''); // YYYYMMDD
    const interchangeRef = extraOptions?.interchangeRef || `REF${Date.now().toString().slice(-8)}`;
    const messageRef = `M${Date.now().toString().slice(-6)}`;

    const segments = [];

    // Service Advice
    segments.push("UNA:+.? '");

    // UNB: Interchange Header
    segments.push(`UNB+UNOC:3+${senderId}:14+${recipientId}:14+${dateYMD}:${timeHM}+${interchangeRef}'`);

    // UNH: Message Header
    segments.push(`UNH+${messageRef}+DESADV:D:96A:UN'`);

    // BGM: Beginning of Message (351 = Despatch advice)
    segments.push(`BGM+351+${despatchAdviceNumber}+9'`);

    // DTM: Document Date
    segments.push(`DTM+137:${fullDateYMD}:102'`);
    // DTM: Despatch Date
    segments.push(`DTM+11:${fullDateYMD}:102'`);

    // RFF: Order Reference
    segments.push(`RFF+ON:${order.orderId}'`);

    // NAD: Consignor / Shipper (CZ)
    const consignorName = order.owner || 'House Logistic 3PL';
    segments.push(`NAD+CZ+${senderId}::9+${consignorName}'`);

    // NAD: Consignee / Delivery Address (CN)
    const addr = order.delivery_address || {};
    const recipientName = order.customer || 'Recipient';
    const street = (addr.street || '').replace(/[\+\:\']/g, ' ');
    const city = (addr.city || '').replace(/[\+\:\']/g, ' ');
    const postal = (addr.postcode || '').replace(/[\+\:\']/g, ' ');
    const country = (addr.country || 'ES').replace(/[\+\:\']/g, ' ');
    segments.push(`NAD+CN+${recipientId}::9++${recipientName}+${street}+${city}++${postal}+${country}'`);

    // Carrier (FW = Freight Forwarder)
    if (shipment?.carrier || order.carrier) {
      const carrierName = (shipment?.carrier || order.carrier).replace(/[\+\:\']/g, ' ');
      segments.push(`NAD+FW+++${carrierName}'`);
    }

    // CPS: Consignment Packing Sequence (CPS 1 = Consignment level)
    segments.push(`CPS+1'`);

    // Pallets / Packages with SSCC
    if (ssccList && ssccList.length > 0) {
      ssccList.forEach((sscc, idx) => {
        segments.push(`PAC+1++PAL'`);
        segments.push(`PCI+33E'`);
        // GIN+BJ is GS1 SSCC qualifier
        segments.push(`GIN+BJ+${sscc}'`);
      });
    }

    // CPS 2 = Item line sequence
    segments.push(`CPS+2+1'`);

    const lines = order.product_lines || [];
    lines.forEach((line, idx) => {
      const lineNum = idx + 1;
      const sku = (line.sku || `ITEM${lineNum}`).replace(/[\+\:\']/g, ' ');
      const qty = line.qty || 1;
      // LIN: Item
      segments.push(`LIN+${lineNum}++${sku}:IN'`);
      // PIA: Additional ID if product name exists
      if (line.product_name) {
        const prodName = line.product_name.replace(/[\+\:\']/g, ' ').slice(0, 35);
        segments.push(`PIA+1+${prodName}:ZZZ'`);
      }
      // QTY: Despatched quantity (12 = Despatched quantity)
      segments.push(`QTY+12:${qty}:PCE'`);
    });

    // UNT: Message Trailer (segment count includes UNH through UNT)
    const unhIndex = segments.findIndex(s => s.startsWith('UNH'));
    const messageSegmentsCount = segments.length - unhIndex + 1; // +1 for UNT itself
    segments.push(`UNT+${messageSegmentsCount}+${messageRef}'`);

    // UNZ: Interchange Trailer
    segments.push(`UNZ+1+${interchangeRef}'`);

    return segments.join('\n');
  }
}

export const desadvGenerator = DesadvGenerator;
export default DesadvGenerator;
