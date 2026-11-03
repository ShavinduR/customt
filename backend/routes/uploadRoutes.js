const express = require('express');
const ApiError = require('../utils/ApiError');
const { protect, authorize } = require('../middleware/auth');
const { logoUpload } = require('../middleware/upload');
const { ROLES } = require('../config/constants');
const { config } = require('../config/env');

const router = express.Router();

/**
 * POST /api/uploads/logo  (multipart/form-data, field "logo")
 * Returns { path, url } - put `url` into designSpecs.logoUrl.
 */
router.post('/logo', protect, authorize(ROLES.BUYER, ROLES.ADMIN), (req, res, next) => {
  logoUpload(req, res, (err) => {
    if (err) return next(err);
    if (!req.file) return next(ApiError.badRequest('Attach an image in the "logo" field'));
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
