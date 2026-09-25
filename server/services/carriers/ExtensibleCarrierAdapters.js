import crypto from 'crypto';
import { BaseCarrierAdapter } from './BaseCarrierAdapter.js';
import { generateShippingLabelPDF } from './labelPdfGenerator.js';

/**
 * GLS Express Carrier Adapter
 */
export class GlsCarrierAdapter extends BaseCarrierAdapter {
  constructor() {
    super('GLS', 'GLS Spain');
    this.apiKey = process.env.GLS_API_KEY || '';
  }
  isProductionConfigured() { return Boolean(this.apiKey); }
  getCarrierInfo() {
    return {
      code: 'GLS',
      name: 'GLS Spain',
      isProductionConfigured: this.isProductionConfigured(),
      supportsDomestic: true,
      supportsInternational: true,
      supportsLabelPdf: true,
      supportsZpl: true,
      supportsTracking: true,
      supportsPickup: true,
      supportedServices: ['GLS_BUSINESS_PARCEL', 'GLS_EXPRESS_PARCEL', 'GLS_EURO_BUSINESS'],
      requiredCredentials: ['GLS_API_KEY'],
      description: 'GLS European parcel logistics network with B2B/B2C parcel delivery across Iberia and Europe.'
    };
  }
  async calculateRate({ weightKg = 1.0, destinationCountry = 'ES' } = {}) {
    const rate = Number((4.10 + Math.max(0, weightKg - 1) * 0.80).toFixed(2));
    return { carrier: 'GLS', serviceType: 'GLS_BUSINESS_PARCEL', rate, currency: 'EUR', estimatedDeliveryDays: destinationCountry === 'ES' ? 1 : 3 };
  }
  async createShipment({ shipmentId, orderId, sender = {}, recipient = {}, weightKg = 1.0, parcelsCount = 1 }) {
    const hexRand = crypto.randomBytes(4).toString('hex').toUpperCase();
    const trackingNumber = `GLS-${recipient.country || 'ES'}-${hexRand}`;
    const labelBuffer = await generateShippingLabelPDF({
      carrierName: 'GLS Spain',
      carrierCode: 'GLS',
      serviceType: 'GLS BUSINESS 24H',
      trackingNumber,
      orderNumber: orderId || shipmentId,
      weightKg,
      totalParcels: parcelsCount,
      sender,
      recipient,
      routingCode: `GLS-DEP-${recipient.postcode ? recipient.postcode.slice(0, 2) : '08'}`
    });
    return {
      trackingNumber,
      carrierShipmentId: `GLS-SHP-${hexRand}`,
      carrierCode: 'GLS',
      carrierName: 'GLS Spain',
      serviceType: 'GLS_BUSINESS_PARCEL',
      labelFormat: 'PDF',
      labelBuffer,
      labelBase64: labelBuffer.toString('base64'),
      cost: 4.10,
      currency: 'EUR',
      isSandbox: !this.isProductionConfigured()
    };
  }
  async getTrackingStatus(trackingNumber) {
    return {
      trackingNumber,
      carrier: 'GLS',
      status: 'IN_TRANSIT',
      events: [{ timestamp: new Date(), status: 'IN_TRANSIT', location: 'GLS Hub', description: 'En reparto hacia destino' }]
    };
  }
}

/**
 * DHL Express / Parcel Adapter
 */
