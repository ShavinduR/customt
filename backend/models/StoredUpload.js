const mongoose = require('mongoose');

/**
 * A copy of every uploaded design image / post photo, kept in MongoDB.
 *
 * Hosts such as Render's free plan wipe the server's disk on every restart or wake-up, which made earlier
 * uploads disappear (the 2D preview went blank and the 3D view reported "could not be loaded"). Files are
 * still written to disk as a fast cache, and GET /uploads/logos/:filename falls back to this collection.
 * Images are small (MAX_UPLOAD_MB, default 2 MB), well under MongoDB's 16 MB document limit.
 */
const storedUploadSchema = new mongoose.Schema(
  {
    filename: { type: String, required: true, unique: true, maxlength: 80 },
    ownerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    contentType: { type: String, required: true, enum: ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'] },
    size: { type: Number, required: true, min: 1 },
    data: { type: Buffer, required: true, select: false },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

module.exports = mongoose.model('StoredUpload', storedUploadSchema);
