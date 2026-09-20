import Client from '../models/Client.js';

/**
 * G-01: Central Client/Owner Master Enforcement
 * Validates that an owner string actually exists in the Client collection
 * when the ownerType is 'CUSTOMER' (3PL client).
 */
export async function validateOwnerMaster(owner, ownerType, companyId) {
  if (ownerType === 'CUSTOMER') {
    if (!owner) return 'Owner (3PL) name is required when ownerType is CUSTOMER.';
    const clientExists = await Client.findOne({ name: owner, company: companyId, active: true });
    if (!clientExists) {
      return `Invalid Owner: '${owner}' is not a registered, active 3PL Client.`;
    }
  }
  // If ownerType is 'COMPANY', we bypass the strict Client check because 
  // the owner is the company itself.
  return null;
}
