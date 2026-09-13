/**
 * StorageRule Condition Evaluator
 * Safely evaluates dynamic condition arrays using AND logic against a given context object.
 */

export function evaluateConditions(conditions, context) {
  if (!Array.isArray(conditions) || conditions.length === 0) {
    // A rule with no conditions is a default/catch-all rule that always matches.
    return true;
  }

  // AND logic: EVERY condition must evaluate to true
  return conditions.every(cond => {
    const res = evaluateSingleCondition(cond, context);
    console.log(`[DEBUG-COND] field:${cond.field} op:${cond.operator} val:${cond.value} | actual:${resolveFieldValue(cond.field, context)} => ${res}`);
    return res;
  });
}

function evaluateSingleCondition(condition, context) {
  const { field, operator, value } = condition;

  // Special case for HL-03: owner is exclusive_client
  if (field === 'owner' && value === 'exclusive_client') {
    const isExcl = Boolean(context?.isExclusiveClient || context?.exclusive_client);
    if (operator === 'is' || operator === 'yes') return isExcl;
    if (operator === 'is_not' || operator === 'no') return !isExcl;
    return false;
  }
  
  // Resolve context value based on the field mapping
  const actualValue = resolveFieldValue(field, context);

  // Missing data evaluates to false (unless checking 'no')
  if (actualValue === undefined || actualValue === null) {
    if (operator === 'no') return true;
    if (operator === 'is_not') return value !== undefined && value !== null && value !== '';
    return false;
  }

  switch (operator) {
    case 'is':
      return String(actualValue).toLowerCase() === String(value).toLowerCase();
      
    case 'is_not':
      return String(actualValue).toLowerCase() !== String(value).toLowerCase();
      
    case 'in_list':
      if (Array.isArray(value)) {
        return value.map(v => String(v).toLowerCase()).includes(String(actualValue).toLowerCase());
      }
      if (typeof value === 'string') {
        return value.split(',').map(v => v.trim().toLowerCase()).includes(String(actualValue).toLowerCase());
      }
      return false;

    case 'not_in_list':
      if (Array.isArray(value)) {
        return !value.map(v => String(v).toLowerCase()).includes(String(actualValue).toLowerCase());
      }
      if (typeof value === 'string') {
        return !value.split(',').map(v => v.trim().toLowerCase()).includes(String(actualValue).toLowerCase());
      }
      return true;

    case 'greater_than':
      return Number(actualValue) > Number(value);

    case 'less_than':
      return Number(actualValue) < Number(value);

    case 'between':
      if (Array.isArray(value) && value.length === 2) {
        return Number(actualValue) >= Number(value[0]) && Number(actualValue) <= Number(value[1]);
      }
      return false;

    case 'yes':
      return Boolean(actualValue) === true || String(actualValue).toLowerCase() === 'true';

    case 'no':
      return Boolean(actualValue) === false || String(actualValue).toLowerCase() === 'false';

    default:
      // Unknown operator, fail safe
      return false;
  }
}

function resolveFieldValue(field, context) {
  if (!context) return undefined;
  switch (field) {
    case 'product_category': return context.category !== undefined ? context.category : context.product_category;
    case 'owner': return context.owner;
    case 'temperature': return context.tempRequirement !== undefined ? context.tempRequirement : context.temperature;
    case 'sku': return context.sku;
    case 'pallet_weight': return context.palletWeight !== undefined ? context.palletWeight : context.pallet_weight;
    case 'abc_class': return context.abcClass !== undefined ? context.abcClass : context.abc_class;
    case 'has_lot_expiry': 
      if (context.hasLotExpiry !== undefined) return context.hasLotExpiry;
      if (context.has_lot_expiry !== undefined) return context.has_lot_expiry;
      return context.expiryDate ? true : false;
    case 'supplier': return context.supplier;
    case 'pallet_type': return context.palletType !== undefined ? context.palletType : context.pallet_type;
    case 'qc_status': return context.qcStatus !== undefined ? context.qcStatus : context.qc_status;
    case 'hazmat_class': return context.hazmatClass || context.hazmat_class || (context.isHazmat ? 'HAZMAT' : undefined);
    case 'is_crossdock': return context.isCrossdock !== undefined ? context.isCrossdock : context.is_crossdock;
    default:
      return context[field];
  }
}
