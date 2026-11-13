/**
 * Outgoing e-mail through Nodemailer.
 *
 * - SMTP_HOST set: messages go out over SMTP (any provider: Brevo, SendGrid, Mailgun, Gmail…).
 * - SMTP_HOST missing: nothing is sent. Outside production the message is printed to the console,
 *   so password resets can be tested locally; in production only a warning is logged, because a
 *   reset link in server logs would let anyone with log access take over the account.
 */
const nodemailer = require('nodemailer');
const { config } = require('../config/env');

let transporter = null;
let lastTestMessage = null;

function smtpConfigured() {
  return Boolean(config.smtp.host);
}

function getTransporter() {
  if (transporter) return transporter;
  if (smtpConfigured()) {
    transporter = nodemailer.createTransport({
      host: config.smtp.host,
      port: config.smtp.port,
      secure: config.smtp.secure,
      auth: config.smtp.user ? { user: config.smtp.user, pass: config.smtp.pass } : undefined,
      connectionTimeout: 15000,
      greetingTimeout: 10000,
      socketTimeout: 20000,
    });
  } else {
    transporter = nodemailer.createTransport({ jsonTransport: true });
  }
  return transporter;
}

/** Sends one message. Resolves with Nodemailer's info; rejects on SMTP failure. */
async function sendMail({ to, subject, text, html }) {
  const message = { from: config.mailFrom, to, subject, text, html };
  const info = await getTransporter().sendMail(message);

  if (!smtpConfigured()) {
    if (config.nodeEnv === 'test') {
      lastTestMessage = message;
    } else if (config.isProduction) {
      // eslint-disable-next-line no-console
      console.warn(`[mail] SMTP is not configured: "${subject}" to ${to} was NOT sent. Set SMTP_HOST, SMTP_PORT, SMTP_USER and SMTP_PASS.`);
    } else {
      // eslint-disable-next-line no-console
      console.log(`[mail] SMTP not configured, printing instead of sending.\nTo: ${to}\nSubject: ${subject}\n\n${text}\n`);
    }
  }
  return info;
}

/** Test helper: the last message "sent" while SMTP is not configured and NODE_ENV=test. */
function getLastTestMessage() {
  return lastTestMessage;
}

module.exports = { sendMail, smtpConfigured, getLastTestMessage };
