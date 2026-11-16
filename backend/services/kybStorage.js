/**
 * Private storage for KYB documents (BR, NIC, utility bills, invoices).
 *
 * Drivers
 *  - 'r2'   : Cloudflare R2 (S3-compatible), used whenever KYB_S3_* is configured. The bucket has no
 *             public URL; objects are read only by the API, or through 60-second presigned links issued
 *             to admins.
 *  - 'local': a private folder OUTSIDE the public /uploads directory (never served by Express). Only for
 *             development and CI; refused when NODE_ENV=production.
 *  - none   : production without R2 -> KYB endpoints answer 503 instead of storing sensitive files on
 *             Render's public/ephemeral disk.
 *
 * Object keys are built only from server-side values: kyb/<userId>/<applicationId>/<TYPE>/<uuid>.<ext>
 */
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const { config } = require('../config/env');
const ApiError = require('../utils/ApiError');

const SIGNED_URL_SECONDS = 60;
const LOCAL_ROOT = path.resolve(__dirname, '..', 'private-kyb');

function r2Settings() {
  const { KYB_S3_ENDPOINT, KYB_S3_BUCKET, KYB_S3_ACCESS_KEY_ID, KYB_S3_SECRET_ACCESS_KEY } = process.env;
  if (!KYB_S3_ENDPOINT || !KYB_S3_BUCKET || !KYB_S3_ACCESS_KEY_ID || !KYB_S3_SECRET_ACCESS_KEY) return null;
  return { endpoint: KYB_S3_ENDPOINT, bucket: KYB_S3_BUCKET, accessKeyId: KYB_S3_ACCESS_KEY_ID, secretAccessKey: KYB_S3_SECRET_ACCESS_KEY };
}

function createR2Driver(settings) {
  // Required lazily so environments without KYB never load the SDK.
  const { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
  const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
  const client = new S3Client({
    region: 'auto', // required value for Cloudflare R2
    endpoint: settings.endpoint,
    credentials: { accessKeyId: settings.accessKeyId, secretAccessKey: settings.secretAccessKey },
  });
  return {
    name: 'r2',
    async put(key, body, contentType) {
      await client.send(
        new PutObjectCommand({ Bucket: settings.bucket, Key: key, Body: body, ContentType: contentType, ContentDisposition: 'attachment', CacheControl: 'no-store' })
      );
    },
    async stream(key) {
      const out = await client.send(new GetObjectCommand({ Bucket: settings.bucket, Key: key }));
      return out.Body; // Node.js Readable
    },
    async signedUrl(key, { contentType, filename }) {
      return getSignedUrl(
        client,
        new GetObjectCommand({
          Bucket: settings.bucket,
          Key: key,
          ResponseContentType: contentType,
          ResponseContentDisposition: `inline; filename="${filename}"`,
          ResponseCacheControl: 'no-store',
        }),
        { expiresIn: SIGNED_URL_SECONDS }
      );
    },
    async remove(key) {
      await client.send(new DeleteObjectCommand({ Bucket: settings.bucket, Key: key }));
    },
  };
}

function createLocalDriver() {
  const resolve = (key) => {
    const full = path.resolve(LOCAL_ROOT, key);
    if (!full.startsWith(`${LOCAL_ROOT}${path.sep}`)) throw new Error('Invalid storage key');
    return full;
  };
  return {
    name: 'local',
    async put(key, body) {
      const full = resolve(key);
      await fsp.mkdir(path.dirname(full), { recursive: true, mode: 0o700 });
      await fsp.writeFile(full, body, { mode: 0o600 });
    },
    async stream(key) {
      return fs.createReadStream(resolve(key));
    },
    async signedUrl() {
      return null; // not available locally: the admin UI streams through the API instead
    },
    async remove(key) {
      await fsp.rm(resolve(key), { force: true });
    },
  };
}

let driver;
function getDriver() {
  if (driver !== undefined) return driver;
  const settings = r2Settings();
  if (settings) driver = createR2Driver(settings);
  else if (!config.isProduction) driver = createLocalDriver();
  else driver = null;
  return driver;
}

/** Throws 503 when no private storage is configured (production without R2). */
function requireStorage() {
  const d = getDriver();
  if (!d) {
    throw ApiError.serviceUnavailable('Document storage is not configured yet. Please try again later.', { code: 'KYB_STORAGE_UNAVAILABLE' });
  }
  return d;
}

function objectKey({ userId, applicationId, type, ext }) {
  return `kyb/${userId}/${applicationId}/${type}/${crypto.randomUUID()}.${ext}`;
}

/** A safe display filename for Content-Disposition (never used as a storage path). */
function safeFilename(name, ext) {
  const base = String(name || 'document').replace(/\.[^.]*$/, '').replace(/[^\w.-]+/g, '_').slice(0, 60) || 'document';
  return `${base}.${ext}`;
}

module.exports = {
  requireStorage,
  storageName: () => getDriver()?.name || 'none',
  objectKey,
  safeFilename,
  SIGNED_URL_SECONDS,
  // Test hook: reset the cached driver after changing env vars.
  _reset: () => {
    driver = undefined;
  },
};
