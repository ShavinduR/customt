const mongoose = require('mongoose');
const multer = require('multer');
const { config } = require('../config/env');

function notFound(req, res) {
  res.status(404).json({ success: false, message: `Route not found: ${req.method} ${req.originalUrl}` });
}

/** Maps any thrown error to a consistent JSON envelope. */
function toErrorResponse(err) {
  if (err.isOperational) {
    return { status: err.statusCode, message: err.message, code: err.code, details: err.details };
  }
  if (err instanceof mongoose.Error.ValidationError) {
    const details = Object.values(err.errors).map((e) => e.message);
    return { status: 400, message: 'Validation failed', code: 'VALIDATION_ERROR', details };
  }
  if (err instanceof mongoose.Error.CastError) {
    return { status: 400, message: `Invalid value for ${err.path}`, code: 'INVALID_ID' };
  }
  if (err && err.code === 11000) {
    const field = Object.keys(err.keyValue || err.keyPattern || {})[0] || 'field';
    return { status: 409, message: `A record with this ${field} already exists`, code: 'DUPLICATE' };
  }
  if (err instanceof multer.MulterError) {
    const message = err.code === 'LIMIT_FILE_SIZE' ? `File is too large (max ${config.maxUploadMb} MB)` : err.message;
    return { status: 400, message, code: err.code };
  }
  if (err.type === 'entity.parse.failed') {
    return { status: 400, message: 'Malformed JSON body', code: 'BAD_JSON' };
  }
  if (err.type === 'entity.too.large') {
    return { status: 413, message: 'Request body too large', code: 'PAYLOAD_TOO_LARGE' };
  }
  return { status: 500, message: 'Something went wrong on our side. Please try again.', code: 'INTERNAL_ERROR' };
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, _next) {
  const { status, message, code, details } = toErrorResponse(err);
  if (status >= 500) {
    // eslint-disable-next-line no-console
    console.error(`[error] ${req.method} ${req.originalUrl}`, err);
  }
  const body = { success: false, message };
  if (code) body.code = code;
  if (details) body.details = details;
  if (!config.isProduction && status >= 500) body.stack = err.stack;
  res.status(status).json(body);
}

module.exports = { notFound, errorHandler, toErrorResponse };
