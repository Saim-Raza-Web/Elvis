/**
 * UN/EDIFACT D96A/D01B ORDERS Parser
 * Authoritative WMS implementation for EDI message ingestion (RF-P26)
 */
export class EdifactOrdersParser {
  /**
   * Parse raw UN/EDIFACT ORDERS message into a normalized Order payload
   * @param {string} rawMessage Raw EDIFACT string
   * @returns {Object} Normalized order object
   */
  static parse(rawMessage) {
    if (!rawMessage || typeof rawMessage !== 'string') {
      throw new Error('Invalid EDIFACT message: input must be a non-empty string');
    }

    const trimmed = rawMessage.trim();
    // Default segment separator is apostrophe (') and element separator is plus (+)
    let segmentTerminator = "'";
    let elementSeparator = "+";
    let componentSeparator = ":";

    // Handle UNA service string advice if present
    let content = trimmed;
    if (trimmed.startsWith('UNA')) {
      componentSeparator = trimmed[3];
      elementSeparator = trimmed[4];
      segmentTerminator = trimmed[8] || "'";
      content = trimmed.slice(9).trim();
    }

    const segments = content
      .split(segmentTerminator)
      .map(s => s.trim())
      .filter(s => s.length > 0);

    if (segments.length === 0) {
      throw new Error('EDIFACT parser error: no segments found');
    }

    const parsed = {
      interchangeControlRef: '',
      senderId: '',
      recipientId: '',
      orderNumber: '',
      orderDate: null,
      buyer: { name: '', id: '', address: '' },
      deliveryParty: { name: '', id: '', address: '', city: '', postcode: '', country: '' },
      supplier: { name: '', id: '' },
      lines: [],
      totalQuantity: 0,
      totalAmount: 0,
      notes: ''
    };

    let currentLine = null;

    for (const segment of segments) {
      const elements = segment.split(elementSeparator);
      const tag = elements[0];

      switch (tag) {
        case 'UNB': {
          // UNB+UNOC:3+SENDER_ID:14+RECIPIENT_ID:14+260924:1000+REF12345'
          const senderComp = (elements[2] || '').split(componentSeparator);
          const recipComp = (elements[3] || '').split(componentSeparator);
          parsed.senderId = senderComp[0] || 'UNKNOWN_SENDER';
          parsed.recipientId = recipComp[0] || 'ELVIS_WMS';
          parsed.interchangeControlRef = elements[5] || `EDI-${Date.now()}`;
          break;
        }

        case 'BGM': {
          // BGM+220+ORD-98765+9' (220 = Order)
          parsed.orderNumber = elements[2] || '';
          break;
        }

        case 'DTM': {
          // DTM+137:20260924:102' (137 = Document/message date/time, 102 = CCYYMMDD)
          const dtmComp = (elements[1] || '').split(componentSeparator);
          const qualifier = dtmComp[0];
          const val = dtmComp[1];
          if ((qualifier === '137' || qualifier === '2') && val && val.length >= 8) {
            const y = val.substring(0, 4);
            const m = val.substring(4, 6);
            const d = val.substring(6, 8);
            parsed.orderDate = new Date(`${y}-${m}-${d}T00:00:00Z`);
          }
          break;
        }

        case 'NAD': {
          // NAD+BY+BUYER_ID::91++BUYER NAME+STREET+CITY++08001+ES'
          // NAD+DP+DELIV_ID::91++RECIPIENT NAME+STREET 123+BARCELONA++08020+ES'
          const role = elements[1];
          const partyId = (elements[2] || '').split(componentSeparator)[0];
          const name = elements[4] || '';
          const street = elements[5] || '';
          const city = elements[6] || '';
          const postcode = elements[8] || '';
          const country = elements[9] || '';

          if (role === 'BY') {
            parsed.buyer = { id: partyId, name, address: street, city, postcode, country };
          } else if (role === 'DP') {
            parsed.deliveryParty = { id: partyId, name, address: street, city, postcode, country };
            parsed.deliveryAddress = parsed.deliveryParty;
          } else if (role === 'SU') {
            parsed.supplier = { id: partyId, name };
          }
          break;
        }

        case 'LIN': {
          // LIN+1++4006381333931:EN' (Line item with EAN/GTIN or SKU)
          if (currentLine) {
            parsed.lines.push(currentLine);
          }
          const lineNum = elements[1] || String(parsed.lines.length + 1);
          const itemComp = (elements[3] || '').split(componentSeparator);
          const sku = itemComp[0] || `SKU-L${lineNum}`;
          currentLine = {
            lineNumber: parseInt(lineNum, 10) || parsed.lines.length + 1,
            sku,
            productName: '',
            quantity: 1,
            unitPrice: 0,
            uom: 'EA'
          };
          break;
        }

        case 'PIA': {
          // PIA+1+SKU-EDIF-01:IN'
          if (currentLine) {
            const piaComp = (elements[2] || '').split(componentSeparator);
            if (piaComp[0]) currentLine.sku = piaComp[0];
          }
          break;
        }

        case 'IMD': {
          // IMD+F++:::Product Description Text'
          if (currentLine) {
            const descComp = (elements[3] || '').split(componentSeparator);
            currentLine.productName = descComp[3] || descComp[0] || currentLine.sku;
          }
          break;
        }

        case 'QTY': {
          // QTY+21:50:PCE' (21 = Ordered quantity)
          if (currentLine) {
            const qtyComp = (elements[1] || '').split(componentSeparator);
            currentLine.quantity = parseFloat(qtyComp[1]) || 1;
            if (qtyComp[2]) currentLine.uom = qtyComp[2];
          }
          break;
        }

        case 'PRI': {
          // PRI+AAA:15.50:::NTP' (AAA = Net price)
          if (currentLine) {
            const priComp = (elements[1] || '').split(componentSeparator);
            currentLine.unitPrice = parseFloat(priComp[1]) || 0;
          }
          break;
        }

        case 'FTX': {
          // FTX+AAI+++Free text notes'
          parsed.notes += (elements[4] || '') + ' ';
          break;
        }
      }
    }

    if (currentLine) {
      parsed.lines.push(currentLine);
    }

    // Validation
    if (!parsed.orderNumber) {
      throw new Error('EDIFACT validation error: missing mandatory BGM order reference');
    }
    if (parsed.lines.length === 0) {
      throw new Error('EDIFACT validation error: message contains no LIN product lines');
    }

    parsed.totalQuantity = parsed.lines.reduce((s, l) => s + (l.quantity || 0), 0);
    parsed.totalAmount = parsed.lines.reduce((s, l) => s + ((l.quantity || 0) * (l.unitPrice || 0)), 0);
    if (!parsed.orderDate) parsed.orderDate = new Date();

    parsed.senderGln = parsed.senderId;
    parsed.recipientGln = parsed.recipientId;
    parsed.interchangeControlNumber = parsed.interchangeControlRef;
    parsed.orders = [{
      orderNumber: parsed.orderNumber,
      orderDate: parsed.orderDate,
      buyer: parsed.buyer,
      deliveryParty: parsed.deliveryParty,
      deliveryAddress: parsed.deliveryAddress,
      supplier: parsed.supplier,
      lines: parsed.lines,
      totalQuantity: parsed.totalQuantity,
      totalAmount: parsed.totalAmount,
      notes: parsed.notes
    }];

    return parsed;
  }
}

export const edifactOrdersParser = EdifactOrdersParser;
export default EdifactOrdersParser;
