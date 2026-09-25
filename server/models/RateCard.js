import mongoose from 'mongoose';

const rateCardSchema = new mongoose.Schema({
  name: { type: String, required: true },
  client: { type: String, required: true }, // 3PL Client / Owner name (authoritative mapping)
  clientId: { type: mongoose.Schema.Types.ObjectId, ref: 'Client' },
  warehouse: { type: String, required: true, default: 'MIA' },
  warehouseId: { type: mongoose.Schema.Types.ObjectId, ref: 'Warehouse' },
  company: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true },

  // Client Modality: RECURRENT (permanent stock, higher minimum) vs TEMPORAL (seasonal, lower minimum)
  modality: { 
    type: String, 
    enum: ['RECURRENT', 'TEMPORAL'], 
    default: 'RECURRENT' 
  },

  // Monthly billing minimum: if calculated subtotal < minimum, invoice minimum
  monthlyMinimum: { type: Number, default: 350.00, min: 0 },

  // Effective period
  effectiveFrom: { type: Date, default: () => new Date() },
  effectiveTo: { type: Date },
  isActive: { type: Boolean, default: true },

  // ── BILLABLE CONCEPTS (WMS.pdf RF-P14) ──
  rates: {
    // 1. Inbound
    inbound: {
      containerUnloadFee: { type: Number, default: 220.00 }, // Tarifa fija descarga contenedor
      palletFee: { type: Number, default: 3.25 },           // Recepción por palet
      boxFee: { type: Number, default: 0.40 },              // Recepción por bulto/caja
      unitFee: { type: Number, default: 0.08 }              // Recepción por unidad suelta
    },

    // 2. Almacenaje / Storage
    storage: {
      perLocationPerMonth: { type: Number, default: 8.50 }, // Por ubicación y mes
      perSquareMeterPerMonth: { type: Number, default: 11.00 }, // Por m2 ocupado y mes
      billingBasis: { type: String, enum: ['LOCATION', 'SQUARE_METER'], default: 'LOCATION' }
    },

    // 3. Outbound B2C
    outboundB2C: {
      orderFee: { type: Number, default: 2.10 },            // Por pedido preparado base
      extraSkuFee: { type: Number, default: 0.35 }          // Suplemento por SKU adicional
    },

    // 4. Outbound B2B
    outboundB2B: {
      unitFee: { type: Number, default: 0.12 },             // Por unidad B2B
      boxFee: { type: Number, default: 0.55 },              // Por caja B2B
      palletFee: { type: Number, default: 4.25 },           // Por palet B2B
      pricingTier: { type: String, enum: ['UNIT', 'BOX', 'PALLET'], default: 'UNIT' }
    },

    // 5. Logística Inversa / Returns
    reverseLogistics: {
      returnUnitFee: { type: Number, default: 1.25 }        // Gestión de devolución por unidad
    },

    // 6. Manipulados Especiales / Value-Added Services
    valueAddedServices: {
      hourlyRate: { type: Number, default: 22.00 },         // Tarifa por hora
      unitRate: { type: Number, default: 0.45 }             // Tarifa por unidad
    },

    // 7. Transporte / Transport
    transport: {
      perShipmentFee: { type: Number, default: 0.85 },      // Tarifa fija de gestión por envío
      marginPercent: { type: Number, default: 10.0 }        // % margen sobre porte si WMS gestiona transporte
    }
  },

  notes: { type: String }
}, {
  timestamps: true
});

rateCardSchema.index({ company: 1, client: 1, warehouse: 1, isActive: 1 });
rateCardSchema.index({ company: 1, modality: 1 });

export default mongoose.model('RateCard', rateCardSchema);
