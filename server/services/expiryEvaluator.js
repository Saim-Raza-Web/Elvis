/**
 * Service: Pure Expiry Evaluator (Stage 8)
 * 
 * PURE FUNCTIONAL ENGINE:
 * - Zero database access
 * - Zero filesystem access
 * - Zero network/API calls
 * - Zero inventory mutation
 * - 100% deterministic calendar-accurate date arithmetic
 * - Normalizes to UTC calendar midnight to eliminate DST and timezone offset drift
 */

export const CATEGORY_THRESHOLDS = Object.freeze({
  'PHARMA': Object.freeze({ tAlert: 365, tBlock: 180, tWithdrawal: 60 }),
  'FOOD-DRY': Object.freeze({ tAlert: 180, tBlock: 90, tWithdrawal: 30 }),
  'BEVERAGE': Object.freeze({ tAlert: 120, tBlock: 60, tWithdrawal: 14 }),
  'COLD': Object.freeze({ tAlert: 60, tBlock: 30, tWithdrawal: 7 }),
  'GEN': Object.freeze({ tAlert: 90, tBlock: 45, tWithdrawal: 14 }),
  'HAZMAT': Object.freeze({ tAlert: 90, tBlock: 45, tWithdrawal: 14 })
});

/**
 * Maps raw category names or codes to standard category keys.
 */
export function normalizeCategoryCode(rawCategory) {
  if (!rawCategory || typeof rawCategory !== 'string') return 'GEN';
  const clean = rawCategory.trim().toUpperCase();

  if (CATEGORY_THRESHOLDS[clean]) return clean;

  // Semantic alias mappings
  if (clean.includes('PHARMA') || clean.includes('MEDICINE')) return 'PHARMA';
  if (clean.includes('FOOD') || clean.includes('DRY')) return 'FOOD-DRY';
  if (clean.includes('BEV') || clean.includes('DRINK')) return 'BEVERAGE';
  if (clean.includes('COLD') || clean.includes('CHILL') || clean.includes('FREEZ')) return 'COLD';
  if (clean.includes('HAZ') || clean.includes('CHEM')) return 'HAZMAT';

  return 'GEN';
}

/**
 * Extracts calendar year, month (1-12), and day (1-31) in a given IANA timezone.
 */
export function getCalendarParts(dateInput, timeZone = 'UTC') {
  if (!dateInput) return null;

  // If string formatted as YYYY-MM-DD, parse directly to preserve pure calendar meaning
  if (typeof dateInput === 'string') {
    const match = dateInput.trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (match) {
      const year = parseInt(match[1], 10);
      const month = parseInt(match[2], 10);
      const day = parseInt(match[3], 10);
      if (!isNaN(year) && month >= 1 && month <= 12 && day >= 1 && day <= 31) {
        return { year, month, day };
      }
    }
  }

  const date = dateInput instanceof Date ? dateInput : new Date(dateInput);
  if (isNaN(date.getTime())) return null;

  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timeZone || 'UTC',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour12: false
    });

    const parts = formatter.formatToParts(date);
    let year, month, day;
    for (const p of parts) {
      if (p.type === 'year') year = parseInt(p.value, 10);
      if (p.type === 'month') month = parseInt(p.value, 10);
      if (p.type === 'day') day = parseInt(p.value, 10);
    }
    return { year, month, day };
  } catch (_) {
    // Fallback to UTC if timezone is invalid
    return {
      year: date.getUTCFullYear(),
      month: date.getUTCMonth() + 1,
      day: date.getUTCDate()
    };
  }
}

/**
 * Calculates calendar day difference (targetDate - baseDate).
 * Positive if targetDate is in the future.
 * Negative if targetDate is in the past.
 * Zero if targetDate is today.
 */
export function calculateCalendarDaysRemaining(targetDate, baseDate, timeZone = 'UTC') {
  const targetParts = getCalendarParts(targetDate, 'UTC'); // Expiry dates are calendar dates
  const baseParts = getCalendarParts(baseDate, timeZone); // Evaluation date in company timezone

  if (!targetParts || !baseParts) return null;

  const targetUtc = Date.UTC(targetParts.year, targetParts.month - 1, targetParts.day);
  const baseUtc = Date.UTC(baseParts.year, baseParts.month - 1, baseParts.day);

  const diffMs = targetUtc - baseUtc;
  return Math.round(diffMs / 86400000);
}

/**
 * Evaluates expiry status of an item.
 *
 * @param {Object} params
 * @param {Date|string} params.expiryDate - Physical lot expiry date
 * @param {Date|string} [params.evaluationNow=new Date()] - Reference evaluation date
 * @param {string} [params.category='GEN'] - Product category code
 * @param {Object} [params.thresholds] - Optional custom threshold overrides { tAlert, tBlock, tWithdrawal }
 * @param {string} [params.timeZone='UTC'] - Operational evaluation timezone (from Company.timezone)
 * @param {Object} [params.productMetadata] - Optional product tracking flags { fefo, lot_tracking }
 * @returns {Object} Deterministic evaluation result
 */
