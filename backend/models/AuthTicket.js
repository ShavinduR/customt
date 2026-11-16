/**
 * Short-lived, single-use tickets for the Facebook Login flow. Only a SHA-256 hash of each ticket is
 * stored, so a database read never yields a usable ticket. Expired tickets are removed by a TTL index.
 *
 *   oauth_state : binds the Facebook redirect to the browser that started it (CSRF protection)
 *   login_code  : handed to the web app after Facebook, exchanged once for a normal session token
 *   fb_signup   : a verified Facebook identity waiting for the user to add a phone number
 *   fb_link     : lets a signed-in user start linking Facebook (the redirect can't carry the bearer token)
 */
const mongoose = require('mongoose');

const authTicketSchema = new mongoose.Schema(
  {
    tokenHash: { type: String, required: true, unique: true },
    type: { type: String, enum: ['oauth_state', 'login_code', 'fb_signup', 'fb_link'], required: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    data: { type: mongoose.Schema.Types.Mixed, default: {} },
    expiresAt: { type: Date, required: true },
    usedAt: { type: Date, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

authTicketSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('AuthTicket', authTicketSchema);
