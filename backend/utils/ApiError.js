/**
 * Operational error with an HTTP status code and an optional machine-readable code
 * (e.g. "PERA_QUALIFICATION_LOCK") that the frontend can switch on.
 */
class ApiError extends Error {
  constructor(statusCode, message, { code, details } = {}) {
    super(message);
    this.name = 'ApiError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    this.isOperational = true;
  }

  static badRequest(message, opts) {
    return new ApiError(400, message, opts);
  }

  static unauthorized(message = 'Authentication required', opts) {
    return new ApiError(401, message, opts);
  }

  static forbidden(message = 'You do not have permission to perform this action', opts) {
    return new ApiError(403, message, opts);
  }

  static notFound(message = 'Resource not found', opts) {
    return new ApiError(404, message, opts);
  }

  static conflict(message, opts) {
    return new ApiError(409, message, opts);
  }

  static locked(message, opts) {
    return new ApiError(423, message, opts);
  }

  static unprocessable(message, opts) {
    return new ApiError(422, message, opts);
  }

  static tooMany(message, opts) {
    return new ApiError(429, message, opts);
  }

  static paymentRequired(message, opts) {
    return new ApiError(402, message, opts);
  }
}

module.exports = ApiError;
