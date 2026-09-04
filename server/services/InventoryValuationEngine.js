import mongoose from 'mongoose';
import InventoryCost from '../models/InventoryCost.js';
import InventoryValuationLedger from '../models/InventoryValuationLedger.js';
import Company from '../models/Company.js';

const round4 = (num) => Math.round(num * 10000) / 10000;

export default class InventoryValuationEngine {
  
  /**
   * Process an incoming physical receipt to compute and store the new Weighted Average Cost.
   */
  static async processIncoming(session, { company, sku, owner, ownerType, qty, unitCost, eventType, referenceId, journalEntryId }) {
    if (!company || !sku || !owner || qty == null || unitCost == null || !eventType || !referenceId || !ownerType) {
      throw new Error('Missing required arguments for WAC incoming calculation');
    }
    if (qty <= 0) throw new Error('Incoming quantity must be strictly positive');
    if (unitCost < 0) throw new Error('Unit cost cannot be negative');

    if (ownerType === 'UNKNOWN') {
      throw new Error(`HARD FAILURE: ownerType UNKNOWN is not permitted in financial engine for SKU ${sku}.`);
    }
    
    // Customer-owned stock bypasses valuation entirely
    const isCompanyOwned = ownerType === 'COMPANY';
    
    if (!isCompanyOwned) {
      return { skipped: true, reason: 'Customer-owned inventory is excluded from operator valuation' };
    }

    // 2. Fetch or Create InventoryCost with OCC
    let costDoc = await InventoryCost.findOne({ company, sku, owner }).session(session);
    if (!costDoc) {
      costDoc = new InventoryCost({ company, sku, owner, ownerType: 'COMPANY', qty: 0, totalValue: 0, wac: 0 });
    }

    const priorQty = costDoc.qty;
    const priorWac = costDoc.wac;
    const priorTotalValue = costDoc.totalValue;

    // 3. WAC Mathematics
    const incomingValue = round4(qty * unitCost);
    const newQty = priorQty + qty;
    const newTotalValue = round4(priorTotalValue + incomingValue);
    const newWac = round4(newTotalValue / newQty);

    costDoc.qty = newQty;
    costDoc.totalValue = newTotalValue;
    costDoc.wac = newWac;

    // 4. Save with OCC Protection
    await costDoc.save({ session });

    // 5. Generate Immutable Ledger Event
    const urn = `urn:elvis:accounting:${company}:${eventType}:${referenceId}:${sku}:${ownerType}`;
    const ledger = new InventoryValuationLedger({
      accountingUrn: urn,
      company, sku, owner, ownerType: 'COMPANY',
      eventType, referenceId,
      quantityChange: qty,
      unitCostApplied: unitCost,
      priorQty, priorWac, priorTotalValue,
      newQty, newWac, newTotalValue,
      journalEntryId
    });
    
    await ledger.save({ session });

    return { skipped: false, costDoc, ledger };
  }

