const express = require('express');
const rateLimit = require('express-rate-limit');
const { User } = require('../models');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const { signToken, protect } = require('../middleware/auth');
const { ROLES, PRINT_TYPES } = require('../config/constants');
const realtime = require('../services/realtime');

const router = express.Router();

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 50,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { success: false, message: 'Too many attempts. Please try again in a few minutes.' },
});

const PASSWORD_RULE = /^(?=.*[A-Za-z])(?=.*\d).{8,64}$/;

function authResponse(user) {
  return {
    success: true,
    token: signToken(user),
    user: user.toJSON(),
  };
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
    if (!user || !(await user.comparePassword(password))) {
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
    if (req.body.name !== undefined) user.name = req.body.name;
    if (req.body.phone !== undefined) user.phone = req.body.phone;

    let requiresReverification = false;
    if (user.role === ROLES.VENDOR) {
      if (req.body.companyName !== undefined) user.companyName = req.body.companyName;
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
    res.json({ success: true, message: 'Password changed successfully' });
  })
);

module.exports = router;
