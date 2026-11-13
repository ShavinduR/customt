/**
 * Buyer-vendor chat for an order, with server-side contact filtering and admin monitoring.
 */
const { Order, Message } = require('../models');
const ApiError = require('../utils/ApiError');
const { ROLES, ORDER_STATUS } = require('../config/constants');
const { assertObjectId, idEquals, escapeRegex } = require('../utils/helpers');
const { filterContactInfo } = require('../utils/contactFilter');
const realtime = require('./realtime');

const MAX_LENGTH = 1000;
const HISTORY_LIMIT = 200;
const RATE_WINDOW_MS = 10 * 1000;
const RATE_MAX = 8;
const recentSends = new Map(); // userId -> timestamps (in-memory, like the auction locks)

function rateLimit(userId) {
  const now = Date.now();
  const list = (recentSends.get(userId) || []).filter((t) => now - t < RATE_WINDOW_MS);
  if (list.length >= RATE_MAX) throw ApiError.tooMany('You are sending messages too quickly. Please wait a few seconds.', { code: 'CHAT_RATE_LIMIT' });
  list.push(now);
  recentSends.set(userId, list);
}

/** Loads the order and checks the viewer may read (parties + admin) or write (parties only) its chat. */
async function loadChatOrder(orderId, user, { write = false } = {}) {
  assertObjectId(orderId, 'order id');
  const order = await Order.findById(orderId).select('orderCode buyerId vendorId orderStatus specSnapshot');
  if (!order) throw ApiError.notFound('Order not found');
  const isBuyer = user.role === ROLES.BUYER && idEquals(order.buyerId, user._id);
  const isVendor = user.role === ROLES.VENDOR && idEquals(order.vendorId, user._id);
  const isAdmin = user.role === ROLES.ADMIN;
  if (!isBuyer && !isVendor && !(isAdmin && !write)) {
    throw ApiError.forbidden(isAdmin ? 'Admins can monitor this chat but not post in it' : 'Only the buyer and the winning vendor can use this chat');
  }
  if (write && order.orderStatus === ORDER_STATUS.CANCELLED) {
    throw ApiError.conflict('This order was cancelled, so its chat is closed');
  }
  return { order, isBuyer, isVendor, isAdmin };
}

/** Shape a message for a viewer. Only admins ever receive the unfiltered original. */
function messageView(message, { admin = false } = {}) {
  const view = {
    _id: String(message._id),
    orderId: String(message.orderId),
    senderId: String(message.senderId),
    senderRole: message.senderRole,
    senderName: message.senderName,
    body: message.body,
    flagged: message.flagged,
    readAt: message.readAt,
    createdAt: message.createdAt,
  };
  if (admin) {
    view.flags = message.flags;
    view.originalBody = message.originalBody || null;
  }
  return view;
}

async function listMessages(orderId, user) {
  const { order, isAdmin } = await loadChatOrder(orderId, user);
  let query = Message.find({ orderId: order._id }).sort({ createdAt: -1 }).limit(HISTORY_LIMIT);
  if (isAdmin) query = query.select('+originalBody');
  const messages = (await query).reverse();
  const unread = isAdmin ? 0 : messages.filter((m) => !idEquals(m.senderId, user._id) && !m.readAt).length;
  return {
    order: { _id: String(order._id), orderCode: order.orderCode, orderStatus: order.orderStatus, title: order.specSnapshot?.title },
    canSend: !isAdmin && order.orderStatus !== ORDER_STATUS.CANCELLED,
    unread,
    messages: messages.map((m) => messageView(m, { admin: isAdmin })),
  };
}