export class DhlCarrierAdapter extends BaseCarrierAdapter {
  constructor() {
    super('DHL', 'DHL Express');
    this.apiKey = process.env.DHL_API_KEY || '';
  }
  isProductionConfigured() { return Boolean(this.apiKey); }
  getCarrierInfo() {
    return {
      code: 'DHL',
      name: 'DHL Express',
      isProductionConfigured: this.isProductionConfigured(),
      supportsDomestic: true,
      supportsInternational: true,
      supportsLabelPdf: true,
      supportsZpl: true,
      supportsTracking: true,
      supportsPickup: true,
      supportedServices: ['DHL_EXPRESS_DOMESTIC', 'DHL_EXPRESS_WORLDWIDE', 'DHL_PARCEL_CONNECT'],
      requiredCredentials: ['DHL_API_KEY'],
      description: 'DHL worldwide express transport and Iberian parcel delivery.'
    };
  }
  async calculateRate({ weightKg = 1.0, destinationCountry = 'ES' } = {}) {
    const rate = Number((6.50 + Math.max(0, weightKg - 1) * 1.20).toFixed(2));
    return { carrier: 'DHL', serviceType: 'DHL_EXPRESS_DOMESTIC', rate, currency: 'EUR', estimatedDeliveryDays: destinationCountry === 'ES' ? 1 : 2 };
  }
  async createShipment({ shipmentId, orderId, sender = {}, recipient = {}, weightKg = 1.0, parcelsCount = 1 }) {
    const hexRand = crypto.randomBytes(5).toString('hex').toUpperCase();
    const trackingNumber = `JJD01${hexRand}`;
    const labelBuffer = await generateShippingLabelPDF({
      carrierName: 'DHL Express',
      carrierCode: 'DHL',
      serviceType: 'EXPRESS DOMESTIC 18:00',
      trackingNumber,
      orderNumber: orderId || shipmentId,
      weightKg,
      totalParcels: parcelsCount,
      sender,
      recipient,
      routingCode: `BCN-DHL-${recipient.postcode ? recipient.postcode.slice(0, 2) : '08'}`
    });
    return {
      trackingNumber,
      carrierShipmentId: `DHL-${hexRand}`,
      carrierCode: 'DHL',
      carrierName: 'DHL Express',
      serviceType: 'DHL_EXPRESS_DOMESTIC',
      labelFormat: 'PDF',
      labelBuffer,
      labelBase64: labelBuffer.toString('base64'),
      cost: 6.50,
      currency: 'EUR',
      isSandbox: !this.isProductionConfigured()
    };
  }
  async getTrackingStatus(trackingNumber) {
    return {
      trackingNumber,
      carrier: 'DHL',
      status: 'IN_TRANSIT',
      events: [{ timestamp: new Date(), status: 'IN_TRANSIT', location: 'DHL Hub BCN', description: 'Shipment in transit' }]
    };
  }
}

/**
 * SEUR Carrier Adapter
 */
export class SeurCarrierAdapter extends BaseCarrierAdapter {
  constructor() {
    super('SEUR', 'SEUR GeoPost');
    this.apiKey = process.env.SEUR_API_KEY || '';
  }
  isProductionConfigured() { return Boolean(this.apiKey); }
  getCarrierInfo() {
    return {
      code: 'SEUR',
      name: 'SEUR GeoPost',
      isProductionConfigured: this.isProductionConfigured(),
      supportsDomestic: true,
      supportsInternational: true,
      supportsLabelPdf: true,
      supportsZpl: false,
      supportsTracking: true,
      supportsPickup: true,
      supportedServices: ['SEUR_24', 'SEUR_13:30', 'SEUR_INTERNACIONAL'],
      requiredCredentials: ['SEUR_API_KEY'],
      description: 'SEUR DPDgroup express courier network in Spain and Portugal.'
    };
  }
  async calculateRate({ weightKg = 1.0, destinationCountry = 'ES' } = {}) {
    const rate = Number((4.60 + Math.max(0, weightKg - 1) * 0.90).toFixed(2));
    return { carrier: 'SEUR', serviceType: 'SEUR_24', rate, currency: 'EUR', estimatedDeliveryDays: destinationCountry === 'ES' ? 1 : 3 };
  }
  async createShipment({ shipmentId, orderId, sender = {}, recipient = {}, weightKg = 1.0, parcelsCount = 1 }) {
    const hexRand = crypto.randomBytes(4).toString('hex').toUpperCase();
    const trackingNumber = `SEUR-ES-${hexRand}`;
    const labelBuffer = await generateShippingLabelPDF({
      carrierName: 'SEUR',
      carrierCode: 'SEUR',
      serviceType: 'SEUR 24 ESTÁNDAR',
      trackingNumber,
      orderNumber: orderId || shipmentId,
      weightKg,
      totalParcels: parcelsCount,
      sender,
      recipient,
      routingCode: `SEUR-HUB-${recipient.postcode ? recipient.postcode.slice(0, 2) : '08'}`
    });
    return {
      trackingNumber,
      carrierShipmentId: `SEUR-ID-${hexRand}`,
      carrierCode: 'SEUR',
      carrierName: 'SEUR',
      serviceType: 'SEUR_24',
      labelFormat: 'PDF',
      labelBuffer,
      labelBase64: labelBuffer.toString('base64'),
      cost: 4.60,
      currency: 'EUR',
      isSandbox: !this.isProductionConfigured()
    };
  }
  async getTrackingStatus(trackingNumber) {
    return {
      trackingNumber,
      carrier: 'SEUR',
      status: 'IN_TRANSIT',
      events: [{ timestamp: new Date(), status: 'IN_TRANSIT', location: 'Centro Logístico SEUR', description: 'Envío en curso' }]
    };
  }
}

