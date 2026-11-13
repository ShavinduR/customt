/**
 * Off-platform contact filter for buyer-vendor chat.
 *
 * Escrow only protects deals that stay on CustomT, so messages are scrubbed BEFORE they are stored or
 * broadcast: phone numbers, e-mail addresses, links, messaging-app names, "call me"-style requests and
 * attempts to pay outside escrow become "[CONTACT BLOCKED]". Common evasions are covered: digits split
 * by spaces/dots/dashes, numbers spelled out in words, "name at gmail dot com", and app names written
 * letter by letter ("w.h.a.t.s.a.p.p").
 *
 * The filter is deliberately conservative about ordinary order talk: prices ("LKR 1,500,000"), size
 * breakdowns ("S 20 M 40 L 40"), quantities, dates and order codes pass through untouched.
 */

const BLOCK = '[CONTACT BLOCKED]';

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Matches a word even when its letters are separated by spaces, dots, dashes, underscores or stars. */
const spaced = (word) =>
  word
    .split('')
    .map((ch) => (ch === ' ' ? '[\\W_]*' : escapeRegex(ch)))
    .join('[\\s._*\\-|/\\\\]*');

const APP_NAMES = [
  'whatsapp', 'whatsap', 'watsapp', 'watsap', 'whatapp', 'wtsapp', 'whtsapp', 'watzap', 'whatzapp', 'whats app',
  'viber', 'telegram', 'wechat', 'skype', 'instagram', 'facebook', 'snapchat', 'tiktok', 'discord',
];
// Ambiguous words are only blocked as phrases ("signal" alone is ordinary English).
const APP_PHRASES = ['signal app', 'on signal', 'imo app', 'line app', 'fb messenger', 'facebook messenger', 'insta dm', 'my insta', 'my fb'];

const CONTACT_PHRASES = [
  'call me', 'call us', 'give me a call', 'give us a call', 'phone me', 'ring me', 'text me', 'sms me',
  'whatsapp me', 'dm me', 'inbox me', 'email me', 'e-mail me', 'mail me',
  'my number', 'my no', 'my phone', 'my mobile', 'my contact', 'my email', 'my e-mail', 'my gmail', 'my mail',
  'contact me directly', 'contact me on', 'contact me at', 'reach me on', 'reach me at', 'contact number',
  'phone number', 'mobile number', 'hotline',
  'off the platform', 'off platform', 'outside the platform', 'outside customt', 'outside this app', 'outside the app',
];
const PAYMENT_PHRASES = [
  'pay me directly', 'pay us directly', 'pay directly', 'direct payment', 'direct deposit', 'direct transfer',
  'bank transfer', 'bank details', 'bank account', 'account number', 'deposit to my', 'cash on delivery', 'cash payment',
];

const phraseRegex = (phrases) => new RegExp(`\\b(?:${phrases.map((p) => escapeRegex(p).replace(/\\? /g, '\\s+')).join('|')})\\b`, 'gi');

const RULES = [
  // E-mail first: it contains dots and digits that other rules would split.
  { flag: 'email', re: /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi },
  {
    flag: 'email',
    re: /\b[\w.+-]{2,}\s*[([]?\s*(?:@|\bat\b)\s*[)\]]?\s*[\w-]{2,}\s*[([]?\s*(?:\.|\bdot\b)\s*[)\]]?\s*(?:com|net|org|lk|edu|co|io|info|me)\b/gi,
  },
  { flag: 'email', re: /\b(?:g\s*mail|yahoo\s*mail|hotmail|outlook\.com|icloud\.com)\b/gi },
  // Links and shortened links.
  { flag: 'link', re: /\b(?:https?:\/\/|www\.)\S+/gi },
  { flag: 'link', re: /\b(?:wa\.me|t\.me|m\.me|bit\.ly|tinyurl\.com|chat\.whatsapp\.com|linktr\.ee)(?:\/\S*)?/gi },
  { flag: 'link', re: /\b[a-z0-9][a-z0-9-]{1,62}\.(?:com|lk|net|org|io|me|ly|link|co)(?:\/\S*)?\b/gi },
  // Phone numbers: handled by a function below (needs digit counting).
  { flag: 'phone', test: 'phone' },
  // Digits spelled out: "zero seven seven one two three four five six seven".
  { flag: 'phone', re: /\b(?:(?:zero|oh|one|two|three|four|five|six|seven|eight|nine)[\s,.-]*){7,}/gi },
  { flag: 'app', re: new RegExp(`\\b(?:${APP_NAMES.map(spaced).join('|')})\\b`, 'gi') },
  { flag: 'app', re: phraseRegex(APP_PHRASES) },
  { flag: 'contact-request', re: phraseRegex(CONTACT_PHRASES) },
  { flag: 'payment', re: phraseRegex(PAYMENT_PHRASES) },
];

