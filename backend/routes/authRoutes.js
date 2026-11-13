const express = require('express');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const { User } = require('../models');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const { signToken, protect } = require('../middleware/auth');
const { ROLES, PRINT_TYPES } = require('../config/constants');
const realtime = require('../services/realtime');
const { requestPasswordReset, userFromResetToken } = require('../services/passwordReset');
const { containsContactInfo } = require('../utils/contactFilter');

const router = express.Router();

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 50,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { success: false, message: 'Too many attempts. Please try again in a few minutes.' },
});

// Reset e-mails are expensive and could be used to flood an inbox, so they get a tighter budget.
const resetRequestLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { success: false, message: 'Too many reset requests. Please wait 15 minutes and try again.' },
});

// bcrypt hash (cost 12) of a random string; used only to equalise login timing for unknown e-mails.
const DUMMY_HASH = bcrypt.hashSync(require('crypto').randomBytes(16).toString('hex'), 12);

const PASSWORD_RULE = /^(?=.*[A-Za-z])(?=.*\d).{8,64}$/;
const EMAIL_RULE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function authResponse(user) {
  return {
    success: true,
    token: signToken(user),
    user: user.toJSON(),
  };
}

/**
 * Names and company names are shown to the other party (leaderboard, chat, orders), so they must not
 * carry phone numbers, e-mails, links or messaging handles that would bypass the chat filter.
 */
function assertCleanDisplayName(label, value) {
  if (value !== undefined && value !== null && containsContactInfo(String(value))) {
    throw ApiError.badRequest(`${label} must not contain phone numbers, e-mail addresses, links or messaging handles`, {
      code: 'CONTACT_INFO_IN_NAME',
    });
  }
}

/** Disconnects every open Socket.IO connection of a user (after a password change or reset). */
function disconnectUserSockets(userId) {
  const io = realtime.getIO();
  if (io) io.in(realtime.rooms.user(String(userId))).disconnectSockets(true);
}

function parseCapabilities(raw) {
  const list = Array.isArray(raw) ? raw : String(raw || '').split(',');
  const clean = [...new Set(list.map((c) => String(c).trim()).filter(Boolean))];
  const invalid = clean.filter((c) => !PRINT_TYPES.includes(c));
  if (invalid.length) throw ApiError.badRequest(`Unknown capabilities: ${invalid.join(', ')}. Allowed: ${PRINT_TYPES.join(', ')}`);
  return clean;
}

function parseLicenseDate(raw) {
  if (raw === undefined || raw === null || raw === '') return undefined;
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) throw ApiError.badRequest('licenseExpiryDate must be a valid date (YYYY-MM-DD)');
  return date;
}

/**
 * POST /api/auth/register
 * Buyer:  { role:"buyer", name, email, password, phone }
 * Vendor: { role:"vendor", name, email, password, phone, companyName, capabilities[], maxCapacity, businessRegNo, licenseExpiryDate? }
 */
router.post(
  '/register',
  authLimiter,
  asyncHandler(async (req, res) => {
    const { name, email, password, phone } = req.body;
    const role = req.body.role || ROLES.BUYER;

    if (![ROLES.BUYER, ROLES.VENDOR].includes(role)) {
      throw ApiError.badRequest('You can register as a buyer or a vendor only');
    }
    if (!PASSWORD_RULE.test(String(password || ''))) {
      throw ApiError.badRequest('Password must be 8-64 characters and contain at least one letter and one number');
    }
    assertCleanDisplayName('Name', name);
    if (role === ROLES.VENDOR) assertCleanDisplayName('Company name', req.body.companyName);
    if (await User.exists({ email: String(email || '').toLowerCase().trim() })) {
      throw ApiError.conflict('An account with this email already exists');
    }

    const user = new User({ name, email, phone, role });

    if (role === ROLES.VENDOR) {
      const maxCapacity = Number(req.body.maxCapacity);
      Object.assign(user, {
        companyName: req.body.companyName,
        businessRegNo: req.body.businessRegNo,
        capabilities: parseCapabilities(req.body.capabilities),
        maxCapacity: Number.isFinite(maxCapacity) ? maxCapacity : undefined,
        licenseExpiryDate: parseLicenseDate(req.body.licenseExpiryDate),
        isVerified: false,
      });
    }

    await user.setPassword(password);
    await user.save();

    if (role === ROLES.VENDOR) {
      realtime.emitToRole(ROLES.ADMIN, 'vendor:registered', {
        vendorId: String(user._id),
        name: user.name,
        companyName: user.companyName,
        capabilities: user.capabilities,
        maxCapacity: user.maxCapacity,
      });
    }

    res.status(201).json({
      ...authResponse(user),
      message:
        role === ROLES.VENDOR
          ? 'Registration received. Your business will be able to join auctions once a CustomT administrator verifies it.'
          : 'Welcome to CustomT!',
    });
  })
);

