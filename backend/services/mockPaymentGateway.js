/**
 * Mock Payment Gateway - simulates a card processor (PayHere / Stripe style) for escrow funding.
 *
 * Test cards:
 *   4242 4242 4242 4242  -> approved (Visa)
 *   5555 5555 5555 4444  -> approved (Mastercard)
 *   4000 0000 0000 0002  -> declined: card declined
 *   4000 0000 0000 9995  -> declined: insufficient funds
 * Any other Luhn-valid number is approved.
 */
const crypto = require('crypto');
const { config } = require('../config/env');
const ApiError = require('../utils/ApiError');

const DECLINES = {
  '4000000000000002': 'Your card was declined by the issuing bank.',
  '4000000000009995': 'Your card has insufficient funds.',
};

function luhnValid(number) {
  let sum = 0;
  let double = false;
  for (let i = number.length - 1; i >= 0; i -= 1) {
    let digit = Number(number[i]);
    if (double) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    double = !double;
  }
  return sum % 10 === 0;
}

function detectBrand(number) {
  if (/^4/.test(number)) return 'VISA';
  if (/^(5[1-5]|2[2-7])/.test(number)) return 'MASTERCARD';
  if (/^3[47]/.test(number)) return 'AMEX';
  return 'CARD';
}

function validateCard({ cardNumber, cardHolder, expiry, cvv }) {
  const errors = [];
  const number = String(cardNumber || '').replace(/[\s-]/g, '');
  if (!/^\d{13,19}$/.test(number) || !luhnValid(number)) errors.push('Card number is invalid');
  if (!cardHolder || String(cardHolder).trim().length < 2) errors.push('Card holder name is required');

  const match = /^(\d{2})\s*\/\s*(\d{2}|\d{4})$/.exec(String(expiry || ''));
  if (!match) {
    errors.push('Expiry must be in MM/YY format');
  } else {
    const month = Number(match[1]);
    const year = match[2].length === 2 ? 2000 + Number(match[2]) : Number(match[2]);
    const endOfMonth = new Date(year, month, 0, 23, 59, 59);
    if (month < 1 || month > 12) errors.push('Expiry month is invalid');
    else if (endOfMonth.getTime() < Date.now()) errors.push('Card has expired');
  }

  const cvvDigits = String(cvv || '');
  const brand = detectBrand(number);
  if (!(brand === 'AMEX' ? /^\d{4}$/ : /^\d{3}$/).test(cvvDigits)) errors.push('CVV is invalid');

  if (errors.length) throw ApiError.badRequest('Payment details are invalid', { code: 'PAYMENT_VALIDATION', details: errors });
  return { number, brand };
}

const sleep = (ms) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/**
 * Charges the card and returns a gateway receipt. Throws ApiError(402) on decline.
 */
async function charge({ amount, currency = 'LKR', card, reference }) {
  const { number, brand } = validateCard(card || {});
  if (config.mockGatewayLatencyMs > 0) await sleep(config.mockGatewayLatencyMs);

  if (DECLINES[number]) {
    throw ApiError.paymentRequired(DECLINES[number], { code: 'PAYMENT_DECLINED' });
  }

  return {
    success: true,
    transactionRef: `TXN-${Date.now()}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`,
    authCode: crypto.randomBytes(3).toString('hex').toUpperCase(),
    amount,
    currency,
    brand,
    last4: number.slice(-4),
    reference,
    processedAt: new Date(),
  };
}

module.exports = { charge, luhnValid, validateCard };