  /**
   * Process an outgoing physical consumption to reduce value at current WAC.
   */
  static async processOutgoing(session, { company, sku, owner, ownerType, qty, eventType, referenceId, journalEntryId }) {
    if (!company || !sku || !owner || qty == null || !eventType || !referenceId || !ownerType) {
      throw new Error('Missing required arguments for WAC outgoing calculation');
    }
    if (qty <= 0) throw new Error('Outgoing quantity must be strictly positive');

    if (ownerType === 'UNKNOWN') {
      throw new Error(`HARD FAILURE: ownerType UNKNOWN is not permitted in financial engine for SKU ${sku}.`);
    }

    const isCompanyOwned = ownerType === 'COMPANY';
    
    if (!isCompanyOwned) {
      return { skipped: true, reason: 'Customer-owned inventory is excluded from operator valuation' };
    }

    // 2. Fetch InventoryCost
    const costDoc = await InventoryCost.findOne({ company, sku, owner }).session(session);
    if (!costDoc) {
      throw new Error(`InventoryCost record not found for Company ${company}, SKU ${sku}, Owner ${owner}`);
    }

    const priorQty = costDoc.qty;
    const priorWac = costDoc.wac;
    const priorTotalValue = costDoc.totalValue;

    // 3. Check Balance
    if (priorQty < qty) {
      throw new Error(`Insufficient valuation quantity. Available: ${priorQty}, Requested: ${qty}`);
    }

    // 4. WAC Mathematics
    const newQty = priorQty - qty;
    let newTotalValue, newWac;

    if (newQty === 0) {
      newTotalValue = 0;
      newWac = 0;
    } else {
      const outgoingValue = round4(qty * priorWac);
      newTotalValue = round4(priorTotalValue - outgoingValue);
      newWac = round4(newTotalValue / newQty);
    }

    costDoc.qty = newQty;
    costDoc.totalValue = newTotalValue;
    costDoc.wac = newWac;

    // 5. Save with OCC Protection
    await costDoc.save({ session });

    // 6. Generate Immutable Ledger Event
    const urn = `urn:elvis:accounting:${company}:${eventType}:${referenceId}:${sku}:${ownerType}`;
    const ledger = new InventoryValuationLedger({
      accountingUrn: urn,
      company, sku, owner, ownerType: 'COMPANY',
      eventType, referenceId,
      quantityChange: -qty, // negative indicates outgoing
      unitCostApplied: priorWac,
      priorQty, priorWac, priorTotalValue,
      newQty, newWac, newTotalValue,
      journalEntryId
    });

    await ledger.save({ session });

    return { skipped: false, costDoc, ledger };
  }

  /**
   * Process a customer return, reversing COGS based on original historical shipment cost.
   */
  static async processReturn(session, { company, sku, owner, ownerType, qty, eventType = 'RETURN', returnId, originalShipmentId, journalEntryId }) {
    if (!company || !sku || !owner || qty == null || !returnId || !originalShipmentId || !ownerType) {
      throw new Error('Missing required arguments for WAC return calculation');
    }
    if (qty <= 0) throw new Error('Return quantity must be strictly positive');

    if (ownerType === 'UNKNOWN') {
      throw new Error(`HARD FAILURE: ownerType UNKNOWN is not permitted in financial engine for SKU ${sku}.`);
    }

    const isCompanyOwned = ownerType === 'COMPANY';
    if (!isCompanyOwned) {
      return { skipped: true, reason: 'Customer-owned inventory is excluded from operator valuation' };
    }

    // 1. Trace historical cost lineage
    const originalShipment = await InventoryValuationLedger.findOne({
      eventType: 'SHIPMENT',
      referenceId: originalShipmentId,
      sku,
      owner,
      company
    }).session(session);

    if (!originalShipment) {
      throw new Error(`HARD ACCOUNTING EXCEPTION: Cannot trace original shipment ledger entry for ${originalShipmentId} / SKU ${sku}. Silent fallback to current WAC is forbidden.`);
    }

    const historicalUnitCost = originalShipment.unitCostApplied;
    const maxAllowedQty = Math.abs(originalShipment.quantityChange);

    // 2. Validate Partial Returns Limit
    const previousReturns = await InventoryValuationLedger.aggregate([
      { $match: { eventType: 'RETURN', originalShipmentId, sku, owner, company } },
      { $group: { _id: null, totalReturned: { $sum: "$quantityChange" } } }
    ]).session(session);

    const alreadyReturned = previousReturns.length > 0 ? previousReturns[0].totalReturned : 0;

    if (alreadyReturned + qty > maxAllowedQty) {
      throw new Error(`HARD ACCOUNTING EXCEPTION: Return quantity exceeds original shipment quantity. Previously returned: ${alreadyReturned}, Requested: ${qty}, Shipped: ${maxAllowedQty}`);
    }

    // 3. Fetch or Create InventoryCost
    let costDoc = await InventoryCost.findOne({ company, sku, owner }).session(session);
    if (!costDoc) {
      costDoc = new InventoryCost({ company, sku, owner, ownerType: 'COMPANY', qty: 0, totalValue: 0, wac: 0 });
    }

    const priorQty = costDoc.qty;
    const priorWac = costDoc.wac;
    const priorTotalValue = costDoc.totalValue;

    // 4. WAC Mathematics (Return acts like incoming stock, but at historical cost)
    const incomingValue = round4(qty * historicalUnitCost);
    const newQty = priorQty + qty;
    const newTotalValue = round4(priorTotalValue + incomingValue);
    const newWac = newQty > 0 ? round4(newTotalValue / newQty) : 0;

    costDoc.qty = newQty;
    costDoc.totalValue = newTotalValue;
    costDoc.wac = newWac;

    // 5. Save with OCC Protection
    await costDoc.save({ session });

    // 6. Generate Immutable Ledger Event
    const urn = `urn:elvis:accounting:${company}:${eventType}:${returnId}:${sku}:${ownerType}`;
    const ledger = new InventoryValuationLedger({
      accountingUrn: urn,
      company, sku, owner, ownerType: 'COMPANY',
      eventType, 
      referenceId: returnId,
      originalShipmentId,
      quantityChange: qty,
      unitCostApplied: historicalUnitCost,
      priorQty, priorWac, priorTotalValue,
      newQty, newWac, newTotalValue,
      journalEntryId
    });

    await ledger.save({ session });

    return { skipped: false, costDoc, ledger };
  }