/** POST /api/auth/login { email, password } */
router.post(
  '/login',
  authLimiter,
  asyncHandler(async (req, res) => {
    const email = String(req.body.email || '').toLowerCase().trim();
    const password = String(req.body.password || '');
    if (!email || !password) throw ApiError.badRequest('Email and password are required');

    const user = await User.findOne({ email }).select('+passwordHash');
    // Compare against a dummy hash when the account doesn't exist, so response time doesn't reveal which e-mails are registered.
    const passwordOk = user ? await user.comparePassword(password) : await bcrypt.compare(password, DUMMY_HASH).then(() => false);
    if (!user || !passwordOk) {
      throw ApiError.unauthorized('Incorrect email or password');
    }
    if (!user.isActive) throw ApiError.forbidden('Your account has been suspended. Please contact support.', { code: 'ACCOUNT_SUSPENDED' });

    user.lastLoginAt = new Date();
    await user.save({ validateModifiedOnly: true });
    res.json(authResponse(user));
  })
);

/** GET /api/auth/me */
router.get(
  '/me',
  protect,
  asyncHandler(async (req, res) => {
    const user = req.user.toJSON();
    if (req.user.role === ROLES.VENDOR) {
      user.qualificationIssues = req.user.qualificationIssues();
    }
    res.json({ success: true, user });
  })
);

/**
 * PATCH /api/auth/me - update own profile.
 * Vendors expanding capabilities or capacity lose verification until an admin re-approves (PERA integrity).
 */
router.patch(
  '/me',
  protect,
  asyncHandler(async (req, res) => {
    const user = req.user;
    assertCleanDisplayName('Name', req.body.name);
    if (req.body.name !== undefined) user.name = req.body.name;
    if (req.body.phone !== undefined) user.phone = req.body.phone;

    let requiresReverification = false;
    if (user.role === ROLES.VENDOR) {
      if (req.body.companyName !== undefined) {
        assertCleanDisplayName('Company name', req.body.companyName);
        const next = String(req.body.companyName).trim();
        // The verified business identity changes: an administrator must confirm it again.
        if (next !== user.companyName) requiresReverification = true;
        user.companyName = next;
      }
      if (req.body.capabilities !== undefined) {
        const next = parseCapabilities(req.body.capabilities);
        if (next.some((c) => !user.capabilities.includes(c))) requiresReverification = true;
        user.capabilities = next;
      }
      if (req.body.maxCapacity !== undefined) {
        const next = Number(req.body.maxCapacity);
        if (next > user.maxCapacity) requiresReverification = true;
        user.maxCapacity = next;
      }
      if (req.body.licenseExpiryDate !== undefined) {
        const next = parseLicenseDate(req.body.licenseExpiryDate);
        if (!user.licenseExpiryDate || !next || next.getTime() !== user.licenseExpiryDate.getTime()) requiresReverification = true;
        user.licenseExpiryDate = next;
      }
      if (requiresReverification && user.isVerified) {
        user.isVerified = false;
        user.verificationNotes = 'Profile changes require re-verification by an administrator.';
        realtime.emitToRole(ROLES.ADMIN, 'vendor:registered', {
          vendorId: String(user._id),
          name: user.name,
          companyName: user.companyName,
          reverification: true,
        });
      }
    }

    await user.save();
    res.json({
      success: true,
      user: user.toJSON(),
      message: requiresReverification ? 'Profile updated. Your new capabilities will be active after admin re-verification.' : 'Profile updated.',
    });
  })
);

/** PATCH /api/auth/me/password { currentPassword, newPassword } */
router.patch(
  '/me/password',
  protect,
  asyncHandler(async (req, res) => {
    const { currentPassword, newPassword } = req.body;
    const user = await User.findById(req.user._id).select('+passwordHash');
    if (!(await user.comparePassword(String(currentPassword || '')))) {
      throw ApiError.badRequest('Current password is incorrect');
    }
    if (!PASSWORD_RULE.test(String(newPassword || ''))) {
      throw ApiError.badRequest('New password must be 8-64 characters and contain at least one letter and one number');
    }
    await user.setPassword(newPassword);
    await user.save({ validateModifiedOnly: true });
    // Live sockets were authenticated with the old token: close them (this tab reconnects with the new token).
    disconnectUserSockets(user._id);
    // Older sessions are now rejected, so hand this one a fresh token to stay logged in.
    res.json({ success: true, message: 'Password changed successfully. Other devices have been signed out.', token: signToken(user) });
  })
);

/**
 * POST /api/auth/forgot-password { email }
 * Always answers the same way, whether or not the account exists, so it can't be used to probe e-mails.
 */
router.post(
  '/forgot-password',
  resetRequestLimiter,
  asyncHandler(async (req, res) => {
    const email = String(req.body.email || '').toLowerCase().trim();
    if (!EMAIL_RULE.test(email)) throw ApiError.badRequest('Enter a valid email address');
    await requestPasswordReset(email);
    res.json({
      success: true,
      message: 'If an account exists for that email, we have sent a link to reset the password. Check your inbox and spam folder.',
    });
  })
);

/** POST /api/auth/reset-password { token, password } */
router.post(
  '/reset-password',
  authLimiter,
  asyncHandler(async (req, res) => {
    const password = String(req.body.password || '');
    if (!PASSWORD_RULE.test(password)) {
      throw ApiError.badRequest('Password must be 8-64 characters and contain at least one letter and one number');
    }
    const user = await userFromResetToken(req.body.token);
    await user.setPassword(password); // also invalidates this link and signs out every existing session
    await user.save({ validateModifiedOnly: true });
    disconnectUserSockets(user._id);
    res.json({ success: true, message: 'Your password has been reset. You can now log in with the new password.' });
  })
);

module.exports = router;
