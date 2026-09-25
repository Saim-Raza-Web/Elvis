import { CttCarrierAdapter } from './CttCarrierAdapter.js';
import { CorreosCarrierAdapter } from './CorreosCarrierAdapter.js';
import {
  GlsCarrierAdapter,
  DhlCarrierAdapter,
  SeurCarrierAdapter,
  MrwCarrierAdapter
} from './ExtensibleCarrierAdapters.js';

class CarrierAdapterRegistry {
  constructor() {
    this.adapters = new Map();
    this.registerDefaults();
  }

  registerDefaults() {
    // Primary WMS.pdf required carriers
    this.register(new CttCarrierAdapter());
    this.register(new CorreosCarrierAdapter());

    // Extensible supported carriers
    this.register(new GlsCarrierAdapter());
    this.register(new DhlCarrierAdapter());
    this.register(new SeurCarrierAdapter());
    this.register(new MrwCarrierAdapter());
  }

  /**
   * Registers a new carrier adapter.
   * @param {BaseCarrierAdapter} adapter
   */
  register(adapter) {
    if (!adapter || !adapter.carrierCode) {
      throw new Error('Carrier adapter must define a valid carrierCode');
    }
    this.adapters.set(adapter.carrierCode.toUpperCase(), adapter);
  }

  /**
   * Resolves a carrier adapter by code (case-insensitive).
   * @param {string} code - e.g. 'CTT', 'CORREOS', 'GLS', 'DHL'
   * @returns {BaseCarrierAdapter}
   */
  get(code) {
    if (!code) return this.adapters.get('CTT');
    const clean = String(code).trim().toUpperCase();
    const adapter = this.adapters.get(clean);
    if (!adapter) {
      // Fallback aliases
      if (clean.includes('CTT')) return this.adapters.get('CTT');
      if (clean.includes('CORREO')) return this.adapters.get('CORREOS');
      if (clean.includes('GLS')) return this.adapters.get('GLS');
      if (clean.includes('DHL')) return this.adapters.get('DHL');
      if (clean.includes('SEUR')) return this.adapters.get('SEUR');
      if (clean.includes('MRW')) return this.adapters.get('MRW');
      throw new Error(`Carrier '${code}' is not supported. Supported: ${Array.from(this.adapters.keys()).join(', ')}`);
    }
    return adapter;
  }

  /**
   * Lists all available carrier metadata.
   */
  listAll() {
    return Array.from(this.adapters.values()).map(a => a.getCarrierInfo());
  }

  getAvailableCarriers() {
    return this.listAll();
  }

  /**
   * Rule-based carrier selection according to destination, weight, service level, and client agreement.
   *
   * @param {object} params
   * @param {string} params.destinationCountry - ISO-2 (e.g. 'ES', 'PT', 'FR', 'DE')
   * @param {number} params.weightKg - parcel weight
   * @param {string} params.serviceLevel - 'STANDARD' | 'EXPRESS' | 'ECONOMY'
   * @param {string} [params.preferredCarrier] - optional manual override
   * @returns {Promise<{ selectedCarrier: string, adapter: BaseCarrierAdapter, reason: string, estimatedRate: number }>}
   */
  async selectCarrierForShipment({
    destinationCountry = 'ES',
    weightKg = 1.0,
    serviceLevel = 'STANDARD',
    preferredCarrier = null
  } = {}) {
    const dest = (destinationCountry || 'ES').toUpperCase();
    const sLevel = (serviceLevel || 'STANDARD').toUpperCase();

    // 1. Manual override takes highest precedence if provided
    if (preferredCarrier) {
      try {
        const adapter = this.get(preferredCarrier);
        const rateInfo = await adapter.calculateRate({ weightKg, destinationCountry: dest });
        return {
          selectedCarrier: adapter.carrierCode,
          adapter,
          reason: `Manual selection: ${adapter.name} specified on order/shipment`,
          estimatedRate: rateInfo.rate
        };
      } catch (_) {
        // Fall back to rule evaluation if preferred carrier not found
      }
    }

    // 2. International routing rule: outside Spain & Portugal
    if (dest !== 'ES' && dest !== 'PT') {
      const dhl = this.get('DHL');
      const rateInfo = await dhl.calculateRate({ weightKg, destinationCountry: dest });
      return {
        selectedCarrier: 'DHL',
        adapter: dhl,
        reason: `International destination (${dest}): routed to DHL Express worldwide network`,
        estimatedRate: rateInfo.rate
      };
    }

    // 3. Time-definite express rule
    if (sLevel === 'EXPRESS') {
      const ctt = this.get('CTT');
      const rateInfo = await ctt.calculateRate({ weightKg, destinationCountry: dest, serviceType: 'CTT_EXPRESS_14H' });
      return {
        selectedCarrier: 'CTT',
        adapter: ctt,
        reason: 'Urgent service requested: routed to CTT Express 14h commitment',
        estimatedRate: rateInfo.rate
      };
    }

    // 4. Standard domestic rule: compare rates between Correos and CTT
    const correos = this.get('CORREOS');
    const ctt = this.get('CTT');
    const [rateCorreos, rateCtt] = await Promise.all([
      correos.calculateRate({ weightKg, destinationCountry: dest }),
      ctt.calculateRate({ weightKg, destinationCountry: dest })
    ]);

    if (rateCorreos.rate <= rateCtt.rate) {
      return {
        selectedCarrier: 'CORREOS',
        adapter: correos,
        reason: `Optimal rate for domestic standard: Correos España (${rateCorreos.rate} EUR vs CTT ${rateCtt.rate} EUR)`,
        estimatedRate: rateCorreos.rate
      };
    } else {
      return {
        selectedCarrier: 'CTT',
        adapter: ctt,
        reason: `Optimal rate for domestic standard: CTT Express (${rateCtt.rate} EUR)`,
        estimatedRate: rateCtt.rate
      };
    }
  }
}

export const carrierRegistry = new CarrierAdapterRegistry();
export const carrierAdapterRegistry = carrierRegistry;
export default carrierRegistry;