async function sendMessage(user, orderId, rawBody) {
  const text = typeof rawBody === 'string' ? rawBody.trim() : '';
  if (!text) throw ApiError.badRequest('Write a message first');
  if (text.length > MAX_LENGTH) throw ApiError.badRequest(`Messages can be at most ${MAX_LENGTH} characters`);

  const { order, isBuyer } = await loadChatOrder(orderId, user, { write: true });
  rateLimit(String(user._id));

  const { text: body, flagged, flags } = filterContactInfo(text);
  const message = await Message.create({
    orderId: order._id,
    senderId: user._id,
    senderRole: isBuyer ? ROLES.BUYER : ROLES.VENDOR,
    senderName: isBuyer ? user.name : user.companyName || user.name,
    body,
    originalBody: flagged ? text : undefined,
    flagged,
    flags,
  });

  const partyView = messageView(message);
  const payload = { orderId: String(order._id), orderCode: order.orderCode, message: partyView };
  realtime.emitToUsers([order.buyerId, order.vendorId], 'chat:message', payload);
  realtime.emitToRole(ROLES.ADMIN, 'chat:monitor', {
    orderId: String(order._id),
    orderCode: order.orderCode,
    message: messageView(message, { admin: true }),
  });
  if (flagged) {
    realtime.emitToRole(ROLES.ADMIN, 'chat:flagged', { orderId: String(order._id), orderCode: order.orderCode, flags, senderName: message.senderName });
  }
  return { message: partyView, blocked: flagged ? flags : [] };
}

/** Marks the other participant's messages as read and tells them ("Seen"). */
async function markRead(user, orderId) {
  const { order, isAdmin } = await loadChatOrder(orderId, user);
  if (isAdmin) return { updated: 0 };
  const now = new Date();
  const result = await Message.updateMany({ orderId: order._id, senderId: { $ne: user._id }, readAt: null }, { $set: { readAt: now } });
  if (result.modifiedCount > 0) {
    const other = idEquals(order.buyerId, user._id) ? order.vendorId : order.buyerId;
    realtime.emitToUser(other, 'chat:read', { orderId: String(order._id), readAt: now });
  }
  return { updated: result.modifiedCount };
}

/** Admin overview: one row per conversation, newest activity first. */
async function listConversations({ flaggedOnly = false, search = '' } = {}) {
  const rows = await Message.aggregate([
    { $sort: { createdAt: -1 } },
    {
      $group: {
        _id: '$orderId',
        messages: { $sum: 1 },
        flaggedMessages: { $sum: { $cond: ['$flagged', 1, 0] } },
        lastMessageAt: { $first: '$createdAt' },
        lastBody: { $first: '$body' },
        lastSender: { $first: '$senderName' },
      },
    },
    ...(flaggedOnly ? [{ $match: { flaggedMessages: { $gt: 0 } } }] : []),
    { $sort: { lastMessageAt: -1 } },
    { $limit: 200 },
    { $lookup: { from: 'orders', localField: '_id', foreignField: '_id', as: 'order' } },
    { $unwind: '$order' },
    { $lookup: { from: 'users', localField: 'order.buyerId', foreignField: '_id', as: 'buyer' } },
    { $lookup: { from: 'users', localField: 'order.vendorId', foreignField: '_id', as: 'vendor' } },
  ]);

  const needle = String(search).trim().slice(0, 50);
  const rx = needle ? new RegExp(escapeRegex(needle), 'i') : null;
  return rows
    .map((r) => ({
      orderId: String(r._id),
      orderCode: r.order.orderCode,
      title: r.order.specSnapshot?.title || '',
      orderStatus: r.order.orderStatus,
      buyerName: r.buyer[0]?.name || '',
      vendorName: r.vendor[0]?.companyName || r.vendor[0]?.name || '',
      messages: r.messages,
      flaggedMessages: r.flaggedMessages,
      lastMessageAt: r.lastMessageAt,
      lastBody: r.lastBody,
      lastSender: r.lastSender,
    }))
    .filter((r) => !rx || rx.test(r.orderCode) || rx.test(r.title) || rx.test(r.buyerName) || rx.test(r.vendorName));
}

module.exports = { listMessages, sendMessage, markRead, listConversations, messageView };
