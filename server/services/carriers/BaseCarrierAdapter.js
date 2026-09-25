/**
 * BaseCarrierAdapter - Common abstract interface for all logistics and shipping carrier adapters.
 * All concrete carrier adapters (CTT, Correos, GLS, DHL, SEUR, MRW) extend this class.
 */
export class BaseCarrierAdapter {
  constructor(carrierCode, name, options = {}) {
    this.carrierCode = carrierCode; // e.g. 'CTT', 'CORREOS', 'GLS', 'DHL', etc.
    this.name = name;
    this.options = options;
  }

  /**
   * Checks whether live production credentials exist in the environment.
   * @returns {boolean}
   */
  isProductionConfigured() {
    return false;
  }

  /**
   * Returns provider metadata, capabilities, credentials requirements, and configuration status.
   */
  getCarrierInfo() {
    return {
      code: this.carrierCode,
      name: this.name,
      isProductionConfigured: this.isProductionConfigured(),
      supportsDomestic: true,
      supportsInternational: true,
      supportsLabelPdf: true,
      supportsZpl: false,
      supportsTracking: true,
      supportsPickup: false,
      supportedServices: ['STANDARD_24_48H', 'EXPRESS_14H', 'ECONOMY'],
      requiredCredentials: []
    };
  }

  /**
   * Validates delivery address against carrier constraints.
   * @param {object} address { street, city, postcode, country, province }
   * @returns {{ valid: boolean, errors?: string[] }}
   */
  validateAddress(address = {}) {
    const errors = [];
    if (!address.street) errors.push('Street is required');
    if (!address.city) errors.push('City is required');
    if (!address.postcode) errors.push('Postal/ZIP code is required');
    if (!address.country) errors.push('Country is required');
    return { valid: errors.length === 0, errors };
  }

  /**
   * Calculates estimated shipping rate.
   * @param {object} params { origin, destination, weightKg, parcelsCount, serviceType }
   * @returns {Promise<{ rate: number, currency: string, estimatedDeliveryDays: number }>}
   */
  async calculateRate(params) {
    throw new Error(`calculateRate not implemented for carrier ${this.carrierCode}`);
  }

  /**
   * Confirms shipment, registers with carrier, and generates tracking number and shipping label.
   * @param {object} params { shipmentId, orderId, sender, recipient, parcels, weightKg, serviceType, notes, isSandbox }
   * @returns {Promise<{ trackingNumber: string, labelBuffer: Buffer, labelFormat: string, carrierShipmentId: string, cost: number, isSandbox: boolean }>}
   */
  async createShipment(params) {
    throw new Error(`createShipment not implemented for carrier ${this.carrierCode}`);
  }

  /**
   * Retrieves tracking checkpoints and current delivery status.
   * @param {string} trackingNumber
   * @returns {Promise<{ trackingNumber: string, status: string, carrier: string, events: Array<{ timestamp: Date, status: string, location: string, description: string }> }>}
   */
  async getTrackingStatus(trackingNumber) {
    throw new Error(`getTrackingStatus not implemented for carrier ${this.carrierCode}`);
  }

  /**
   * Cancels shipment with the carrier.
   * @param {string} trackingNumber
   * @returns {Promise<{ success: boolean, message: string }>}
   */
  async cancelShipment(trackingNumber) {
    throw new Error(`cancelShipment not implemented for carrier ${this.carrierCode}`);
  }

  // Convenience aliases for common invocation patterns
  async confirmShipment(params) {
    return this.createShipment(params);
  }

  async generateLabel(params) {
    return this.createShipment(params);
  }

  async getTracking(trackingNumber) {
    return this.getTrackingStatus(trackingNumber);
  }

  async calculateRates(params) {
    return this.calculateRate(params);
  }

  getStatus() {
    return {
      code: this.carrierCode,
      name: this.name,
      configured: this.isProductionConfigured(),
      status: this.isProductionConfigured() ? 'READY' : 'BLOCKED',
      mode: this.isProductionConfigured() ? 'LIVE' : 'SANDBOX'
    };
  }
}

export default BaseCarrierAdapter;
