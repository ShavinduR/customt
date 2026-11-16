/**
 * Append-only record of every time an administrator opens a KYB document.
 * Answers "who looked at this NIC copy, and when?" (accountability under data-protection law).
 */
const mongoose = require('mongoose');

const { ObjectId } = mongoose.Schema.Types;

const kybAccessLogSchema = new mongoose.Schema(
  {
    adminId: { type: ObjectId, ref: 'User', required: true, index: true },
    applicationId: { type: ObjectId, ref: 'VendorApplication', required: true, index: true },
    documentId: { type: ObjectId, required: true },
    documentType: { type: String },
    action: { type: String, enum: ['VIEW', 'LINK'], required: true },
    ip: { type: String },
    userAgent: { type: String, maxlength: 200 },
    at: { type: Date, default: Date.now },
  },
  { versionKey: false }
);

// Logs are never edited or deleted through the application.
kybAccessLogSchema.pre(['updateOne', 'updateMany', 'findOneAndUpdate', 'deleteOne', 'deleteMany', 'findOneAndDelete'], function blockChanges(next) {
  next(new Error('KYB access logs are append-only'));
});

module.exports = mongoose.model('KybAccessLog', kybAccessLogSchema);
