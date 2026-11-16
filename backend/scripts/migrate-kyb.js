/**
 * One-off migration for KYB onboarding.
 *
 *   npm run migrate:kyb             # dry run: prints what would change
 *   npm run migrate:kyb -- --apply  # applies the changes
 *
 * Existing vendor accounts are grandfathered: vendorStatus becomes APPROVED and they keep working.
 * Verification (isVerified + licence date) is unchanged, so the PERA lock still applies, and admins can
 * still un-verify or suspend them from the Vendors page. Buyers without a status get NONE.
 * Safe to run more than once.
 */
const { assertRequiredEnv, config } = require('../config/env');
const { connectDB, disconnectDB } = require('../config/db');
const { User } = require('../models');

const apply = process.argv.includes('--apply');

async function run() {
  assertRequiredEnv();
  await connectDB(config.mongoUri);
  const vendors = { role: 'vendor', vendorStatus: { $ne: 'APPROVED' } };
  const buyers = { role: 'buyer', vendorStatus: { $exists: false } };
  const [vendorCount, buyerCount] = await Promise.all([User.countDocuments(vendors), User.countDocuments(buyers)]);
  // eslint-disable-next-line no-console
  console.log(`[migrate-kyb] ${vendorCount} vendor account(s) -> vendorStatus APPROVED (grandfathered)`);
  // eslint-disable-next-line no-console
  console.log(`[migrate-kyb] ${buyerCount} buyer account(s) -> vendorStatus NONE`);
  if (apply) {
    await User.updateMany(vendors, { $set: { vendorStatus: 'APPROVED' } });
    await User.updateMany(buyers, { $set: { vendorStatus: 'NONE' } });
    // eslint-disable-next-line no-console
    console.log('[migrate-kyb] Done.');
  } else {
    // eslint-disable-next-line no-console
    console.log('[migrate-kyb] Dry run only. Re-run with --apply to make these changes.');
  }
  await disconnectDB();
}

run().catch(async (err) => {
  // eslint-disable-next-line no-console
  console.error('[migrate-kyb] Failed:', err.message);
  await disconnectDB().catch(() => {});
  process.exit(1);
});
