/**
 * Socket.IO real-time auction gateway.
 *
 * Client -> Server
 *   rfq:join    { rfqId }                          ack({ ok, snapshot } | { ok:false, error })
 *   rfq:leave   { rfqId }                          ack({ ok })
 *   bid:place   { rfqId, price, leadTimeDays, notes } ack({ ok, result } | { ok:false, error })
 *   auction:sync { rfqId }                         ack({ ok, snapshot })
 *
 * Server -> Client (see README for payloads)
 *   rfq:new, auction:activity, auction:leaderboard (buyer/admin only), auction:rank (vendor only),
 *   auction:extended, auction:ended, auction:closed, auction:awarded, auction:lost,
 *   order:created, order:updated, order:completed, o2o:ready (buyer only), o2o:failed-attempt,
 *   dispute:raised, dispute:new, dispute:note, dispute:resolved,
 *   vendor:registered, vendor:verification, vendor:badges, vendor:trust-updated
 */
const { resolveUserFromToken, extractBearer } = require('../middleware/auth');
const { toErrorResponse } = require('../middleware/errorHandler');
const { User } = require('../models');
const { ROLES } = require('../config/constants');
const auctionService = require('../services/auctionService');
const chatService = require('../services/chatService');
const realtime = require('../services/realtime');

const EVENT_WINDOW_MS = 10 * 1000;
const EVENT_LIMIT = 40;

function safeAck(ack) {
  return typeof ack === 'function' ? ack : () => {};
}

function errorPayload(err) {
  const { status, message, code, details } = toErrorResponse(err);
  return { ok: false, error: { status, message, code, details } };
}

function registerSocketHandlers(io) {
  // JWT handshake: socket = io(URL, { auth: { token } })
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token || extractBearer(socket.handshake.headers?.authorization);
      const { user, issuedAt } = await resolveUserFromToken(token);
      socket.data.userId = String(user._id);
      socket.data.role = user.role;
      socket.data.issuedAt = issuedAt;
      next();
    } catch (err) {
      const e = new Error(err.message || 'Unauthorized');
      e.data = { code: err.code || 'UNAUTHORIZED' };
      next(e);
    }
  });

  io.on('connection', (socket) => {
    const { userId, role } = socket.data;
    socket.join(realtime.rooms.user(userId));
    socket.join(realtime.rooms.role(role));
    socket.emit('connected', { userId, role, at: new Date() });

    // Always load a fresh user so verification/suspension/password changes take effect immediately.
    const currentUser = async () => {
      const user = await User.findById(userId);
      if (!user || !user.isActive || user.tokenIssuedBeforePasswordChange(socket.data.issuedAt)) {
        socket.disconnect(true);
        throw new Error('Session no longer valid - please log in again');
      }
      return user;
    };

    // Per-connection flood protection: at most EVENT_LIMIT client events per EVENT_WINDOW_MS.
    let windowStart = Date.now();
    let eventsInWindow = 0;
    socket.use((packet, next) => {
      const now = Date.now();
      if (now - windowStart > EVENT_WINDOW_MS) {
        windowStart = now;
        eventsInWindow = 0;
      }
      eventsInWindow += 1;
      if (eventsInWindow <= EVENT_LIMIT) return next();
      // Drop the event but still answer it, so the client's promise settles.
      const ack = packet[packet.length - 1];
      safeAck(ack)({ ok: false, error: { status: 429, message: 'Too many requests - please slow down.', code: 'SOCKET_RATE_LIMIT' } });
      return undefined;
    });

    socket.on('rfq:join', async (payload, ack) => {
      const reply = safeAck(ack);
      try {
        const user = await currentUser();
        const snapshot = await auctionService.getAuctionSnapshot(payload?.rfqId, user);
        socket.join(realtime.rooms.rfq(String(payload.rfqId)));
        reply({ ok: true, snapshot });
      } catch (err) {
        reply(errorPayload(err));
      }
    });

    socket.on('rfq:leave', (payload, ack) => {
      if (payload?.rfqId) socket.leave(realtime.rooms.rfq(String(payload.rfqId)));
      safeAck(ack)({ ok: true });
    });

    socket.on('auction:sync', async (payload, ack) => {
      const reply = safeAck(ack);
      try {
        const user = await currentUser();
        reply({ ok: true, snapshot: await auctionService.getAuctionSnapshot(payload?.rfqId, user) });
      } catch (err) {
        reply(errorPayload(err));
      }
    });

    socket.on('chat:send', async (payload, ack) => {
      const reply = safeAck(ack);
      try {
        const user = await currentUser();
        reply({ ok: true, result: await chatService.sendMessage(user, payload?.orderId, payload?.body) });
      } catch (err) {
        reply(errorPayload(err));
      }
    });

    socket.on('chat:read', async (payload, ack) => {
      const reply = safeAck(ack);
      try {
        const user = await currentUser();
        reply({ ok: true, result: await chatService.markRead(user, payload?.orderId) });
      } catch (err) {
        reply(errorPayload(err));
      }
    });

    socket.on('bid:place', async (payload, ack) => {
      const reply = safeAck(ack);
      try {
        if (role !== ROLES.VENDOR) {
          reply({ ok: false, error: { status: 403, message: 'Only vendors can place bids' } });
          return;
        }
        await currentUser();
        const result = await auctionService.placeBid(userId, payload?.rfqId, payload || {});
        socket.join(realtime.rooms.rfq(String(payload.rfqId)));
        reply({ ok: true, result });
      } catch (err) {
        reply(errorPayload(err));
      }
    });
  });
}

module.exports = { registerSocketHandlers };
