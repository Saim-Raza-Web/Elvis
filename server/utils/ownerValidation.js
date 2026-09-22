import Client from '../models/Client.js';

/**
 * G-01: Central Client/Owner Master Enforcement
 * Validates that an owner string actually exists in the Client collection
 * when the ownerType is 'CUSTOMER' (3PL client).
 */
export async function validateOwnerMaster(owner, ownerType, companyId) {
  const cleanOwner = typeof owner === 'string' ? owner.trim() : '';

  // If ownerType is 'COMPANY' or owner is 'Internal Stock', bypass Client check
  if (ownerType === 'COMPANY' || cleanOwner === 'Internal Stock') {
    return null;
  }

  if (ownerType === 'CUSTOMER' || cleanOwner) {
    if (!cleanOwner) return 'Owner (3PL) name is required when ownerType is CUSTOMER.';

    const clientDoc = await Client.findOne({ name: cleanOwner, company: companyId });
    if (!clientDoc) {
      return `Invalid Owner: '${cleanOwner}' is not a registered, active 3PL Client.`;
    }
    if (clientDoc.active === false) {
      return `Invalid Owner: '${cleanOwner}' is an inactive 3PL Client. Inactive clients cannot be selected for operations.`;
    }
  }
  return null;
}
