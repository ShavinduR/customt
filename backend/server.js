/**
 * CustomT API server
 * Express REST API + Socket.IO real-time reverse auction engine on a single HTTP server.
 */
const http = require('http');
const path = require('path');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const { Server } = require('socket.io');

const { config, assertRequiredEnv } = require('./config/env');
const { connectDB, disconnectDB } = require('./config/db');
require('./models');
const { notFound, errorHandler } = require('./middleware/errorHandler');
const realtime = require('./services/realtime');
const { registerSocketHandlers } = require('./sockets');
const { startAuctionScheduler, stopAuctionScheduler } = require('./services/auctionService');

const authRoutes = require('./routes/authRoutes');
const rfqRoutes = require('./routes/rfqRoutes');
const orderRoutes = require('./routes/orderRoutes');
const vendorRoutes = require('./routes/vendorRoutes');
const adminRoutes = require('./routes/adminRoutes');
const metaRoutes = require('./routes/metaRoutes');
const uploadRoutes = require('./routes/uploadRoutes');

function corsOrigin(origin, callback) {
  // Allow same-origin / server-to-server requests (no Origin header) and configured frontends.
  if (!origin || config.clientUrls.includes(origin)) return callback(null, true);
  return callback(new Error(`Origin ${origin} is not allowed by CORS`));
}

function createApp() {
  const app = express();
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
  app.use(cors({ origin: corsOrigin, credentials: true }));
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true, limit: '1mb' }));
  if (config.nodeEnv !== 'test') app.use(morgan(config.isProduction ? 'combined' : 'dev'));

  app.use(
    '/api',
    rateLimit({
      windowMs: 60 * 1000,
      limit: 600,
      standardHeaders: 'draft-7',
      legacyHeaders: false,
      message: { success: false, message: 'Too many requests, please slow down.' },
    })
  );

  // Uploaded logos. SVGs are sandboxed so embedded scripts can never run.
  app.use(
    '/uploads',
    express.static(path.join(config.uploadDir), {
      maxAge: '7d',
      setHeaders(res, filePath) {
        res.setHeader('X-Content-Type-Options', 'nosniff');
        if (filePath.endsWith('.svg')) {
          res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; sandbox");
        }
      },
    })
  );

  app.get('/', (_req, res) => res.json({ success: true, service: 'CustomT API', docs: '/api/meta/catalog', health: '/api/health' }));
  app.use('/api/meta', metaRoutes);
  app.get('/api/health', metaRoutes.health);
  app.use('/api/auth', authRoutes);
  app.use('/api/rfqs', rfqRoutes);
  app.use('/api/orders', orderRoutes);
  app.use('/api/vendor', vendorRoutes);
  app.use('/api/admin', adminRoutes);
  app.use('/api/uploads', uploadRoutes);

  app.use(notFound);
  app.use(errorHandler);
  return app;
}

function createRealtimeServer(app) {
  const server = http.createServer(app);
  const io = new Server(server, {
    cors: { origin: config.clientUrls, credentials: true },
    pingInterval: 20000,
    pingTimeout: 20000,
  });
  realtime.setIO(io);
  registerSocketHandlers(io);
  return { server, io };
}

async function start() {
  assertRequiredEnv();
  await connectDB(config.mongoUri);

  const app = createApp();
  const { server, io } = createRealtimeServer(app);

  server.listen(config.port, () => {
    // eslint-disable-next-line no-console
    console.log(`[server] CustomT API + Socket.IO listening on port ${config.port} (${config.nodeEnv})`);
    // eslint-disable-next-line no-console
    console.log(`[server] Allowed client origins: ${config.clientUrls.join(', ')}`);
  });

  startAuctionScheduler();

  let shuttingDown = false;
  const shutdown = async (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    // eslint-disable-next-line no-console
    console.log(`[server] ${signal} received - shutting down gracefully`);
    stopAuctionScheduler();
    io.close();
    server.close(async () => {
      await disconnectDB();
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10000).unref();
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('unhandledRejection', (reason) => {
    // eslint-disable-next-line no-console
    console.error('[server] Unhandled promise rejection:', reason);
  });

  return { app, server, io };
}

if (require.main === module) {
  start().catch((err) => {
    // eslint-disable-next-line no-console
    console.error('[server] Failed to start:', err.isDbConnectionError ? `could not connect to MongoDB\n${err.message}` : err);
    process.exit(1);
  });
}

module.exports = { createApp, createRealtimeServer, start };
