const crypto = require('crypto');
const mongoose = require('mongoose');
const ApiError = require('./ApiError');

/** Human-friendly unique reference, e.g. RFQ-261103-K7Q2ZP */
function generateCode(prefix) {
  const now = new Date();
  const datePart = [
    String(now.getUTCFullYear()).slice(-2),
    String(now.getUTCMonth() + 1).padStart(2, '0'),
    String(now.getUTCDate()).padStart(2, '0'),
  ].join('');
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let random = '';
  for (let i = 0; i < 6; i += 1) {
    random += alphabet[crypto.randomInt(0, alphabet.length)];
  }
  return `${prefix}-${datePart}-${random}`;
}

/** Cryptographically random numeric PIN with leading zeros preserved. */
function generateNumericPin(length = 6) {
  const max = 10 ** length;
  return String(crypto.randomInt(0, max)).padStart(length, '0');
}

/** Constant-time string comparison (prevents timing attacks on PIN checks). */
function safeEqual(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/** Round currency to 2 decimals without floating point drift. */
function roundMoney(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function round(value, decimals = 4) {
  const factor = 10 ** decimals;
  return Math.round((Number(value) + Number.EPSILON) * factor) / factor;
}

function assertObjectId(id, label = 'id') {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw ApiError.badRequest(`Invalid ${label}`);
  }
}

function parsePagination(query, { defaultLimit = 20, maxLimit = 100 } = {}) {
  const page = Math.max(1, Number.parseInt(query.page, 10) || 1);
  const limit = Math.min(maxLimit, Math.max(1, Number.parseInt(query.limit, 10) || defaultLimit));
  return { page, limit, skip: (page - 1) * limit };
}

function pick(source, keys) {
  return keys.reduce((acc, key) => {
    if (source && source[key] !== undefined) acc[key] = source[key];
    return acc;
  }, {});
}

function escapeRegex(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function idEquals(a, b) {
  if (!a || !b) return false;
  const left = a._id ? a._id : a;
  const right = b._id ? b._id : b;
  return String(left) === String(right);
}

module.exports = {
  generateCode,
  generateNumericPin,
  safeEqual,
  roundMoney,
  round,
  assertObjectId,
  parsePagination,
  pick,
  escapeRegex,
  idEquals,
};
