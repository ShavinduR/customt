const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');
const { config } = require('../config/env');
const ApiError = require('../utils/ApiError');

const LOGO_DIR = path.join(config.uploadDir, 'logos');
fs.mkdirSync(LOGO_DIR, { recursive: true });

const ALLOWED = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
  'image/svg+xml': '.svg',
};

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, LOGO_DIR),
  filename: (req, file, cb) => {
    const ext = ALLOWED[file.mimetype];
    cb(null, `${req.user._id}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}${ext}`);
  },
});

const logoUpload = multer({
  storage,
  limits: { fileSize: config.maxUploadMb * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED[file.mimetype]) {
      return cb(ApiError.badRequest('Logo must be a PNG, JPG, WEBP or SVG image'));
    }
    return cb(null, true);
  },
}).single('logo');

module.exports = { logoUpload, LOGO_DIR };