/**
 * A digit run is a phone (or account) number when it has 10-15 digits, or 9 digits starting with 7
 * (a Sri Lankan mobile written without its leading 0). Separators between digits are allowed.
 */
const DIGIT_WORDS = { zero: '0', oh: '0', o: '0', one: '1', two: '2', three: '3', four: '4', five: '5', six: '6', seven: '7', eight: '8', nine: '9' };
const DIGIT_TOKEN = '(?:\\d|zero|oh|one|two|three|four|five|six|seven|eight|nine)';
// Digits and spelled-out digits may be mixed ("zero 7 seven 1 ..."), separated by spaces or punctuation.
const PHONE_CANDIDATE = new RegExp(`\\+?${DIGIT_TOKEN}(?:[\\s\\-().]{0,3}${DIGIT_TOKEN}){6,}`, 'gi');
const toDigits = (match) =>
  match
    .toLowerCase()
    .replace(/[a-z]+/g, (word) => DIGIT_WORDS[word] ?? '')
    .replace(/\D/g, '');
function maskPhones(text, flags) {
  return text.replace(PHONE_CANDIDATE, (match) => {
    const digits = toDigits(match);
    const isPhone = (digits.length >= 10 && digits.length <= 15) || (digits.length === 9 && digits.startsWith('7'));
    if (!isPhone) return match;
    flags.add('phone');
    return BLOCK;
  });
}

/**
 * Undoes common disguises before matching: full-width / styled characters ("０７７", "ｗｈａｔｓａｐｐ") are
 * folded to plain ASCII (NFKC), invisible characters (zero-width spaces, soft hyphens, joiners) are
 * removed, and keycap emoji ("7️⃣") become plain digits.
 */
function normalise(input) {
  return String(input ?? '')
    .normalize('NFKC')
    .replace(/([0-9#*])\uFE0F?\u20E3/g, '$1')
    .replace(/[\u00AD\u180E\u200B-\u200F\u202A-\u202E\u2060-\u2064\uFEFF\uFE0E\uFE0F]/g, '');
}

/**
 * @param {string} input raw message text
 * @returns {{ text: string, flagged: boolean, flags: string[] }}
 */
function filterContactInfo(input) {
  let text = normalise(input);
  const flags = new Set();

  RULES.forEach((rule) => {
    if (rule.test === 'phone') {
      text = maskPhones(text, flags);
      return;
    }
    text = text.replace(rule.re, () => {
      flags.add(rule.flag);
      return BLOCK;
    });
  });

  // Merge neighbouring blocks ("[CONTACT BLOCKED] or [CONTACT BLOCKED]" stays; "[..][..]" joins).
  const blockRe = escapeRegex(BLOCK);
  text = text.replace(new RegExp(`${blockRe}(?:[\\s:,;.-]*${blockRe})+`, 'g'), BLOCK);

  return { text, flagged: flags.size > 0, flags: [...flags] };
}

/** Masks contact details in free text a counterpart will read (bid notes, RFQ descriptions, notes...). */
function maskContactInfo(input) {
  return filterContactInfo(input).text;
}

/** True when free text contains contact details (used to reject names that smuggle them). */
function containsContactInfo(input) {
  return filterContactInfo(input).flagged;
}

module.exports = { filterContactInfo, maskContactInfo, containsContactInfo, normalise, BLOCK };