export function evaluateExpiryItem({
  expiryDate,
  evaluationNow = new Date(),
  category = 'GEN',
  thresholds = null,
  timeZone = 'UTC',
  productMetadata = null
}) {
  // 1. Missing Expiry Date Handling
  if (expiryDate === null || expiryDate === undefined || expiryDate === '') {
    const isTracked = productMetadata && (productMetadata.fefo || productMetadata.lot_tracking);
    if (isTracked) {
      return {
        status: 'DATA_QUALITY_EXCEPTION',
        reason: 'MISSING_EXPIRY_DATE',
        shouldAlert: false,
        severity: null,
        daysRemaining: null,
        isExpired: false,
        thresholdBreached: null,
        category: normalizeCategoryCode(category),
        actionRequired: 'AUDIT_DATA_QUALITY',
        details: 'Product requires lot/FEFO tracking but inventory balance is missing expiryDate'
      };
    }
    return {
      status: 'NOT_MONITORED',
      reason: 'NON_PERISHABLE_OR_NOT_LOT_TRACKED',
      shouldAlert: false,
      severity: null,
      daysRemaining: null,
      isExpired: false,
      thresholdBreached: null,
      category: normalizeCategoryCode(category),
      actionRequired: 'NONE',
      details: 'Product is not perishable or lot-tracked; expiry is not monitored'
    };
  }

  // 2. Invalid Date Check
  const daysRemaining = calculateCalendarDaysRemaining(expiryDate, evaluationNow, timeZone);
  if (daysRemaining === null || isNaN(daysRemaining)) {
    return {
      status: 'DATA_QUALITY_ERROR',
      reason: 'INVALID_EXPIRY_DATE',
      shouldAlert: false,
      severity: null,
      daysRemaining: null,
      isExpired: false,
      thresholdBreached: null,
      category: normalizeCategoryCode(category),
      actionRequired: 'AUDIT_DATA_QUALITY',
      details: `Expiry date value '${expiryDate}' could not be parsed as a valid calendar date`
    };
  }

  // 3. Resolve Category Thresholds
  const normCategory = normalizeCategoryCode(category);
  const categoryConfig = thresholds || CATEGORY_THRESHOLDS[normCategory] || CATEGORY_THRESHOLDS['GEN'];

  const tAlert = categoryConfig.tAlert;
  const tBlock = categoryConfig.tBlock;
  const tWithdrawal = categoryConfig.tWithdrawal;

  // 4. Exact Boundary Classification
  // daysRemaining <= 0 -> EXPIRED
  // 0 < daysRemaining <= T_WITHDRAWAL -> CRITICAL
  // T_WITHDRAWAL < daysRemaining <= T_BLOCK -> HIGH
  // T_BLOCK < daysRemaining <= T_ALERT -> WARNING
  // daysRemaining > T_ALERT -> NORMAL
  let severity = 'NORMAL';
  let thresholdBreached = 'NONE';
  let shouldAlert = false;
  let actionRequired = 'NONE';
  const isExpired = daysRemaining <= 0;

  if (daysRemaining <= 0) {
    severity = 'EXPIRED';
    thresholdBreached = 'EXPIRED';
    shouldAlert = true;
    actionRequired = 'QUARANTINE_OR_SCRAP';
  } else if (daysRemaining <= tWithdrawal) {
    severity = 'CRITICAL';
    thresholdBreached = 'T_WITHDRAWAL';
    shouldAlert = true;
    actionRequired = 'FORCED_WITHDRAWAL';
  } else if (daysRemaining <= tBlock) {
    severity = 'HIGH';
    thresholdBreached = 'T_BLOCK';
    shouldAlert = true;
    actionRequired = 'BLOCK_OUTBOUND';
  } else if (daysRemaining <= tAlert) {
    severity = 'WARNING';
    thresholdBreached = 'T_ALERT';
    shouldAlert = true;
    actionRequired = 'WAREHOUSE_ALERT';
  } else {
    severity = 'NORMAL';
    thresholdBreached = 'NONE';
    shouldAlert = false;
    actionRequired = 'NONE';
  }

  return {
    status: 'EVALUATED',
    shouldAlert,
    severity,
    thresholdBreached,
    daysRemaining,
    isExpired,
    category: normCategory,
    thresholdsApplied: {
      tAlert,
      tBlock,
      tWithdrawal
    },
    actionRequired,
    evaluationNow: evaluationNow instanceof Date ? evaluationNow.toISOString() : new Date(evaluationNow).toISOString(),
    expiryDate: expiryDate instanceof Date ? expiryDate.toISOString() : expiryDate
  };
}