  /**
   * Process a cycle count (gain or shrink) at current WAC.
   */
  static async processCycleCount(session, { company, sku, owner, ownerType, qtyChange, eventType = 'CYCLE_COUNT', referenceId, journalEntryId }) {
    if (!company || !sku || !owner || qtyChange == null || !referenceId || !ownerType) {
      throw new Error('Missing required arguments for WAC cycle count calculation');
    }
    if (qtyChange === 0) return { skipped: true, reason: 'Zero quantity change' };

    if (ownerType === 'UNKNOWN') {
      throw new Error(`HARD FAILURE: ownerType UNKNOWN is not permitted in financial engine for SKU ${sku}.`);
    }

    const isCompanyOwned = ownerType === 'COMPANY';
    if (!isCompanyOwned) {
      return { skipped: true, reason: 'Customer-owned inventory is excluded from operator valuation' };
    }

    // 1. Fetch InventoryCost
    let costDoc = await InventoryCost.findOne({ company, sku, owner }).session(session);
    
    // 2. WAC Checks
    if (qtyChange > 0) { // GAIN
      if (!costDoc || costDoc.wac == null || costDoc.wac <= 0) {
        throw new Error(`HARD ACCOUNTING EXCEPTION: Cycle Count Gain for SKU ${sku} failed. Missing, zero, or negative WAC. Valid financial cost basis is required before generating inventory value.`);
      }
    } else { // SHRINK
      if (!costDoc) {
        throw new Error(`HARD ACCOUNTING EXCEPTION: InventoryCost record not found for Company ${company}, SKU ${sku}, Owner ${owner}`);
      }
    }

    const priorQty = costDoc.qty;
    const priorWac = costDoc.wac;
    const priorTotalValue = costDoc.totalValue;

    if (qtyChange < 0 && priorQty < Math.abs(qtyChange)) {
      throw new Error(`Insufficient valuation quantity for Cycle Count Shrink. Available: ${priorQty}, Requested Shrink: ${Math.abs(qtyChange)}`);
    }

    // 3. WAC Mathematics
    const newQty = priorQty + qtyChange;
    let newTotalValue, newWac;

    if (newQty === 0) {
      newTotalValue = 0;
      newWac = 0;
    } else {
      const adjustmentValue = round4(qtyChange * priorWac);
      newTotalValue = round4(priorTotalValue + adjustmentValue);
      newWac = round4(newTotalValue / newQty);
    }

    costDoc.qty = newQty;
    costDoc.totalValue = newTotalValue;
    costDoc.wac = newWac;

    // 4. Save with OCC Protection
    await costDoc.save({ session });

    // 5. Generate Immutable Ledger Event
    const urn = `urn:elvis:accounting:${company}:${eventType}:${referenceId}:${sku}:${ownerType}`;
    const ledger = new InventoryValuationLedger({
      accountingUrn: urn,
      company, sku, owner, ownerType: 'COMPANY',
      eventType, referenceId,
      quantityChange: qtyChange,
      unitCostApplied: priorWac,
      priorQty, priorWac, priorTotalValue,
      newQty, newWac, newTotalValue,
      journalEntryId
    });

    await ledger.save({ session });

    return { skipped: false, costDoc, ledger };
  }
}
