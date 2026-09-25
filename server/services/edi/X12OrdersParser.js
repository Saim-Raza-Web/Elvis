/**
 * ANSI X12 850 (Purchase Order) Parser
 * Authoritative WMS implementation for EDI message ingestion (RF-P26)
 */
export class X12OrdersParser {
  /**
   * Parse raw ANSI X12 850 message into a normalized Order payload
   * @param {string} rawMessage Raw X12 string
   * @returns {Object} Normalized order object
   */
  static parse(rawMessage) {
    if (!rawMessage || typeof rawMessage !== 'string') {
      throw new Error('Invalid X12 message: input must be a non-empty string');
    }

    const trimmed = rawMessage.trim();
    // Segment delimiter typically ~ or \n
    let segmentDelimiter = '~';
    if (!trimmed.includes('~') && trimmed.includes('\n')) {
      segmentDelimiter = '\n';
    }

    const segments = trimmed
      .split(segmentDelimiter)
      .map(s => s.trim())
      .filter(s => s.length > 0);

    if (segments.length === 0) {
      throw new Error('X12 parser error: no segments found');
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

    let currentN1Role = '';
    let currentLine = null;

    for (const segment of segments) {
      const elements = segment.split('*');
      const tag = elements[0];

      switch (tag) {
        case 'ISA': {
          // ISA*00*          *00*          *ZZ*SENDER_ID      *ZZ*RECIPIENT_ID   *260924*1000*U*00401*000000001*0*T*:
          parsed.senderId = (elements[6] || '').trim();
          parsed.recipientId = (elements[8] || '').trim();
          parsed.interchangeControlRef = (elements[13] || '').trim() || `X12-${Date.now()}`;
          break;
        }

        case 'BEG': {
          // BEG*00*SA*PO-98765**20260924
          parsed.orderNumber = elements[3] || '';
          const dateStr = elements[5];
          if (dateStr && dateStr.length >= 8) {
            const y = dateStr.substring(0, 4);
            const m = dateStr.substring(4, 6);
            const d = dateStr.substring(6, 8);
            parsed.orderDate = new Date(`${y}-${m}-${d}T00:00:00Z`);
          }
          break;
        }

        case 'N1': {
          // N1*ST*DELIVERY NAME*92*STORE123 (ST = Ship To, BY/BT = Buyer / Bill To)
          currentN1Role = elements[1];
          const partyName = elements[2] || '';
          const partyId = elements[4] || '';

          if (currentN1Role === 'ST') {
            parsed.deliveryParty.name = partyName;
            parsed.deliveryParty.id = partyId;
          } else if (currentN1Role === 'BT' || currentN1Role === 'BY') {
            parsed.buyer.name = partyName;
            parsed.buyer.id = partyId;
          }
          break;
        }

        case 'N3': {
          // N3*STREET ADDRESS 123
          const street = elements[1] || '';
          if (currentN1Role === 'ST') {
            parsed.deliveryParty.address = street;
          } else if (currentN1Role === 'BT' || currentN1Role === 'BY') {
            parsed.buyer.address = street;
          }
          break;
        }

        case 'N4': {
          // N4*CITY*STATE*POSTCODE*COUNTRY
          if (currentN1Role === 'ST') {
            parsed.deliveryParty.city = elements[1] || '';
            parsed.deliveryParty.postcode = elements[3] || '';
            parsed.deliveryParty.country = elements[4] || 'ES';
          }
          break;
        }

        case 'PO1': {
          // PO1*1*50*EA*15.50*PE*IN*SKU-9988*VN*VEND-11
          if (currentLine) {
            parsed.lines.push(currentLine);
          }
          const lineNum = parseInt(elements[1], 10) || parsed.lines.length + 1;
          const qty = parseFloat(elements[2]) || 1;
          const uom = elements[3] || 'EA';
          const unitPrice = parseFloat(elements[4]) || 0;

          // Find SKU in qualifiers (IN = Buyer item number, VN = Vendor item number, UP = UPC, SK = SKU)
          let sku = `SKU-L${lineNum}`;
          const knownQualifiers = ['IN', 'VN', 'UP', 'SK', 'BP', 'VP', 'MG', 'CB'];
          for (let i = 5; i < elements.length; i++) {
            if (knownQualifiers.includes(elements[i]) && elements[i + 1]) {
              sku = elements[i + 1];
              break;
            }
          }

          currentLine = {
            lineNumber: lineNum,
            sku,
            productName: sku,
            quantity: qty,
            unitPrice,
            uom
          };
          break;
        }

        case 'PID': {
          // PID*F****Product description text
          if (currentLine && elements[5]) {
            currentLine.productName = elements[5];
          }
          break;
        }

        case 'MSG':
        case 'NTE': {
          // NTE*GEN*Notes text
          parsed.notes += (elements[2] || '') + ' ';
          break;
        }
      }
    }

    if (currentLine) {
      parsed.lines.push(currentLine);
    }

    if (!parsed.orderNumber) {
      throw new Error('X12 validation error: missing mandatory BEG order reference');
    }
    if (parsed.lines.length === 0) {
      throw new Error('X12 validation error: message contains no PO1 product lines');
    }

    parsed.totalQuantity = parsed.lines.reduce((s, l) => s + (l.quantity || 0), 0);
    parsed.totalAmount = parsed.lines.reduce((s, l) => s + ((l.quantity || 0) * (l.unitPrice || 0)), 0);
    if (!parsed.orderDate) parsed.orderDate = new Date();

    parsed.senderGln = parsed.senderId;
    parsed.recipientGln = parsed.recipientId;
    parsed.interchangeControlNumber = parsed.interchangeControlRef;
    parsed.shipTo = parsed.deliveryParty;
    parsed.orders = [{
      orderNumber: parsed.orderNumber,
      orderDate: parsed.orderDate,
      buyer: parsed.buyer,
      deliveryParty: parsed.deliveryParty,
      shipTo: parsed.deliveryParty,
      lines: parsed.lines,
      totalQuantity: parsed.totalQuantity,
      totalAmount: parsed.totalAmount,
      notes: parsed.notes
    }];

    return parsed;
  }
}

export const x12OrdersParser = X12OrdersParser;
export default X12OrdersParser;
