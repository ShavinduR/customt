/**
 * Sri Lankan National Identity Card numbers.
 *
 * Formats: old "123456789V" / "123456789X" (9 digits + letter) and new "200012345678" (12 digits).
 * The full NIC is NEVER stored. We keep:
 *   - nicHash:  HMAC-SHA256 with a server-side key, so the same NIC on two applications can be detected
 *               (bcrypt is salted and can't find duplicates; a bare SHA-256 of a ~10^12 space is
 *               brute-forceable, the secret key prevents that)
 *   - nicLast4: for the reviewer to compare against the uploaded card image
 */
const crypto = require('crypto');
const { config } = require('../config/env');

const OLD_FORMAT = /^\d{9}[VX]$/;
const NEW_FORMAT = /^\d{12}$/;

function normaliseNic(raw) {
  return String(raw || '').toUpperCase().replace(/[\s-]/g, '');
}

function isValidNic(raw) {
  const nic = normaliseNic(raw);
  return OLD_FORMAT.test(nic) || NEW_FORMAT.test(nic);
}

/**
 * The same person has the same fingerprint whichever format they type: an old NIC "851234567V"
 * maps to the new 12-digit form "198512304567" (year 19 + yy, 3 day digits, 0, 4 serial digits).
 */
function canonicalNic(raw) {
  const nic = normaliseNic(raw);
  if (OLD_FORMAT.test(nic)) return `19${nic.slice(0, 2)}${nic.slice(2, 5)}0${nic.slice(5, 9)}`;
  return nic;
}

let cachedKey = null;
function hashKey() {
  if (!cachedKey) {
    cachedKey = process.env.KYB_HASH_KEY
      ? Buffer.from(process.env.KYB_HASH_KEY, 'utf8')
      : // Fallback for development / CI: derived from the JWT secret. Set KYB_HASH_KEY in production so
        // rotating JWT_SECRET never changes NIC fingerprints.
        Buffer.from(crypto.hkdfSync('sha256', config.jwtSecret, 'customt-kyb', 'nic-fingerprint', 32));
  }
  return cachedKey;
}

function nicFingerprint(raw) {
  return crypto.createHmac('sha256', hashKey()).update(canonicalNic(raw)).digest('hex');
}

function nicLast4(raw) {
  return normaliseNic(raw).replace(/[VX]$/, '').slice(-4);
}

module.exports = { normaliseNic, isValidNic, canonicalNic, nicFingerprint, nicLast4 };
