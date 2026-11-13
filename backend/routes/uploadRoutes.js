const fs = require('fs/promises');
const express = require('express');
const ApiError = require('../utils/ApiError');
const { protect, authorize } = require('../middleware/auth');
const { logoUpload } = require('../middleware/upload');
const { ROLES } = require('../config/constants');
const { config } = require('../config/env');

const router = express.Router();

/**
 * The browser-supplied MIME type is only a claim, so the file's first bytes are checked too.
 * A file that isn't really the image type it claims to be is deleted and rejected.
 */
async function hasImageSignature(filePath, mimeType) {
  const handle = await fs.open(filePath, 'r');
  try {
    const { buffer, bytesRead } = await handle.read(Buffer.alloc(512), 0, 512, 0);
    const head = buffer.subarray(0, bytesRead);
    switch (mimeType) {
      case 'image/png':
        return head.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
      case 'image/jpeg':
        return head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff;
      case 'image/webp':
        return head.subarray(0, 4).toString('latin1') === 'RIFF' && head.subarray(8, 12).toString('latin1') === 'WEBP';
      case 'image/svg+xml':
        return /^(?:\uFEFF)?\s*(?:<\?xml[^>]*>\s*)?(?:<!--[\s\S]*?-->\s*)*(?:<!DOCTYPE svg[^>]*>\s*)?<svg[\s>]/i.test(head.toString('utf8'));
      default:
        return false;
    }
  } finally {
    await handle.close();
  }
}

/**
 * POST /api/uploads/logo  (multipart/form-data, field "logo")
 * Returns { path, url } - put `url` into designSpecs.logoUrl.
 */
router.post('/logo', protect, authorize(ROLES.BUYER, ROLES.ADMIN), (req, res, next) => {
  logoUpload(req, res, async (err) => {
    if (err) return next(err);
    if (!req.file) return next(ApiError.badRequest('Attach an image in the "logo" field'));
    try {
      if (!(await hasImageSignature(req.file.path, req.file.mimetype))) {
        await fs.unlink(req.file.path).catch(() => {});
        return next(ApiError.badRequest('The file content is not a valid PNG, JPG, WEBP or SVG image'));
      }
    } catch (checkErr) {
      return next(checkErr);
    }
    const path = `/uploads/logos/${req.file.filename}`;
    const base = config.publicApiUrl || `${req.protocol}://${req.get('host')}`;
    return res.status(201).json({
      success: true,
      path,
      url: `${base}${path}`,
      size: req.file.size,
      mimeType: req.file.mimetype,
    });
  });
});

module.exports = router;
