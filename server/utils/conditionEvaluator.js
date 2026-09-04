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
  
  // Resolve context value based on the field mapping
  const actualValue = resolveFieldValue(field, context);

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
      return Boolean(actualValue) === false || String(actualValue).toLowerCase() === 'false' || actualValue === undefined || actualValue === null;

    default:
      // Unknown operator, fail safe
      return false;
  }
}

function resolveFieldValue(field, context) {
  switch (field) {
    case 'product_category': return context.category;
    case 'owner': return context.owner;
    case 'temperature': return context.tempRequirement;
    case 'sku': return context.sku;
    case 'pallet_weight': return context.palletWeight;
    case 'abc_class': return context.abcClass;
    case 'has_lot_expiry': return context.expiryDate ? true : false;
    case 'supplier': return context.supplier;
    case 'pallet_type': return context.palletType;
    case 'qc_status': return context.qcStatus;
    case 'hazmat_class': return context.isHazmat ? 'hazmat' : 'none'; // simplified, depends on exact data
    case 'is_crossdock': return context.isCrossdock;
    default:
      return context[field]; // Fallback to direct property
  }
}
