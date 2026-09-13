import mongoose from 'mongoose';
import InventoryBalance from '../models/InventoryBalance.js';
import Product from '../models/Product.js';
import Company from '../models/Company.js';
import ExpiryAlert from '../models/ExpiryAlert.js';
import Notification from '../models/Notification.js';
import AuditLog from '../models/AuditLog.js';
import ActivityLog from '../models/ActivityLog.js';
import { evaluateExpiryItem } from './expiryEvaluator.js';

const SEVERITY_RANK = Object.freeze({
  'NORMAL': 0,
  'WARNING': 1,
  'HIGH': 2,
  'CRITICAL': 3,
  'EXPIRED': 4
});

/**
 * Service: Expiry Alert Management & Evaluation Scanner (Stage 8)
 *
 * CRITICAL ARCHITECTURAL INVARIANTS:
 * - Read-only inspection of physical inventory.
 * - ZERO mutations to InventoryBalance quantities.
 * - ZERO mutations to Product.qty_available or Product.qty_ecommerce.
 * - ZERO mutations to InventoryCost, InventoryValuationLedger, JournalEntry, InventoryTransaction.
 * - ZERO automatic quarantine, scrap, lot recall, picking, putaway, replenishment.
 * - Full multi-tenant isolation by Company context.
 */
