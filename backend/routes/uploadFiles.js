const fs = require('fs/promises');
const path = require('path');
const express = require('express');
const { config } = require('../config/env');
const { UPLOAD_PATH } = require('../utils/uploadUrl');
const StoredUpload = require('../models/StoredUpload');

const LOGO_DIR = path.join(config.uploadDir, 'logos');
const MAX_AGE_SECONDS = 7 * 24 * 60 * 60;

/**
 * Public, credential-free image headers.
 * Access-Control-Allow-Origin is ALWAYS "*" (not only when the request carries an Origin): the 2D preview
 * loads an image without CORS and the 3D painter loads the same URL with CORS. If the first response were
 * cached (by the browser or a CDN) without the header, the 3D canvas could not use the image.
 */
function setImageHeaders(res, filename) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  // SVGs are sandboxed so embedded scripts can never run.
  if (filename.endsWith('.svg')) res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; sandbox");
}

/**
 * GET /uploads/... : uploaded design images and post photos.
 * Served from the disk cache when present, otherwise from MongoDB (StoredUpload), restoring the disk copy.
 * Mounted BEFORE the API's CORS middleware so these public files carry their own CORS header.
 */
const router = express.Router();

router.use(
  express.static(config.uploadDir, {
    maxAge: MAX_AGE_SECONDS * 1000,
    setHeaders: (res, filePath) => setImageHeaders(res, filePath),
  })
);

router.get('/logos/:filename', async (req, res, next) => {
  const { filename } = req.params;
  setImageHeaders(res, filename);
  if (!UPLOAD_PATH.test(`/uploads/logos/${filename}`)) return res.status(404).type('text/plain').send('Not found');
  try {
    const file = await StoredUpload.findOne({ filename }).select('+data contentType').lean(false);
    if (!file) return res.status(404).type('text/plain').send('Not found');
    res.setHeader('Cache-Control', `public, max-age=${MAX_AGE_SECONDS}`);
    res.type(file.contentType).send(file.data);
    // Best effort: bring the disk cache back so the next request is served without a database read.
    fs.mkdir(LOGO_DIR, { recursive: true })
      .then(() => fs.writeFile(path.join(LOGO_DIR, filename), file.data, { flag: 'wx' }))
      .catch(() => {});
    return undefined;
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