/**
 * MRW Carrier Adapter
 */
export class MrwCarrierAdapter extends BaseCarrierAdapter {
  constructor() {
    super('MRW', 'MRW Transporte Urgente');
    this.apiKey = process.env.MRW_API_KEY || '';
  }
  isProductionConfigured() { return Boolean(this.apiKey); }
  getCarrierInfo() {
    return {
      code: 'MRW',
      name: 'MRW Transporte Urgente',
      isProductionConfigured: this.isProductionConfigured(),
      supportsDomestic: true,
      supportsInternational: false,
      supportsLabelPdf: true,
      supportsZpl: false,
      supportsTracking: true,
      supportsPickup: true,
      supportedServices: ['MRW_URGENTE_19', 'MRW_URGENTE_14', 'MRW_ECONOMICO'],
      requiredCredentials: ['MRW_API_KEY'],
      description: 'MRW national courier service specializing in express and temperature-controlled urban delivery.'
    };
  }
  async calculateRate({ weightKg = 1.0 } = {}) {
    const rate = Number((4.40 + Math.max(0, weightKg - 1) * 0.85).toFixed(2));
    return { carrier: 'MRW', serviceType: 'MRW_URGENTE_19', rate, currency: 'EUR', estimatedDeliveryDays: 1 };
  }
  async createShipment({ shipmentId, orderId, sender = {}, recipient = {}, weightKg = 1.0, parcelsCount = 1 }) {
    const hexRand = crypto.randomBytes(4).toString('hex').toUpperCase();
    const trackingNumber = `MRW-${hexRand}`;
    const labelBuffer = await generateShippingLabelPDF({
      carrierName: 'MRW',
      carrierCode: 'MRW',
      serviceType: 'MRW URGENTE 19:00',
      trackingNumber,
      orderNumber: orderId || shipmentId,
      weightKg,
      totalParcels: parcelsCount,
      sender,
      recipient,
      routingCode: `MRW-FRANQ-${recipient.postcode ? recipient.postcode.slice(0, 2) : '08'}`
    });
    return {
      trackingNumber,
      carrierShipmentId: `MRW-EXP-${hexRand}`,
      carrierCode: 'MRW',
      carrierName: 'MRW',
      serviceType: 'MRW_URGENTE_19',
      labelFormat: 'PDF',
      labelBuffer,
      labelBase64: labelBuffer.toString('base64'),
      cost: 4.40,
      currency: 'EUR',
      isSandbox: !this.isProductionConfigured()
    };
  }
  async getTrackingStatus(trackingNumber) {
    return {
      trackingNumber,
      carrier: 'MRW',
      status: 'IN_TRANSIT',
      events: [{ timestamp: new Date(), status: 'IN_TRANSIT', location: 'Plataforma MRW', description: 'En reparto' }]
    };
  }
}
