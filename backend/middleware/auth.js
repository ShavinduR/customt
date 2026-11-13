const jwt = require('jsonwebtoken');
const { config } = require('../config/env');
const { User } = require('../models');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const { ROLES } = require('../config/constants');

const JWT_ALGORITHM = 'HS256';

function signToken(user) {
  return jwt.sign({ sub: String(user._id), role: user.role }, config.jwtSecret, {
    algorithm: JWT_ALGORITHM,
    expiresIn: config.jwtExpiresIn,
  });
}

function verifyToken(token) {
  // Pin the algorithm so a token can never pick a weaker one (e.g. "none" or an asymmetric-key confusion).
  return jwt.verify(token, config.jwtSecret, { algorithms: [JWT_ALGORITHM] });
}

function extractBearer(header = '') {
  const [scheme, token] = String(header).split(' ');
  return scheme && scheme.toLowerCase() === 'bearer' && token ? token : null;
}

/** Resolves a JWT into an active User document (shared by REST and Socket.IO). */
async function resolveUserFromToken(token) {
  if (!token) throw ApiError.unauthorized('Authentication token missing');
  let payload;
  try {
    payload = verifyToken(token);
  } catch (err) {
    throw ApiError.unauthorized(err.name === 'TokenExpiredError' ? 'Session expired - please log in again' : 'Invalid authentication token');
  }
  if (payload.purpose) throw ApiError.unauthorized('Invalid authentication token');
  const user = await User.findById(payload.sub);
  if (!user) throw ApiError.unauthorized('Account no longer exists');
  if (user.tokenIssuedBeforePasswordChange(payload.iat)) {
    throw ApiError.unauthorized('Your password was changed. Please log in again.', { code: 'PASSWORD_CHANGED' });
  }
  if (!user.isActive) throw ApiError.forbidden('Your account has been suspended. Please contact support.', { code: 'ACCOUNT_SUSPENDED' });
  return { user, issuedAt: payload.iat };
}

const protect = asyncHandler(async (req, _res, next) => {
  ({ user: req.user } = await resolveUserFromToken(extractBearer(req.headers.authorization)));
  next();
});

const authorize =
  (...roles) =>
  (req, _res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return next(ApiError.forbidden(`This action is restricted to: ${roles.join(', ')}`));
    }
    return next();
  };

/** PERA qualification-level lock for vendor-only auction endpoints. */
const requirePrequalifiedVendor = (req, _res, next) => {
  if (req.user.role !== ROLES.VENDOR) return next(ApiError.forbidden('Vendor account required'));
  const issues = req.user.qualificationIssues();
  if (issues.length) {
    return next(
      ApiError.forbidden('Your vendor account is not yet prequalified to access auction rooms', {
        code: 'PERA_QUALIFICATION_LOCK',
        details: issues,
      })
    );
  }
  return next();
};

module.exports = {
  signToken,
  verifyToken,
  extractBearer,
  resolveUserFromToken,
  JWT_ALGORITHM,
  protect,
  authorize,
  requirePrequalifiedVendor,
};
