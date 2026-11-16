/**
 * Design images and dispute evidence must be files uploaded to CustomT itself.
 *
 * Allowing any http(s) URL let a user embed a link to their own site (a tracking pixel that reveals who
 * viewed an RFQ, or a "wa.me/<phone>" link that bypasses the chat filter). Only paths produced by
 * POST /api/uploads/logo are accepted: "/uploads/logos/<userId>-<timestamp>-<random>.<ext>", either relative
 * or prefixed with this API's public origin (PUBLIC_API_URL). When PUBLIC_API_URL is not configured
 * (local development, CI), the path is still enforced but the host is not.
 */
const { config } = require('../config/env');

const UPLOAD_PATH = /^\/uploads\/logos\/[a-f0-9]{24}-\d{10,16}-[a-f0-9]{8}\.(?:png|jpg|webp|svg)$/;

function isUploadedFileUrl(raw) {
  const url = typeof raw === 'string' ? raw.trim() : '';
  if (!url || url.length > 500) return false;
  if (url.startsWith('/')) return UPLOAD_PATH.test(url);
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.search || parsed.hash) return false;
  if (config.publicApiUrl && parsed.origin !== new URL(config.publicApiUrl).origin) return false;
  return UPLOAD_PATH.test(parsed.pathname);
}

module.exports = { isUploadedFileUrl, UPLOAD_PATH };
