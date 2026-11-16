/**
 * KYB status migration, shared by scripts/migrate-kyb.js and the TEMPORARY route
 * GET /api/run-kyb-migration (for hosts without shell access, such as Render's free plan).
 *
 * Existing vendor accounts are grandfathered (vendorStatus APPROVED); buyers without a status get NONE.
 * Only status labels change: role, verification and licence dates are untouched. Idempotent: a second
 * run finds nothing to change.
 */
const { User } = require('../models');

async function migrateKybStatuses({ apply = false } = {}) {
  const vendors = { role: 'vendor', vendorStatus: { $ne: 'APPROVED' } };
  const buyers = { role: 'buyer', vendorStatus: { $exists: false } };
  const [vendorsToApprove, buyersToInitialise] = await Promise.all([User.countDocuments(vendors), User.countDocuments(buyers)]);
  let vendorsUpdated = 0;
  let buyersUpdated = 0;
  if (apply) {
    vendorsUpdated = (await User.updateMany(vendors, { $set: { vendorStatus: 'APPROVED' } })).modifiedCount;
    buyersUpdated = (await User.updateMany(buyers, { $set: { vendorStatus: 'NONE' } })).modifiedCount;
  }
  return { applied: apply, vendorsToApprove, buyersToInitialise, vendorsUpdated, buyersUpdated };
}

module.exports = { migrateKybStatuses };