export const expiryAlertService = {
  /**
   * Scans company inventory and evaluates expiry thresholds.
   *
   * @param {Object} params
   * @param {ObjectId|string} params.companyId - Required tenant context
   * @param {string} [params.warehouse] - Optional warehouse filter
   * @param {boolean} [params.dryRun=false] - If true, evaluates without persisting any records
   * @param {Date|string} [params.evaluationNow=new Date()] - Deterministic reference time
   * @param {string} [params.runId] - Diagnostic execution identifier
   * @param {Object} [params.user] - Optional triggering user
   */
  async scanCompanyExpiry({
    companyId,
    warehouse,
    dryRun = false,
    evaluationNow = new Date(),
    runId = null,
    user = null
  }) {
    const startTime = Date.now();
    const isDryRun = Boolean(dryRun);
    const evalNow = evaluationNow instanceof Date ? evaluationNow : new Date(evaluationNow);
    const currentRunId = runId || `EXP-RUN-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

    if (!companyId) {
      throw new Error('companyId is required to scan expiry inventory');
    }

    const companyObjectId = typeof companyId === 'string'
      ? new mongoose.Types.ObjectId(companyId)
      : companyId;

    // 1. Fetch Company for timezone resolution
    const companyDoc = await Company.findById(companyObjectId).lean();
    const timeZone = companyDoc?.timezone || 'UTC';

    // 2. Fetch Products for category and tracking metadata
    const products = await Product.find({ company: companyObjectId }).lean();
    const productMap = new Map();
    for (const p of products) {
      productMap.set(p.sku, p);
    }

    // 3. Check Stage 5A Lot Recall history (do not infer recall solely from qtyQuarantine)
    const recallLogs = await AuditLog.find({
      company: companyObjectId,
      event_type: 'lot_recalled'
    }).select('lot_number').lean();
    const recalledLotSet = new Set(recallLogs.map(l => l.lot_number).filter(Boolean));

    // 4. Query physical InventoryBalances
    const balQuery = {
      company: companyObjectId,
      $or: [
        { qtyAvailable: { $gt: 0 } },
        { qtyReserved: { $gt: 0 } },
        { qtyAwaitingPutaway: { $gt: 0 } },
        { qtyQuarantine: { $gt: 0 } }
      ]
    };
    if (warehouse) {
      balQuery.warehouse = warehouse;
    }

    const balances = await InventoryBalance.find(balQuery).lean();

    // 5. Aggregate multiple bins of the same lot and owner in the same warehouse
    // Grouping identity: warehouse ::: sku ::: lotNumber ::: owner
    const lotGroups = new Map();

    for (const bal of balances) {
      const lotKey = (bal.lotNumber || '').trim();
      const ownerKey = (bal.owner || 'Default Owner').trim();
      const groupKey = `${bal.warehouse}:::${bal.sku}:::${lotKey}:::${ownerKey}`;

      let group = lotGroups.get(groupKey);
      if (!group) {
        group = {
          warehouse: bal.warehouse,
          sku: bal.sku,
          lotNumber: lotKey,
          owner: ownerKey,
          ownerType: bal.ownerType || 'UNKNOWN',
          expiryDate: bal.expiryDate || null,
          qtyAvailable: 0,
          qtyReserved: 0,
          qtyAwaitingPutaway: 0,
          qtyQuarantine: 0,
          totalQty: 0,
          locations: []
        };
        lotGroups.set(groupKey, group);
      }

      const balAvail = bal.qtyAvailable || 0;
      const balRes = bal.qtyReserved || 0;
      const balAwait = bal.qtyAwaitingPutaway || 0;
      const balQuar = bal.qtyQuarantine || 0;
      const balTotal = balAvail + balRes + balAwait + balQuar;

      group.qtyAvailable += balAvail;
      group.qtyReserved += balRes;
      group.qtyAwaitingPutaway += balAwait;
      group.qtyQuarantine += balQuar;
      group.totalQty += balTotal;

      group.locations.push({
        bin: bal.bin,
        qtyAvailable: balAvail,
        qtyReserved: balRes,
        qtyAwaitingPutaway: balAwait,
        qtyQuarantine: balQuar,
        totalQty: balTotal
      });

      // Preserve earliest expiryDate if multiple balances present
      if (bal.expiryDate) {
        if (!group.expiryDate || new Date(bal.expiryDate) < new Date(group.expiryDate)) {
          group.expiryDate = bal.expiryDate;
        }
      }

      // Preserve UNKNOWN ownerType policy if any bin has UNKNOWN
      if (bal.ownerType === 'UNKNOWN') {
        group.ownerType = 'UNKNOWN';
      } else if (bal.ownerType === 'CUSTOMER' && group.ownerType !== 'UNKNOWN') {
        group.ownerType = 'CUSTOMER';
      }
    }

    // 6. Evaluate Expiry for each lot group
    const findings = [];
    const dataQualityExceptions = [];
    const activeLotKeysScanned = new Set();
    let createdCount = 0;
    let updatedCount = 0;
    let autoResolvedCount = 0;
    let notificationsCount = 0;

    for (const group of lotGroups.values()) {
      const prod = productMap.get(group.sku);
      const evalResult = evaluateExpiryItem({
        expiryDate: group.expiryDate,
        evaluationNow: evalNow,
        category: prod?.category || 'GEN',
        timeZone,
        productMetadata: prod || null
      });

      if (evalResult.status === 'NOT_MONITORED') {
        continue;
      }

      if (evalResult.status === 'DATA_QUALITY_EXCEPTION' || evalResult.status === 'DATA_QUALITY_ERROR') {
        dataQualityExceptions.push({
          warehouse: group.warehouse,
          sku: group.sku,
          lotNumber: group.lotNumber,
          issue: evalResult.reason,
          details: evalResult.details
        });
        continue;
      }

      if (evalResult.shouldAlert && group.totalQty > 0) {
        const isRecalled = group.lotNumber ? recalledLotSet.has(group.lotNumber) : false;
        activeLotKeysScanned.add(`${group.warehouse}:::${group.sku}:::${group.lotNumber}:::${group.owner}`);

        const finding = {
          company: companyObjectId,
          warehouse: group.warehouse,
          sku: group.sku,
          lotNumber: group.lotNumber,
          expiryDate: group.expiryDate ? new Date(group.expiryDate) : null,
          category: evalResult.category,
          severity: evalResult.severity,
          daysRemaining: evalResult.daysRemaining,
          thresholdBreached: evalResult.thresholdBreached,
          actionRequired: evalResult.actionRequired,
          qtyAvailable: group.qtyAvailable,
          qtyReserved: group.qtyReserved,
          qtyAwaitingPutaway: group.qtyAwaitingPutaway,
          qtyQuarantine: group.qtyQuarantine,
          totalQty: group.totalQty,
          locations: group.locations,
          owner: group.owner,
          ownerType: group.ownerType,
          isRecalled,
          status: 'OPEN',
          lastEvaluatedAt: evalNow,
          runId: currentRunId,
          lastNotifiedSeverity: evalResult.severity
        };

        findings.push(finding);

        // If NOT a dry run, persist or refresh the ExpiryAlert
        if (!isDryRun) {
          const alertIdentity = {
            company: companyObjectId,
            warehouse: group.warehouse,
            sku: group.sku,
            lotNumber: group.lotNumber,
            owner: group.owner
          };

          const existingAlert = await ExpiryAlert.findOne(alertIdentity);

          if (existingAlert) {
            const oldSeverity = existingAlert.severity;
            const isEscalation = SEVERITY_RANK[evalResult.severity] > SEVERITY_RANK[oldSeverity];
            const wasResolved = existingAlert.status === 'RESOLVED';

            // State Machine Transitions:
            // 1. RESOLVED -> OPEN if stock returns with an active expiry breach
            // 2. DISMISSED -> remains DISMISSED unless severity escalates to higher risk
            // 3. ACKNOWLEDGED -> remains ACKNOWLEDGED unless severity escalates
            let newStatus = existingAlert.status;
            if (wasResolved) {
              newStatus = 'OPEN';
            } else if (existingAlert.status === 'DISMISSED') {
              if (isEscalation) {
                newStatus = 'OPEN';
              } else {
                newStatus = 'DISMISSED';
              }
            } else if (existingAlert.status === 'ACKNOWLEDGED') {
              if (isEscalation) {
                newStatus = 'OPEN';
              }
            }

            existingAlert.category = evalResult.category;
            existingAlert.severity = evalResult.severity;
            existingAlert.daysRemaining = evalResult.daysRemaining;
            existingAlert.thresholdBreached = evalResult.thresholdBreached;
            existingAlert.actionRequired = evalResult.actionRequired;
            existingAlert.qtyAvailable = group.qtyAvailable;
            existingAlert.qtyReserved = group.qtyReserved;
            existingAlert.qtyAwaitingPutaway = group.qtyAwaitingPutaway;
            existingAlert.qtyQuarantine = group.qtyQuarantine;
            existingAlert.totalQty = group.totalQty;
            existingAlert.locations = group.locations;
            existingAlert.owner = group.owner;
            existingAlert.ownerType = group.ownerType;
            existingAlert.isRecalled = isRecalled;
            existingAlert.status = newStatus;
            existingAlert.lastEvaluatedAt = evalNow;
            existingAlert.runId = currentRunId;

            // Notification Deduplication Logic:
            // - Escalation triggers notification if severity > lastNotifiedSeverity
            // - Reactivation of a previously resolved lot triggers reactivation notification
            if (isEscalation && existingAlert.lastNotifiedSeverity !== evalResult.severity) {
              await this._createEscalationNotification({
                companyId: companyObjectId,
                alert: existingAlert,
                oldSeverity,
                newSeverity: evalResult.severity
              });
              existingAlert.lastNotifiedSeverity = evalResult.severity;
              notificationsCount++;
            } else if (wasResolved && newStatus === 'OPEN') {
              await this._createInitialNotification({
                companyId: companyObjectId,
                alert: existingAlert
              });
              existingAlert.lastNotifiedSeverity = evalResult.severity;
              notificationsCount++;
            }

            await existingAlert.save();
            updatedCount++;
          } else {
            // Create brand new ExpiryAlert
            const created = await ExpiryAlert.create(finding);
            createdCount++;

            // Send initial notification
            await this._createInitialNotification({
              companyId: companyObjectId,
              alert: created
            });
            notificationsCount++;
          }
        }
      }
    }

    // 7. Auto-Resolve Depleted Lots (totalQty === 0)
    if (!isDryRun) {
      const openAlerts = await ExpiryAlert.find({
        company: companyObjectId,
        status: { $in: ['OPEN', 'ACKNOWLEDGED', 'DISMISSED'] },
        ...(warehouse && { warehouse })
      });

      for (const alert of openAlerts) {
        const alertOwner = (alert.owner || 'Default Owner').trim();
        const key = `${alert.warehouse}:::${alert.sku}:::${alert.lotNumber || ''}:::${alertOwner}`;
        if (!activeLotKeysScanned.has(key)) {
          // Verify if lot and owner has truly 0 stock remaining across inventory
          const balRemaining = await InventoryBalance.find({
            company: companyObjectId,
            warehouse: alert.warehouse,
            sku: alert.sku,
            lotNumber: alert.lotNumber || '',
            owner: alert.owner
          }).lean();

          const totalStock = balRemaining.reduce((sum, b) => 
            sum + (b.qtyAvailable || 0) + (b.qtyReserved || 0) + (b.qtyAwaitingPutaway || 0) + (b.qtyQuarantine || 0), 0);

          if (totalStock === 0) {
            alert.status = 'RESOLVED';
            alert.resolvedAt = evalNow;
            alert.resolutionReason = 'STOCK_DEPLETED';
            alert.qtyAvailable = 0;
            alert.qtyReserved = 0;
            alert.qtyAwaitingPutaway = 0;
            alert.qtyQuarantine = 0;
            alert.totalQty = 0;
            alert.locations = [];
            alert.lastEvaluatedAt = evalNow;
            await alert.save();
            autoResolvedCount++;
          }
        }
      }
    }

    const durationMs = Date.now() - startTime;

    return {
      success: true,
      dryRun: isDryRun,
      runId: currentRunId,
      companyId: companyObjectId,
      warehouse: warehouse || 'ALL_WAREHOUSES',
      evaluationNow: evalNow.toISOString(),
      durationMs,
      summary: {
        balancesScanned: balances.length,
        lotsEvaluated: lotGroups.size,
        alertFindingsCount: findings.length,
        alertsCreated: createdCount,
        alertsUpdated: updatedCount,
        alertsAutoResolved: autoResolvedCount,
        notificationsCreated: notificationsCount,
        dataQualityExceptionsCount: dataQualityExceptions.length
      },
      findings: isDryRun ? findings : undefined,
      dataQualityExceptions
    };
  },

  /**
   * Helper to create an in-app notification on initial alert creation.
   */
  async _createInitialNotification({ companyId, alert }) {
    try {
      const notifKind = alert.severity === 'EXPIRED' || alert.severity === 'CRITICAL' ? 'error' : 'warning';
      await Notification.create({
        company: companyId,
        kind: notifKind,
        title: `[EXPIRY ALERT - ${alert.severity}] SKU: ${alert.sku}, Lot: ${alert.lotNumber || 'N/A'}`,
        body: `Stock in ${alert.warehouse} (${alert.totalQty} units) has ${alert.daysRemaining} days remaining before expiry. Threshold breached: ${alert.thresholdBreached}. Action: ${alert.actionRequired}.`
      });
    } catch (err) {
      console.error('[ExpiryAlertService] Notification generation failed (non-blocking):', err.message);
    }
  },

  /**
   * Helper to create an in-app notification when an alert escalates in severity.
   */
  async _createEscalationNotification({ companyId, alert, oldSeverity, newSeverity }) {
    try {
      const notifKind = newSeverity === 'EXPIRED' || newSeverity === 'CRITICAL' ? 'error' : 'warning';
      await Notification.create({
        company: companyId,
        kind: notifKind,
        title: `[EXPIRY ESCALATION - ${newSeverity}] SKU: ${alert.sku}, Lot: ${alert.lotNumber || 'N/A'}`,
        body: `Expiry alert severity escalated from ${oldSeverity} to ${newSeverity} (${alert.daysRemaining} days remaining). Warehouse: ${alert.warehouse}, Total Qty: ${alert.totalQty}.`
      });
    } catch (err) {
      console.error('[ExpiryAlertService] Escalation notification generation failed (non-blocking):', err.message);
    }
  },

  /**
   * Acknowledges an existing OPEN expiry alert.
   *
   * @param {Object} params
   * @param {ObjectId|string} params.alertId - Alert to acknowledge
   * @param {ObjectId|string} params.companyId - Authenticated tenant context
   * @param {Object} params.user - Authenticated user performing action
   * @param {string} [params.note] - Optional acknowledgment note
   */
  async acknowledgeAlert({ alertId, companyId, user, note = '' }) {
    if (!alertId || !companyId) {
      const err = new Error('alertId and companyId are required');
      err.status = 400;
      throw err;
    }

    const alert = await ExpiryAlert.findOne({ _id: alertId, company: companyId });
    if (!alert) {
      const err = new Error('Expiry alert not found');
      err.status = 404;
      throw err;
    }

    if (alert.status !== 'OPEN') {
      const err = new Error(`Cannot acknowledge alert in '${alert.status}' state. Only OPEN alerts can be acknowledged.`);
      err.status = 400;
      throw err;
    }

    alert.status = 'ACKNOWLEDGED';
    alert.acknowledgedAt = new Date();
    alert.acknowledgedBy = user?._id || null;
    alert.acknowledgedByName = user?.name || user?.email || 'Authorized Operator';
    alert.acknowledgementNote = note.trim();

    await alert.save();

    // Log to ActivityLog
    try {
      await ActivityLog.create({
        logId: `ACT-ACK-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        user: alert.acknowledgedByName,
        role: user?.role || 'manager',
        action: 'EXPIRY_ALERT_ACKNOWLEDGED',
        module: 'inventory',
        detail: `Expiry alert for SKU ${alert.sku}, Lot '${alert.lotNumber}' acknowledged: ${note || 'No notes'}`,
        company: companyId
      });
    } catch (logErr) {
      console.error('[ExpiryAlertService] ActivityLog creation failed:', logErr.message);
    }

    return alert;
  },

  /**
   * Resolves an active OPEN or ACKNOWLEDGED expiry alert.
   *
   * @param {Object} params
   * @param {ObjectId|string} params.alertId - Alert to resolve
   * @param {ObjectId|string} params.companyId - Authenticated tenant context
   * @param {Object} params.user - Authenticated user performing action
   * @param {string} [params.reason] - Disposition/resolution reason
   */
  async resolveAlert({ alertId, companyId, user, reason = 'MANUAL_DISPOSITION' }) {
    if (!alertId || !companyId) {
      const err = new Error('alertId and companyId are required');
      err.status = 400;
      throw err;
    }

    const alert = await ExpiryAlert.findOne({ _id: alertId, company: companyId });
    if (!alert) {
      const err = new Error('Expiry alert not found');
      err.status = 404;
      throw err;
    }

    if (!['OPEN', 'ACKNOWLEDGED'].includes(alert.status)) {
      const err = new Error(`Cannot resolve alert in '${alert.status}' state. Only OPEN or ACKNOWLEDGED alerts can be resolved.`);
      err.status = 400;
      throw err;
    }

    alert.status = 'RESOLVED';
    alert.resolvedAt = new Date();
    alert.resolvedBy = user?._id || null;
    alert.resolvedByName = user?.name || user?.email || 'Authorized Operator';
    alert.resolutionReason = reason.trim();

    await alert.save();

    // Log to ActivityLog
    try {
      await ActivityLog.create({
        logId: `ACT-RES-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        user: alert.resolvedByName,
        role: user?.role || 'manager',
        action: 'EXPIRY_ALERT_RESOLVED',
        module: 'inventory',
        detail: `Expiry alert for SKU ${alert.sku}, Lot '${alert.lotNumber}' resolved. Reason: ${reason}`,
        company: companyId
      });
    } catch (logErr) {
      console.error('[ExpiryAlertService] ActivityLog creation failed:', logErr.message);
    }

    return alert;
  },

  /**
   * Dismisses an active OPEN or ACKNOWLEDGED expiry alert.
   *
   * @param {Object} params
   * @param {ObjectId|string} params.alertId - Alert to dismiss
   * @param {ObjectId|string} params.companyId - Authenticated tenant context
   * @param {Object} params.user - Authenticated user performing action
   * @param {string} [params.reason] - Reason for dismissal
   */
  async dismissAlert({ alertId, companyId, user, reason = 'SUPERVISOR_DISMISSED' }) {
    if (!alertId || !companyId) {
      const err = new Error('alertId and companyId are required');
      err.status = 400;
      throw err;
    }

    const alert = await ExpiryAlert.findOne({ _id: alertId, company: companyId });
    if (!alert) {
      const err = new Error('Expiry alert not found');
      err.status = 404;
      throw err;
    }

    if (!['OPEN', 'ACKNOWLEDGED'].includes(alert.status)) {
      const err = new Error(`Cannot dismiss alert in '${alert.status}' state. Only OPEN or ACKNOWLEDGED alerts can be dismissed.`);
      err.status = 400;
      throw err;
    }

    alert.status = 'DISMISSED';
    alert.dismissedAt = new Date();
    alert.dismissedBy = user?._id || null;
    alert.dismissedByName = user?.name || user?.email || 'Authorized Operator';
    alert.dismissalReason = reason.trim();

    await alert.save();

    // Log to ActivityLog
    try {
      await ActivityLog.create({
        logId: `ACT-DIS-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        user: alert.dismissedByName,
        role: user?.role || 'manager',
        action: 'EXPIRY_ALERT_DISMISSED',
        module: 'inventory',
        detail: `Expiry alert for SKU ${alert.sku}, Lot '${alert.lotNumber}', Owner '${alert.owner}' dismissed. Reason: ${reason}`,
        company: companyId
      });
    } catch (logErr) {
      console.error('[ExpiryAlertService] ActivityLog creation failed:', logErr.message);
    }

    return alert;
  },

  /**
   * Queries alerts with company scoping, filtering, and pagination.
   */
  async getAlerts({
    companyId,
    warehouse,
    sku,
    owner,
    severity,
    status,
    page = 1,
    limit = 50,
    sortBy = 'daysRemaining',
    sortDir = 'asc'
  }) {
    if (!companyId) throw new Error('companyId is required');

    const query = { company: companyId };
    if (warehouse) query.warehouse = warehouse;
    if (sku) query.sku = sku;
    if (owner) query.owner = owner;
    if (severity) query.severity = severity;
    if (status) query.status = status;

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 50));
    const skip = (pageNum - 1) * limitNum;

    const sortObj = {};
    sortObj[sortBy] = sortDir === 'desc' ? -1 : 1;

    const [items, total] = await Promise.all([
      ExpiryAlert.find(query)
        .sort(sortObj)
        .skip(skip)
        .limit(limitNum)
        .lean(),
      ExpiryAlert.countDocuments(query)
    ]);

    return {
      items,
      total,
      page: pageNum,
      limit: limitNum,
      totalPages: Math.ceil(total / limitNum)
    };
  }
};
