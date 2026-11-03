/**
 * Thin wrapper around the Socket.IO server so services can broadcast without
 * importing socket handlers (avoids circular dependencies).
 *
 * Room conventions
 *   user_<userId>   - private channel for one user (all their tabs/devices)
 *   role_<role>     - every connected buyer / vendor / admin
 *   rfq_<rfqId>     - auction room; receives ONLY non-sensitive activity
 *                     (bid count, timer). Leaderboards are never emitted here.
 */
let io = null;

const rooms = {
  user: (userId) => `user_${userId}`,
  role: (role) => `role_${role}`,
  rfq: (rfqId) => `rfq_${rfqId}`,
};

function setIO(instance) {
  io = instance;
}

function getIO() {
  return io;
}

function emitToUser(userId, event, payload) {
  if (io && userId) io.to(rooms.user(String(userId))).emit(event, payload);
}

function emitToUsers(userIds, event, payload) {
  if (!io || !userIds || userIds.length === 0) return;
  io.to(userIds.map((id) => rooms.user(String(id)))).emit(event, payload);
}

function emitToRole(role, event, payload) {
  if (io) io.to(rooms.role(role)).emit(event, payload);
}

function emitToRfqRoom(rfqId, event, payload) {
  if (io) io.to(rooms.rfq(String(rfqId))).emit(event, payload);
}

module.exports = { setIO, getIO, rooms, emitToUser, emitToUsers, emitToRole, emitToRfqRoom };
