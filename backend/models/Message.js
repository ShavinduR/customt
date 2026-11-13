const mongoose = require('mongoose');

const { ObjectId } = mongoose.Schema.Types;

/**
 * One chat message between an order's buyer and its winning vendor.
 * `body` is what the participants see (already filtered). `originalBody` keeps the unfiltered text
 * only when something was blocked; it is never sent to buyers or vendors, only to admins.
 */
const messageSchema = new mongoose.Schema(
  {
    orderId: { type: ObjectId, ref: 'Order', required: true },
    senderId: { type: ObjectId, ref: 'User', required: true },
    senderRole: { type: String, enum: ['buyer', 'vendor'], required: true },
    senderName: { type: String, required: true },
    body: { type: String, required: true, maxlength: 1500 },
    originalBody: { type: String, maxlength: 1000, select: false },
    flagged: { type: Boolean, default: false },
    flags: { type: [String], default: [] },
    readAt: { type: Date, default: null }, // when the other participant read it
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

messageSchema.index({ orderId: 1, createdAt: 1 });
messageSchema.index({ flagged: 1, createdAt: -1 });

module.exports = mongoose.model('Message', messageSchema);
