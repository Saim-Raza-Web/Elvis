import mongoose from 'mongoose';
import RateCard from '../models/RateCard.js';
import Client from '../models/Client.js';
import InventoryBalance from '../models/InventoryBalance.js';
import Order from '../models/Order.js';
import ASN from '../models/ASN.js';
import Return from '../models/Return.js';
import Shipment from '../models/Shipment.js';
import Notification from '../models/Notification.js';
import ActivityLog from '../models/ActivityLog.js';
import PDFDocument from 'pdfkit';

export const threePlBillingEngine = {
  /**
   * Resolves or initializes default RateCard for a 3PL client.
   */
  async resolveRateCard(companyId, clientName, warehouse = 'MIA', session = null) {
    const query = { company: companyId, client: clientName, isActive: true };
    if (warehouse) query.warehouse = warehouse;

    let rateCard = await RateCard.findOne(query).session(session);
    if (!rateCard) {
      // Check without warehouse filter
      rateCard = await RateCard.findOne({ company: companyId, client: clientName, isActive: true }).session(session);
    }

    if (!rateCard) {
      // Find client doc to determine default modality
      const clientDoc = await Client.findOne({ company: companyId, name: clientName }).session(session);
      const modality = clientDoc?.billingModality || 'RECURRENT';
      const monthlyMinimum = modality === 'RECURRENT' ? 350.00 : 150.00;

      const [created] = await RateCard.create([{
        name: `Default Rate Card - ${clientName}`,
        client: clientName,
        clientId: clientDoc?._id,
        warehouse: warehouse || 'MIA',
        company: companyId,
        modality,
        monthlyMinimum,
        isActive: true
      }], { session });
      rateCard = created;
    }

    return rateCard;
  },

  /**
   * Evaluates the 20-Day Rule for a client and executes automatic transition if threshold is exceeded.
   *
   * WMS.pdf RF-P15:
   * "Regla automática: si un cliente Temporal supera 20 días consecutivos con stock activo,
   * el sistema lo convierte a Recurrente y notifica al administrador."
   *
   * @param {object} params
   * @param {ObjectId} params.companyId
   * @param {string} params.clientName
   * @param {Date} [params.evaluationDate]
   * @param {number} [params.forcedActiveDays] - For unit tests / simulation
   * @param {ClientSession} [params.session]
   */
  async evaluateTwentyDayRule({ companyId, clientName, evaluationDate = new Date(), forcedActiveDays = null, session = null }) {
    const evalNow = evaluationDate instanceof Date ? evaluationDate : new Date(evaluationDate);
    const client = await Client.findOne({ company: companyId, name: clientName }).session(session);
    if (!client) {
      return { clientFound: false, converted: false };
    }

    // Check if client currently has active physical stock in the warehouse
    const activeBalanceCount = await InventoryBalance.countDocuments({
      company: companyId,
      owner: clientName,
      $or: [{ qtyAvailable: { $gt: 0 } }, { qtyReserved: { $gt: 0 } }]
    }).session(session);

    let activeDays = client.activeStockDays || 0;

    if (forcedActiveDays !== null && forcedActiveDays !== undefined) {
      activeDays = Number(forcedActiveDays);
    } else if (activeBalanceCount > 0) {
      if (!client.firstActiveStockDate) {
        client.firstActiveStockDate = evalNow;
        activeDays = 1;
      } else {
        const diffMs = evalNow.getTime() - new Date(client.firstActiveStockDate).getTime();
        activeDays = Math.max(1, Math.floor(diffMs / (1000 * 60 * 60 * 24)));
      }
      client.activeStockDays = activeDays;
      await client.save({ session });
    } else {
      // Stock reached zero: reset counter
      client.firstActiveStockDate = null;
      client.activeStockDays = 0;
      await client.save({ session });
      activeDays = 0;
    }

    const wasTemporal = client.billingModality === 'TEMPORAL';
    let converted = false;

    // Threshold check: >= 20 consecutive days with active stock
    if (wasTemporal && activeDays >= 20) {
      client.billingModality = 'RECURRENT';
      client.modalityConvertedAt = evalNow;
      client.modalityConversionReason = `Auto-converted: reached or exceeded 20-day storage threshold with active stock (${activeDays} days recorded).`;
      await client.save({ session });

      // Update RateCard minimum to Recurrent tier
      await RateCard.updateMany(
        { company: companyId, client: clientName },
        { $set: { modality: 'RECURRENT', monthlyMinimum: 350.00 } }
      ).session(session);

      // Create Admin Notification
      await Notification.create([{
        company: companyId,
        title: '3PL Client Converted to Recurrent Modality',
        body: `El cliente 3PL "${clientName}" ha superado los 20 días consecutivos con stock activo (${activeDays} días). Convertido automáticamente a modalidad Recurrente.`,
        kind: 'warning',
        createdAt: evalNow
      }], { session });

      converted = true;
    }

    return {
      clientFound: true,
      clientName,
      activeDays,
      hasActiveStock: activeBalanceCount > 0,
      converted,
      previousModality: wasTemporal ? 'TEMPORAL' : 'RECURRENT',
      currentModality: client.billingModality,
      daysUntilConversion: client.billingModality === 'TEMPORAL' ? Math.max(0, 20 - activeDays) : 0
    };
  },

  /**
   * Batch evaluates 20-day rule for a company or single client
   */
  async evaluate20DayRule(companyOrParams = null) {
    if (companyOrParams && typeof companyOrParams === 'object' && companyOrParams.clientName) {
      return this.evaluateTwentyDayRule(companyOrParams);
    }

    const companyId = companyOrParams?._id || companyOrParams;
    const query = companyId ? { company: companyId } : {};
    const clients = await Client.find(query);
    const results = [];
    for (const c of clients) {
      const res = await this.evaluateTwentyDayRule({ companyId: c.company, clientName: c.name });
      results.push(res);
    }
    const convertedClients = results.filter(r => r.converted);
    return {
      totalEvaluated: results.length,
      convertedClients,
      results
    };
  },

  /**
   * Calculates monthly 3PL billing breakdown for a specific client.
   *
   * @param {object} params
   * @param {ObjectId} params.companyId
   * @param {string} params.clientName
   * @param {string} [params.warehouse]
   * @param {number} [params.year]
   * @param {number} [params.month] - 1 to 12
   * @param {Date} [params.evaluationDate]
   * @param {number} [params.forcedActiveDays]
   * @param {ClientSession} [params.session]
   */
  async calculateMonthlyBilling({
    companyId,
    clientName,
    warehouse = 'MIA',
    year = new Date().getFullYear(),
    month = new Date().getMonth() + 1,
    evaluationDate = new Date(),
    forcedActiveDays = null,
    session = null
  }) {
    const evalNow = evaluationDate instanceof Date ? evaluationDate : new Date(evaluationDate);
    const startDate = new Date(year, month - 1, 1);
    const endDate = new Date(year, month, 0, 23, 59, 59, 999);

    const rateCard = await this.resolveRateCard(companyId, clientName, warehouse, session);
    const rates = rateCard.rates;

    // 1. Evaluate 20-Day Rule
    const modalityInfo = await this.evaluateTwentyDayRule({
      companyId,
      clientName,
      evaluationDate: evalNow,
      forcedActiveDays,
      session
    });

    // ── CATEGORY 1: INBOUND ──
    const asns = await ASN.find({
      company: companyId,
      owner: clientName,
      createdAt: { $gte: startDate, $lte: endDate },
      status: { $in: ['completed', 'completed_with_discrepancies', 'partially_received', 'in_progress'] }
    }).session(session);

    let containersCount = 0;
    let palletsInbound = 0;
    let boxesInbound = 0;
    let unitsInbound = 0;

    for (const asn of asns) {
      if (asn.items) {
        for (const it of asn.items) {
          const qty = it.received_qty || it.expected_qty || 0;
          unitsInbound += qty;
          if (it.uom === 'pallet') palletsInbound += qty;
          else if (it.uom === 'box' || it.uom === 'carton') boxesInbound += qty;
        }
      }
      if (asn.notes?.toLowerCase().includes('container') || asn.receivingDock?.includes('Heavy Freight')) {
        containersCount++;
      }
    }

    const inboundTotal = Number((
      containersCount * rates.inbound.containerUnloadFee +
      palletsInbound * rates.inbound.palletFee +
      boxesInbound * rates.inbound.boxFee +
      unitsInbound * rates.inbound.unitFee
    ).toFixed(2));

    // ── CATEGORY 2: STORAGE / ALMACENAJE ──
    const occupiedBins = await InventoryBalance.distinct('bin', {
      company: companyId,
      owner: clientName,
      $or: [{ qtyAvailable: { $gt: 0 } }, { qtyReserved: { $gt: 0 } }]
    }).session(session);

    const locationsOccupied = occupiedBins.length;
    const storageTotal = Number((locationsOccupied * rates.storage.perLocationPerMonth).toFixed(2));

    // ── CATEGORY 3: OUTBOUND B2C ──
    const b2cOrders = await Order.find({
      company: companyId,
      owner: clientName,
      order_type: { $ne: 'B2B' },
      createdAt: { $gte: startDate, $lte: endDate }
    }).session(session);

    let b2cOrdersCount = b2cOrders.length;
    let b2cExtraSkusCount = 0;

    for (const ord of b2cOrders) {
      const lineCount = (ord.product_lines || ord.items || []).length;
      if (lineCount > 1) {
        b2cExtraSkusCount += (lineCount - 1);
      }
    }

    const outboundB2CTotal = Number((
      b2cOrdersCount * rates.outboundB2C.orderFee +
      b2cExtraSkusCount * rates.outboundB2C.extraSkuFee
    ).toFixed(2));

    // ── CATEGORY 4: OUTBOUND B2B ──
    const b2bOrders = await Order.find({
      company: companyId,
      owner: clientName,
      order_type: 'B2B',
      createdAt: { $gte: startDate, $lte: endDate }
    }).session(session);

    let b2bUnits = 0;
    let b2bBoxes = 0;
    let b2bPallets = 0;

    for (const ord of b2bOrders) {
      const lines = ord.product_lines || ord.items || [];
      for (const line of lines) {
        const qty = line.qty || line.orderedQty || 0;
        b2bUnits += qty;
        if (line.uom === 'box' || line.uom === 'carton') b2bBoxes += qty;
        if (line.uom === 'pallet') b2bPallets += qty;
      }
    }

    let outboundB2BTotal = 0;
    if (rates.outboundB2B.pricingTier === 'PALLET' && b2bPallets > 0) {
      outboundB2BTotal = b2bPallets * rates.outboundB2B.palletFee;
    } else if (rates.outboundB2B.pricingTier === 'BOX' && b2bBoxes > 0) {
      outboundB2BTotal = b2bBoxes * rates.outboundB2B.boxFee;
    } else {
      outboundB2BTotal = b2bUnits * rates.outboundB2B.unitFee;
    }
    outboundB2BTotal = Number(outboundB2BTotal.toFixed(2));

    // ── CATEGORY 5: REVERSE LOGISTICS / RETURNS ──
    const returns = await Return.find({
      company: companyId,
      owner: clientName,
      createdAt: { $gte: startDate, $lte: endDate }
    }).session(session);

    let returnsUnitsCount = 0;
    for (const ret of returns) {
      returnsUnitsCount += (ret.qty || ret.quantity || 1);
    }
    const returnsTotal = Number((returnsUnitsCount * rates.reverseLogistics.returnUnitFee).toFixed(2));

    // ── CATEGORY 6: VALUE ADDED SERVICES ──
    const handlingHours = 0;
    const handlingUnits = 0;
    const handlingTotal = Number((
      handlingHours * rates.valueAddedServices.hourlyRate +
      handlingUnits * rates.valueAddedServices.unitRate
    ).toFixed(2));

    // ── CATEGORY 7: TRANSPORT ──
    const shipments = await Shipment.find({
      company: companyId,
      createdAt: { $gte: startDate, $lte: endDate }
    }).session(session);

    // Filter shipments where customer matches clientName or linked order matches owner
    const clientShipments = shipments.filter(s => s.customer === clientName || s.owner === clientName);
    const shipmentsCount = clientShipments.length;
    const transportTotal = Number((shipmentsCount * rates.transport.perShipmentFee).toFixed(2));

    // ── TOTALS & MONTHLY MINIMUM RECONCILIATION ──
    const subtotal = Number((
      inboundTotal +
      storageTotal +
      outboundB2CTotal +
      outboundB2BTotal +
      returnsTotal +
      handlingTotal +
      transportTotal
    ).toFixed(2));

    const monthlyMinimum = rateCard.monthlyMinimum || 0;
    let appliedTotal = subtotal;
    let minimumApplied = false;
    let minimumAdjustment = 0;

    if (subtotal < monthlyMinimum) {
      minimumApplied = true;
      minimumAdjustment = Number((monthlyMinimum - subtotal).toFixed(2));
      appliedTotal = monthlyMinimum;
    }

    return {
      companyId,
      clientName,
      warehouse,
      period: {
        year,
        month,
        startDate,
        endDate
      },
      rateCard: {
        id: rateCard._id,
        name: rateCard.name,
        modality: rateCard.modality,
        monthlyMinimum: rateCard.monthlyMinimum
      },
      modalityStatus: modalityInfo,
      breakdown: {
        inbound: {
          containersCount,
          palletsCount: palletsInbound,
          boxesCount: boxesInbound,
          unitsCount: unitsInbound,
          total: inboundTotal
        },
        storage: {
          locationsOccupied,
          ratePerLocation: rates.storage.perLocationPerMonth,
          total: storageTotal
        },
        outboundB2C: {
          ordersCount: b2cOrdersCount,
          extraSkusCount: b2cExtraSkusCount,
          total: outboundB2CTotal
        },
        outboundB2B: {
          unitsCount: b2bUnits,
          boxesCount: b2bBoxes,
          palletsCount: b2bPallets,
          total: outboundB2BTotal
        },
        reverseLogistics: {
          unitsInspected: returnsUnitsCount,
          total: returnsTotal
        },
        valueAddedServices: {
          hours: handlingHours,
          units: handlingUnits,
          total: handlingTotal
        },
        transport: {
          shipmentsCount,
          total: transportTotal
        }
      },
      client: clientName,
      concepts: {
        inbound: { ...inboundTotal, palletsUnloaded: palletsInbound, subtotal: inboundTotal },
        storage: { locationsOccupied, subtotal: storageTotal },
        outboundB2C: { ordersCount: b2cOrdersCount, extraSkusCount: b2cExtraSkusCount, subtotal: outboundB2CTotal },
        outboundB2B: { unitsCount: b2bUnits, boxesCount: b2bBoxes, palletsCount: b2bPallets, subtotal: outboundB2BTotal },
        returns: { unitsInspected: returnsUnitsCount, subtotal: returnsTotal },
        valueAdded: { hours: handlingHours, units: handlingUnits, subtotal: handlingTotal },
        transport: { shipmentsCount, subtotal: transportTotal }
      },
      totals: {
        conceptsSubtotal: subtotal,
        minimumAdjustment,
        appliedTotal,
        taxableBase: appliedTotal,
        vatAmount: Number((appliedTotal * 0.21).toFixed(2)),
        grandTotal: Number((appliedTotal * 1.21).toFixed(2))
      },
      subtotal,
      monthlyMinimum,
      minimumApplied,
      minimumAdjustment,
      appliedTotal,
      currency: 'EUR',
      calculatedAt: new Date()
    };
  },

  /**
   * Generates a complete 3PL Billing Breakdown PDF document.
   */
  async generateBillingPDF(calcResult) {
    return new Promise((resolve, reject) => {
      try {
        const doc = new PDFDocument({ margin: 40, size: 'A4' });
        const chunks = [];
        doc.on('data', chunk => chunks.push(chunk));
        doc.on('end', () => resolve(Buffer.concat(chunks)));
        doc.on('error', err => reject(err));

        // Header
        doc.font('Helvetica-Bold').fontSize(18).fillColor('#0f172a')
          .text('HOUSE LOGISTIC 3PL — INFORME DE FACTURACIÓN MENSUAL', { align: 'center' });
        doc.moveDown(0.5);

        const clientLabel = calcResult.clientName || calcResult.client;
        const periodStr = calcResult.period ? `${calcResult.period.month}/${calcResult.period.year}` : '';
        const minStr = (calcResult.monthlyMinimum || calcResult.totals?.minimumAdjustment || 0).toFixed(2);
        doc.font('Helvetica').fontSize(10).fillColor('#475569')
          .text(`Cliente 3PL: ${clientLabel} | Periodo: ${periodStr}`, { align: 'center' });
        doc.text(`Mínimo Mensual Acordado: ${minStr} EUR`, { align: 'center' });
        doc.moveDown(1.5);

        // Table Header
        const startX = 40;
        let currentY = doc.y;
        doc.rect(startX, currentY, 515, 20).fill('#e2e8f0');
        doc.font('Helvetica-Bold').fontSize(9).fillColor('#1e293b')
          .text('CONCEPTO FACTURABLE (WMS.pdf RF-P14)', startX + 10, currentY + 5)
          .text('VOLUMEN / CANTIDAD', startX + 280, currentY + 5)
          .text('SUBTOTAL (EUR)', startX + 430, currentY + 5);
        currentY += 25;

        const breakdown = calcResult.breakdown || {};
        const rows = [
          { name: '1. Inbound (Descargas, Palets y Unidades)', qty: `${breakdown.inbound?.unitsCount || 0} unidades`, total: breakdown.inbound?.total || 0 },
          { name: '2. Almacenaje / Storage Mensual', qty: `${breakdown.storage?.locationsOccupied || 0} ubicaciones`, total: breakdown.storage?.total || 0 },
          { name: '3. Outbound B2C (Preparación Pedidos + SKUs)', qty: `${breakdown.outboundB2C?.ordersCount || 0} pedidos`, total: breakdown.outboundB2C?.total || 0 },
          { name: '4. Outbound B2B (Salidas al por mayor)', qty: `${breakdown.outboundB2B?.unitsCount || 0} unidades`, total: breakdown.outboundB2B?.total || 0 },
          { name: '5. Logística Inversa (Gestión Devoluciones)', qty: `${breakdown.reverseLogistics?.unitsInspected || 0} unidades`, total: breakdown.reverseLogistics?.total || 0 },
          { name: '6. Manipulados Especiales / Valor Añadido', qty: `${breakdown.valueAddedServices?.hours || 0} horas`, total: breakdown.valueAddedServices?.total || 0 },
          { name: '7. Gestión de Transporte', qty: `${breakdown.transport?.shipmentsCount || 0} envíos`, total: breakdown.transport?.total || 0 }
        ];

        for (const row of rows) {
          doc.rect(startX, currentY, 515, 20).stroke('#e2e8f0');
          doc.font('Helvetica').fontSize(9).fillColor('#334155')
            .text(row.name, startX + 10, currentY + 5)
            .text(row.qty, startX + 280, currentY + 5)
            .text(`${row.total.toFixed(2)} €`, startX + 430, currentY + 5);
          currentY += 20;
        }

        currentY += 15;
        doc.rect(startX + 280, currentY, 235, 75).fill('#f8fafc').stroke('#cbd5e1');
        doc.font('Helvetica-Bold').fontSize(10).fillColor('#1e293b')
          .text(`Subtotal Calculado: ${(calcResult.subtotal || calcResult.totals?.conceptsSubtotal || 0).toFixed(2)} €`, startX + 290, currentY + 10);

        if (calcResult.minimumApplied || (calcResult.totals?.minimumAdjustment > 0)) {
          const adj = (calcResult.minimumAdjustment || calcResult.totals?.minimumAdjustment || 0).toFixed(2);
          doc.font('Helvetica').fontSize(9).fillColor('#b45309')
            .text(`Ajuste Mínimo Mensual: +${adj} €`, startX + 290, currentY + 28);
        } else {
          doc.font('Helvetica').fontSize(9).fillColor('#16a34a')
            .text(`Mínimo Superado: Sin ajuste`, startX + 290, currentY + 28);
        }

        const grand = (calcResult.appliedTotal || calcResult.totals?.grandTotal || 0).toFixed(2);
        doc.font('Helvetica-Bold').fontSize(12).fillColor('#0f172a')
          .text(`TOTAL FACTURABLE: ${grand} €`, startX + 290, currentY + 48);

        doc.end();
      } catch (err) {
        reject(err);
      }
    });
  },

  async generateSettlementPdf(calcResult) {
    return this.generateBillingPDF(calcResult);
  },

  /**
   * Generates a standard CSV representation of the 3PL settlement.
   */
  async generateSettlementCsv(calcResult) {
    const lines = [];
    lines.push('LIQUIDACION MENSUAL SERVICIOS 3PL — HOUSE LOGISTIC');
    lines.push(`Cliente,"${calcResult.clientName || calcResult.client}"`);
    lines.push(`Periodo,"${calcResult.period?.month}/${calcResult.period?.year}"`);
    lines.push(`Almacen,"${calcResult.warehouse || 'MIA'}"`);
    lines.push('');
    lines.push('Concepto,Detalle,Total EUR');
    lines.push(`"Inbound Reception","${calcResult.breakdown?.inbound?.unitsCount || 0} unidades",${(calcResult.breakdown?.inbound?.total || 0).toFixed(2)}`);
    lines.push(`"Storage (Almacenaje)","${calcResult.breakdown?.storage?.locationsOccupied || 0} ubicaciones",${(calcResult.breakdown?.storage?.total || 0).toFixed(2)}`);
    lines.push(`"Outbound B2C","${calcResult.breakdown?.outboundB2C?.ordersCount || 0} pedidos",${(calcResult.breakdown?.outboundB2C?.total || 0).toFixed(2)}`);
    lines.push(`"Outbound B2B","${calcResult.breakdown?.outboundB2B?.unitsCount || 0} unidades",${(calcResult.breakdown?.outboundB2B?.total || 0).toFixed(2)}`);
    lines.push(`"Returns / Devoluciones","${calcResult.breakdown?.reverseLogistics?.unitsInspected || 0} unidades",${(calcResult.breakdown?.reverseLogistics?.total || 0).toFixed(2)}`);
    lines.push(`"Value-Added / Manipulados","${calcResult.breakdown?.valueAddedServices?.hours || 0} horas",${(calcResult.breakdown?.valueAddedServices?.total || 0).toFixed(2)}`);
    lines.push(`"Transport Management","${calcResult.breakdown?.transport?.shipmentsCount || 0} envíos",${(calcResult.breakdown?.transport?.total || 0).toFixed(2)}`);
    lines.push('');
    lines.push(`"Subtotal Conceptos",,"${(calcResult.subtotal || calcResult.totals?.conceptsSubtotal || 0).toFixed(2)}"`);
    lines.push(`"Ajuste Minimo Mensual",,"${(calcResult.minimumAdjustment || calcResult.totals?.minimumAdjustment || 0).toFixed(2)}"`);
    lines.push(`"Base Imponible",,"${(calcResult.appliedTotal || calcResult.totals?.taxableBase || 0).toFixed(2)}"`);
    lines.push(`"IVA (21%)",,"${(calcResult.totals?.vatAmount || 0).toFixed(2)}"`);
    lines.push(`"TOTAL FACTURA",,"${(calcResult.totals?.grandTotal || calcResult.appliedTotal || 0).toFixed(2)}"`);
    return lines.join('\n');
  }
};

export default threePlBillingEngine;

