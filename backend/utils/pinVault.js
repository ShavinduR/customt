/**
 * Encryption at rest for O2O PINs.
 *
 * The buyer must be able to view the PIN again (GET /api/orders/:id/o2o), so it can't be hashed. It is
 * stored as AES-256-GCM ciphertext instead: someone who reads the database (a leaked backup, a stray
 * export, an over-privileged DB user) does not learn the PIN that releases the 70% final payment.
 * The key is derived from JWT_SECRET with HKDF, so no extra secret has to be configured.
 *
 * Format: "v1.<iv>.<tag>.<ciphertext>" (base64url). Older orders that still hold a plain 6-digit PIN are
 * read as-is, so in-flight orders keep working after deployment.
 */
const crypto = require('crypto');
const { config } = require('../config/env');

let cachedKey = null;
function key() {
  if (!cachedKey) {
    cachedKey = Buffer.from(crypto.hkdfSync('sha256', config.jwtSecret, 'customt-o2o-pin', 'o2o-pin-aes-256-gcm', 32));
  }
  return cachedKey;
}

function sealPin(pin) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const ciphertext = Buffer.concat([cipher.update(String(pin), 'utf8'), cipher.final()]);
  return ['v1', iv, cipher.getAuthTag(), ciphertext].map((part) => (Buffer.isBuffer(part) ? part.toString('base64url') : part)).join('.');
}

/** Returns the plain PIN, or null when the value can't be decrypted (e.g. JWT_SECRET was rotated). */
function openPin(stored) {
  if (!stored) return null;
  if (/^\d{6}$/.test(stored)) return stored; // legacy plain PIN
  const [version, iv, tag, ciphertext] = String(stored).split('.');
  if (version !== 'v1' || !iv || !tag || !ciphertext) return null;
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64url'));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(ciphertext, 'base64url')), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}

module.exports = { sealPin, openPin };
