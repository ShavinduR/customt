const path = require('path');

require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

const REQUIRED = ['MONGO_URI', 'JWT_SECRET'];

function assertRequiredEnv() {
  const missing = REQUIRED.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    // eslint-disable-next-line no-console
    console.error(
      `[config] Missing required environment variable(s): ${missing.join(', ')}. ` +
        'Copy .env.example to .env and fill them in.'
    );
    process.exit(1);
  }
  if (process.env.NODE_ENV === 'production' && process.env.JWT_SECRET.length < 32) {
    // eslint-disable-next-line no-console
    console.error('[config] JWT_SECRET must be at least 32 characters in production.');
    process.exit(1);
  }
}

const toInt = (value, fallback) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const config = {
  nodeEnv: process.env.NODE_ENV || 'development',
  isProduction: process.env.NODE_ENV === 'production',
  port: toInt(process.env.PORT, 5000),
  mongoUri: process.env.MONGO_URI,
  jwtSecret: process.env.JWT_SECRET,
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',
  clientUrls: (process.env.CLIENT_URL || 'http://localhost:5173')
    .split(',')
    .map((url) => url.trim())
    .filter(Boolean),
  publicApiUrl: (process.env.PUBLIC_API_URL || '').replace(/\/+$/, ''),
  auctionDurationMinutes: toInt(process.env.AUCTION_DURATION_MINUTES, 24 * 60),
  auctionSchedulerIntervalMs: toInt(process.env.AUCTION_SCHEDULER_INTERVAL_MS, 10000),
  allowBidPriceIncrease: String(process.env.ALLOW_BID_PRICE_INCREASE).toLowerCase() === 'true',
  mockGatewayLatencyMs: toInt(process.env.MOCK_GATEWAY_LATENCY_MS, 800),
  maxUploadMb: toInt(process.env.MAX_UPLOAD_MB, 2),
  uploadDir: path.resolve(__dirname, '..', 'uploads'),
};

module.exports = { config, assertRequiredEnv };
