/**
 * Password reset with time-limited, single-use JWTs.
 *
 * The token is signed with JWT_SECRET + the user's current password hash. Once the password changes,
 * the hash changes, so every earlier reset link stops verifying: links are single-use without storing
 * anything in the database. A `purpose` claim stops a reset token being used as a login token and
 * vice versa (they are also signed with different keys).
 */
const jwt = require('jsonwebtoken');
const { User } = require('../models');
const ApiError = require('../utils/ApiError');
const { config } = require('../config/env');
const { sendMail } = require('./mailer');

const PURPOSE = 'password-reset';

const signingKey = (user) => `${config.jwtSecret}:${user.passwordHash}`;

function createResetToken(user) {
  return jwt.sign({ sub: String(user._id), purpose: PURPOSE }, signingKey(user), {
    expiresIn: `${config.passwordResetMinutes}m`,
  });
}

function resetLink(token) {
  return `${config.appUrl}/reset-password?token=${encodeURIComponent(token)}`;
}

const escapeHtml = (text) =>
  String(text).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function resetEmail(user, link) {
  const minutes = config.passwordResetMinutes;
  const text = [
    `Hello ${user.name},`,
    '',
    'We received a request to reset the password for your CustomT account.',
    `Open this link within ${minutes} minutes to choose a new password:`,
    '',
    link,
    '',
    'The link works once. If you did not ask for a reset, you can ignore this e-mail: your password stays the same.',
    '',
    'The CustomT team',
  ].join('\n');

  const html = `<!DOCTYPE html>
<html><body style="margin:0;background:#f4f4f7;font-family:Arial,Helvetica,sans-serif;color:#17171c">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:24px 12px">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:12px;border:1px solid #e3e3ea">
        <tr><td style="padding:24px 28px 8px;font-size:22px;font-weight:bold">Custom<span style="color:#4f46e5">T</span></td></tr>
        <tr><td style="padding:8px 28px 0;font-size:16px;line-height:1.55">
          <p style="margin:0 0 12px">Hello ${escapeHtml(user.name)},</p>
          <p style="margin:0 0 20px">We received a request to reset the password for your CustomT account. Click the button within <strong>${minutes} minutes</strong> to choose a new one.</p>
        </td></tr>
        <tr><td style="padding:0 28px 20px">
          <a href="${escapeHtml(link)}" style="display:inline-block;background:#4f46e5;color:#ffffff;text-decoration:none;font-weight:bold;padding:12px 22px;border-radius:8px">Reset my password</a>
        </td></tr>
        <tr><td style="padding:0 28px 24px;font-size:13px;line-height:1.5;color:#5b5b6b">
          <p style="margin:0 0 8px">The link works once. If the button doesn't work, copy this address into your browser:</p>
          <p style="margin:0 0 16px;word-break:break-all"><a href="${escapeHtml(link)}" style="color:#4f46e5">${escapeHtml(link)}</a></p>
          <p style="margin:0">Didn't ask for a reset? Ignore this e-mail and your password stays the same.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;

  return { subject: 'Reset your CustomT password', text, html };
}

/**
 * Starts a reset. Never reveals whether the e-mail exists: the caller always answers the same way,
 * and the e-mail is sent in the background so response time doesn't give it away either.
 */
async function requestPasswordReset(email) {
  const user = await User.findOne({ email: String(email).toLowerCase().trim() }).select('+passwordHash');
  if (!user || !user.isActive) return;

  const link = resetLink(createResetToken(user));
  const { subject, text, html } = resetEmail(user, link);
  sendMail({ to: user.email, subject, text, html }).catch((err) => {
    // eslint-disable-next-line no-console
    console.error(`[mail] Password reset e-mail to ${user.email} failed: ${err.message}`);
  });
}

/** Verifies a reset token and returns the user (with passwordHash selected). */
async function userFromResetToken(token) {
  const invalid = () =>
    ApiError.badRequest('This reset link is invalid or has already been used. Please request a new one.', { code: 'RESET_TOKEN_INVALID' });

  const decoded = typeof token === 'string' ? jwt.decode(token) : null;
  if (!decoded || decoded.purpose !== PURPOSE || !decoded.sub) throw invalid();

  const user = await User.findById(decoded.sub).select('+passwordHash');
  if (!user || !user.isActive) throw invalid();

  try {
    jwt.verify(token, signingKey(user));
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      throw ApiError.badRequest('This reset link has expired. Please request a new one.', { code: 'RESET_TOKEN_EXPIRED' });
    }
    throw invalid();
  }
  return user;
}

module.exports = { requestPasswordReset, userFromResetToken, createResetToken, resetLink };
