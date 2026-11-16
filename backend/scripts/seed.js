/**
 * Seeds the platform admin and (optionally) demo accounts for testing/viva demonstrations.
 *
 *   npm run seed:admin   -> admin only
 *   npm run seed         -> admin + 1 demo buyer + 4 demo vendors (3 verified, 1 pending)
 *
 * Idempotent: existing accounts (matched by email) are left untouched.
 */
const { config, assertRequiredEnv } = require('../config/env');
const { connectDB, disconnectDB } = require('../config/db');
const { User } = require('../models');
const { ROLES } = require('../config/constants');

const adminOnly = process.argv.includes('--admin-only');
const demoPassword = process.env.SEED_DEMO_PASSWORD || 'Demo@12345';

const inYears = (n) => {
  const d = new Date();
  d.setFullYear(d.getFullYear() + n);
  return d;
};

const DEMO_USERS = [
  { role: ROLES.BUYER, name: 'Nimali Perera', email: 'buyer@customt.lk', phone: '+94771234567' },
  {
    role: ROLES.VENDOR,
    name: 'Kasun Silva',
    email: 'vendor1@customt.lk',
    phone: '+94772223344',
    companyName: 'Colombo Print Works (Pvt) Ltd',
    businessRegNo: 'PV-104522',
    capabilities: ['Screen Printing', 'DTF'],
    maxCapacity: 1000,
    trustScore: 4.4,
    skillBadges: ['Verified Quality', 'Bulk Specialist'],
    isVerified: true,
    licenseExpiryDate: inYears(2),
  },
  {
    role: ROLES.VENDOR,
    name: 'Tharindu Jayasinghe',
    email: 'vendor2@customt.lk',
    phone: '+94775556677',
    companyName: 'Kandy Threadcraft',
    businessRegNo: 'PV-208811',
    capabilities: ['Embroidery', 'Screen Printing'],
    maxCapacity: 300,
    trustScore: 3.9,
    skillBadges: ['Premium Embroidery'],
    isVerified: true,
    licenseExpiryDate: inYears(1),
  },
  {
    role: ROLES.VENDOR,
    name: 'Fathima Rizwan',
    email: 'vendor3@customt.lk',
    phone: '+94778889900',
    companyName: 'Galle Sublimation Studio',
    businessRegNo: 'PV-310045',
    capabilities: ['Sublimation', 'DTF', 'Screen Printing'],
    maxCapacity: 500,
    trustScore: 3.5,
    skillBadges: ['Fast Delivery'],
    isVerified: true,
    licenseExpiryDate: inYears(1),
  },
  {
    role: ROLES.VENDOR,
    name: 'Ruwan Bandara',
    email: 'vendor4@customt.lk',
    phone: '+94770001122',
    companyName: 'Negombo Tees (Pending)',
    businessRegNo: 'PV-411290',
    capabilities: ['Screen Printing'],
    maxCapacity: 200,
    isVerified: false,
    licenseExpiryDate: inYears(1),
  },
];

async function upsertUser(data, password) {
  const existing = await User.findOne({ email: data.email });
  if (existing) {
    // eslint-disable-next-line no-console
    console.log(`  = ${data.email} already exists (${existing.role})`);
    return existing;
  }
  const user = new User(data);
  await user.setPassword(password);
  await user.save();
  // eslint-disable-next-line no-console
  console.log(`  + created ${data.role.padEnd(6)} ${data.email}`);
  return user;
}

/**
 * The fallback passwords are published in the README, so a production database must never get them:
 * in production the seed refuses to run unless strong passwords are supplied through the environment.
 */
function assertSafeSeedPasswords() {
  if (!config.isProduction) return;
  const strong = (p) => typeof p === 'string' && /^(?=.*[A-Za-z])(?=.*\d).{12,64}$/.test(p) && !/^(Admin|Demo)@12345$/.test(p);
  const problems = [];
  if (!strong(process.env.SEED_ADMIN_PASSWORD)) problems.push('SEED_ADMIN_PASSWORD (12+ characters, letters and digits)');
  if (!adminOnly && !strong(process.env.SEED_DEMO_PASSWORD)) problems.push('SEED_DEMO_PASSWORD (12+ characters, letters and digits)');
  if (problems.length) {
    // eslint-disable-next-line no-console
    console.error(`[seed] Refusing to seed production with default passwords. Set: ${problems.join(', ')}.`);
    process.exit(1);
  }
}

async function run() {
  assertRequiredEnv();
  assertSafeSeedPasswords();
  await connectDB(config.mongoUri);

  // eslint-disable-next-line no-console
  console.log('[seed] Admin account');
  await upsertUser(
    {
      role: ROLES.ADMIN,
      name: process.env.SEED_ADMIN_NAME || 'Platform Admin',
      email: (process.env.SEED_ADMIN_EMAIL || 'admin@customt.lk').toLowerCase(),
    },
    process.env.SEED_ADMIN_PASSWORD || 'Admin@12345'
  );

  if (!adminOnly) {
    // eslint-disable-next-line no-console
    console.log(`[seed] Demo accounts (password: ${demoPassword})`);
    for (const user of DEMO_USERS) {
      // eslint-disable-next-line no-await-in-loop
      await upsertUser(user, demoPassword);
    }
  }

  await disconnectDB();
  // eslint-disable-next-line no-console
  console.log('[seed] Done');
}

run().catch(async (err) => {
  // eslint-disable-next-line no-console
  console.error('[seed] Failed:', err.message);
  await disconnectDB().catch(() => {});
  process.exit(1);
});
