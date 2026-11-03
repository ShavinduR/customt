/**
 * E-commerce Politeness CRM templates.
 *
 * Grounded in politeness theory (Brown & Levinson): disputes are face-threatening acts,
 * so every system message (1) acknowledges feelings, (2) avoids blame, (3) states facts
 * neutrally, (4) offers concrete next steps, and (5) preserves the relationship.
 * Buyer free-text is never forwarded raw to the vendor: it is wrapped in a neutral frame
 * and screened for hostile phrasing that would escalate the conflict.
 */
const { DISPUTE_CATEGORIES } = require('../config/constants');

const HOSTILE_WORDS = [
  'scam', 'scams', 'scammer', 'scammers', 'fraud', 'frauds', 'fraudster',
  'cheat', 'cheater', 'cheaters', 'cheated', 'cheating', 'liar', 'liars',
  'idiot', 'idiots', 'stupid', 'useless', 'garbage', 'trash', 'worst',
  'pathetic', 'incompetent', 'damn', 'hell', 'rubbish', 'disgusting',
];
const HOSTILE_REGEX = new RegExp(`\\b(${HOSTILE_WORDS.join('|')})\\b`, 'gi');

function isShouting(text) {
  const letters = text.replace(/[^a-z]/gi, '');
  if (letters.length <= 15) return false;
  return letters.replace(/[^A-Z]/g, '').length / letters.length > 0.6;
}

function analyseTone(text = '') {
  const matches = text.match(HOSTILE_REGEX) || [];
  const flaggedTerms = [...new Set(matches.map((m) => m.toLowerCase()))];
  const exclamations = (text.match(/!/g) || []).length;
  const shouting = isShouting(text);
  const isHostile = flaggedTerms.length > 0 || shouting || exclamations >= 4;
  return { isHostile, flaggedTerms, shouting, exclamations };
}

/** Softens hostile wording so the vendor-facing message stays constructive. */
function softenText(text = '') {
  let softened = text.replace(HOSTILE_REGEX, '[unsatisfactory]').replace(/!{2,}/g, '.');
  if (isShouting(softened)) {
    softened = softened.charAt(0).toUpperCase() + softened.slice(1).toLowerCase();
  }
  return softened.trim();
}

function categoryLabel(category) {
  return DISPUTE_CATEGORIES[category] || DISPUTE_CATEGORIES.OTHER;
}

function buyerAcknowledgement({ buyerName, orderCode, category }) {
  return [
    `Dear ${buyerName},`,
    '',
    `Thank you for taking the time to inspect order ${orderCode} so carefully, and we are genuinely sorry that the result did not meet your expectations.`,
    `We have recorded your concern ("${categoryLabel(category)}") and, to protect you, the remaining escrow balance has been frozen. No further funds will be released to the vendor until this is resolved.`,
    '',
    'What happens next:',
    '  1. The vendor has been notified and invited to respond respectfully within 48 hours.',
    '  2. A CustomT mediator will review the locked design specification, the evidence and both perspectives.',
    '  3. You will receive a fair, transparent resolution (reprint, partial refund, full refund or release).',
    '',
    'We appreciate your patience and your trust in CustomT.',
    'Warm regards,',
    'The CustomT Resolution Team',
  ].join('\n');
}

function vendorNotification({ vendorName, orderCode, category, description, desiredResolution }) {
  return [
    `Dear ${vendorName},`,
    '',
    `We hope you are well. During the offline (O2O) inspection of order ${orderCode}, the buyer has kindly shared a concern that we would like to resolve together with you.`,
    '',
    `Area of concern: ${categoryLabel(category)}`,
    `Buyer's observation (summarised): "${softenText(description)}"`,
    `Buyer's preferred outcome: ${desiredResolution.replace(/_/g, ' ').toLowerCase()}`,
    '',
    'As a precaution, the remaining escrow balance is temporarily on hold. Your 30% advance is not affected.',
    'We value your craftsmanship and partnership, and we are confident this can be settled amicably. Please share your perspective, any production photos, or a proposed remedy from your dashboard.',
    '',
    'Thank you for your cooperation.',
    'Kind regards,',
    'The CustomT Resolution Team',
  ].join('\n');
}

function adminCaseSummary({ orderCode, rfqCode, buyerName, vendorName, category, description, desiredResolution, escrowHeld, tone }) {
  return [
    `DISPUTE CASE - Order ${orderCode} (RFQ ${rfqCode})`,
    `Buyer: ${buyerName} | Vendor: ${vendorName}`,
    `Category: ${categoryLabel(category)}`,
    `Desired resolution: ${desiredResolution}`,
    `Escrow frozen: LKR ${Number(escrowHeld).toFixed(2)}`,
    `Tone screening: ${tone.isHostile ? `ATTENTION - heightened emotion detected (${tone.flaggedTerms.join(', ') || 'shouting/exclamations'}). Use de-escalation language.` : 'Neutral'}`,
    '',
    'Buyer statement (verbatim):',
    description,
  ].join('\n');
}

function resolutionMessage({ recipientName, orderCode, resolution, buyerAmount, vendorAmount, adminNotes }) {
  const outcomes = {
    RELEASE_TO_VENDOR: `After a careful review, the held balance of LKR ${Number(vendorAmount).toFixed(2)} has been released to the vendor.`,
    REFUND_BUYER: `After a careful review, the held balance of LKR ${Number(buyerAmount).toFixed(2)} has been refunded to the buyer's CustomT wallet.`,
    SPLIT: `After a careful review, the held balance has been shared fairly: LKR ${Number(vendorAmount).toFixed(2)} to the vendor and LKR ${Number(buyerAmount).toFixed(2)} refunded to the buyer.`,
    RESUME_PRODUCTION: 'Both parties have agreed on a remedy, so production has resumed and the escrow balance remains safely held until a fresh O2O inspection.',
  };
  return [
    `Dear ${recipientName},`,
    '',
    `Thank you sincerely for your patience while we mediated order ${orderCode}.`,
    outcomes[resolution],
    adminNotes ? `Mediator's note: ${adminNotes}` : null,
    '',
    'We truly value having you in the CustomT community and hope to serve you again soon.',
    'Warm regards,',
    'The CustomT Resolution Team',
  ]
    .filter((line) => line !== null)
    .join('\n');
}

function followUpNote({ authorName, authorRole, message }) {
  const roleLabel = { buyer: 'Buyer', vendor: 'Vendor', admin: 'Mediator' }[authorRole] || 'Participant';
  return `${roleLabel} ${authorName} shared an update: "${authorRole === 'admin' ? message : softenText(message)}"`;
}

module.exports = {
  analyseTone,
  softenText,
  buyerAcknowledgement,
  vendorNotification,
  adminCaseSummary,
  resolutionMessage,
  followUpNote,
  categoryLabel,
};
