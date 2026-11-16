# CustomT Security Audit

**Scope:** the whole backend (Express REST API, Socket.IO gateway, Mongoose models, services) and the security-relevant parts of the React frontend, as of the merge of pull request #3 (layered 3D configurator).
**Method:** manual code review of every route, socket event, service and model, followed by targeted tests. Each finding below has been fixed on branch `security-hardening` and is covered by a unit or end-to-end test.

## Summary

| # | Finding | Area | Severity | Status |
|---|---------|------|----------|--------|
| 1 | Contact details could be shared outside the chat (bid notes, RFQ description, production notes, dispute notes, reviews, profile names) | Business logic | High | Fixed |
| 2 | The chat filter could be bypassed with full-width digits, zero-width spaces, keycap emoji and mixed spelled-out digits | Socket.IO / chat | High | Fixed |
| 3 | A person with a buyer and a vendor account could award themselves orders and rate themselves to inflate their trust score (and rank) | Business logic | High | Fixed |
| 4 | Design images could point to any website (tracking pixels, `wa.me` links) | Business logic / privacy | Medium | Fixed |
| 5 | Open Socket.IO connections kept working after a password change or reset | Auth / Socket.IO | Medium | Fixed |
| 6 | Escrow payouts credited the wallet before saving the order: not safe across a crash or a second server instance | Escrow | Medium | Fixed |
| 7 | A vendor could quote an impossible lead time (1 day) to win 20% of the score | Auction ranking | Medium | Fixed |
| 8 | The seed script falls back to published default passwords, even in production | Configuration | Medium | Fixed |
| 9 | No Content-Security-Policy on the frontend (the login token lives in localStorage) | Frontend | Medium | Fixed |
| 10 | O2O PINs were stored in plain text in MongoDB | Escrow | Low | Fixed |
| 11 | JWT algorithm not pinned; login timing revealed which e-mails are registered | Auth | Low | Fixed |
| 12 | A verified vendor could rename the company without re-verification | PERA | Low | Fixed |
| 13 | No per-connection rate limit on socket events; uploads trusted the browser's MIME type | Socket.IO / uploads | Low | Fixed |

Confirmed secure (no change needed): NoSQL injection, PERA locks against direct API calls, rank visibility, escrow amounts, double funding/double release (single instance), CPAPO spec lock, password reset tokens, role escalation, error leakage. Details are in *Areas confirmed secure* below.

---

## Findings and patches

### 1. Contact details leaked outside the chat (High)

**Problem.** The chat filter (`utils/contactFilter.js`) protected only `chat:send`. Every other free-text field that the *other party* reads was stored as typed:

| Field | Written by | Read by |
|---|---|---|
| Bid `notes` | vendor | buyer (leaderboard) |
| RFQ `title`, `description` | buyer | every eligible vendor |
| Production `note` | vendor | buyer (timeline) |
| Dispute follow-up notes, dispute description | buyer / vendor | the other party |
| Rating `review` | buyer | vendor |
| `name`, `companyName` | both | the other party (leaderboard, chat) |

**Exploit.** Using Postman (or just the bid form), a vendor posts `{"price": 90000, "leadTimeDays": 7, "notes": "WhatsApp 0771234567 for 20% off"}`. The buyer sees the number in the leaderboard, and the deal moves off-platform, around escrow.

**Patch.** Mask contact details in every one of those fields with the same filter; reject names that contain them.

```js
// utils/contactFilter.js
function maskContactInfo(input) {
  return filterContactInfo(input).text;
}
function containsContactInfo(input) {
  return filterContactInfo(input).flagged;
}
```

```js
// services/auctionService.js: validateBidInput / createRfq
const cleanNotes = typeof notes === 'string' ? maskContactInfo(notes.trim()) : '';
const title = typeof input.title === 'string' ? maskContactInfo(input.title.trim()).slice(0, 120) : '';
description: typeof input.description === 'string' ? maskContactInfo(input.description.trim().slice(0, 1000)) : '',
```

```js
// services/orderService.js
const cleanNote = typeof note === 'string' ? maskContactInfo(note.trim().slice(0, 300)) : '';           // production note
review: typeof review === 'string' ? maskContactInfo(review.trim().slice(0, 1000)) : '',                // rating
const vendorMessage = politeness.vendorNotification({ ...ctx, description: maskContactInfo(text) });   // dispute
message: politeness.followUpNote({ ..., message: user.role === ROLES.ADMIN ? text : maskContactInfo(text) }),
```

```js
// routes/authRoutes.js: register and PATCH /me
function assertCleanDisplayName(label, value) {
  if (value !== undefined && value !== null && containsContactInfo(String(value))) {
    throw ApiError.badRequest(`${label} must not contain phone numbers, e-mail addresses, links or messaging handles`, {
      code: 'CONTACT_INFO_IN_NAME',
    });
  }
}
```

*Design text layers are deliberately not filtered:* printing a shop's hotline on staff T-shirts is a legitimate order. This is a documented residual risk; admins can see every RFQ.

### 2. Chat filter bypasses (High)

**Problem.** The regular expressions only understood ASCII. These all passed through unmasked:

| Input | Trick |
|---|---|
| `０７７１２３４５６７` | full-width digits |
| `077​123​4567` | zero-width spaces between digits |
| `0️⃣7️⃣7️⃣1️⃣2️⃣3️⃣4️⃣5️⃣6️⃣7️⃣` | keycap emoji |
| `zero 7 seven 1 two 3 4 5 6 seven` | digits and words mixed |
| `ｗｈａｔｓａｐｐ` | full-width letters |

**Patch.** Normalise the text before matching, and let the phone detector accept digits and spelled-out digits in one run.

```js
// utils/contactFilter.js
function normalise(input) {
  return String(input ?? '')
    .normalize('NFKC')                                   // full-width / styled → ASCII
    .replace(/([0-9#*])️?⃣/g, '$1')            // keycap emoji → digit
    .replace(/[­᠎​-‏‪-‮⁠-⁤﻿︎️]/g, ''); // invisible characters
}

const DIGIT_TOKEN = '(?:\\d|zero|oh|one|two|three|four|five|six|seven|eight|nine)';
const PHONE_CANDIDATE = new RegExp(`\\+?${DIGIT_TOKEN}(?:[\\s\\-().]{0,3}${DIGIT_TOKEN}){6,}`, 'gi');
```

Ordinary order talk is still untouched (prices such as `150,000, 135,000`, size breakdowns, order codes); `tests/security.test.js` checks both directions.

*Residual risk:* a number split across several messages ("0771…" then "…234567") cannot be caught by a per-message filter. Admins see every conversation and flagged messages in the monitoring view.

### 3. Self-dealing trust inflation (High)

**Problem.** Trust is 30% of every bid's score. With the mock gateway any Luhn-valid card "pays", so one person could:

1. register a buyer account and a vendor account,
2. post an RFQ, bid on it with the vendor, accept the bid, pay with a test card,
3. approve the inspection and rate the vendor 5 stars,
4. repeat to push the vendor's trust towards 5.0 and outrank honest vendors in every other auction.

**Patch.**
1. A bid cannot be accepted when the buyer and the vendor share a phone number.
2. Only one rating per buyer–vendor pair in 30 days changes the trust score; later ones are recorded (`countedInTrust: false`) but don't count.

```js
// services/orderService.js: acceptBid
if (vendor && samePhone(vendor.phone, buyer.phone)) {
  throw ApiError.forbidden('This bid comes from a vendor account linked to your own phone number, so it cannot be accepted.', {
    code: 'SELF_DEALING',
  });
}

function samePhone(a, b) {
  const tail = (p) => String(p || '').replace(/\D/g, '').slice(-9);
  return tail(a).length === 9 && tail(a) === tail(b);
}
```

```js
// services/orderService.js: rateVendor
const since = new Date(Date.now() - TRUST.PAIR_RATING_WINDOW_DAYS * 24 * 60 * 60 * 1000);
const recentPairRating = await Order.exists({
  _id: { $ne: order._id },
  buyerId: order.buyerId,
  vendorId: order.vendorId,
  'buyerRating.countedInTrust': { $ne: false },
  'buyerRating.ratedAt': { $gte: since },
});
const countedInTrust = !recentPairRating;
const trustAfter = countedInTrust ? nextTrustScore(trustBefore, value) : trustBefore;
```

*Residual risk:* a determined attacker can register a second buyer with a different phone number. In production a real payment gateway (each staged order costs real money) and phone-number verification by SMS OTP close this.

### 4. Design images could point anywhere (Medium)

**Problem.** `imageLayers[].url`, the legacy `logoUrl` and dispute `evidenceUrls` accepted any `http(s)://` URL. A buyer could set `https://attacker.example/pixel.png` and learn the IP address and timing of every vendor who opened the RFQ. They could also set `https://wa.me/94771234567`, which the spec summary renders as a clickable link.

**Patch.** Only files uploaded through `POST /api/uploads/logo` are accepted, with the exact filename pattern the server generates. When `PUBLIC_API_URL` is configured (production), the origin must be the API's.

```js
// utils/uploadUrl.js
const UPLOAD_PATH = /^\/uploads\/logos\/[a-f0-9]{24}-\d{10,16}-[a-f0-9]{8}\.(?:png|jpg|webp|svg)$/;

function isUploadedFileUrl(raw) {
  const url = typeof raw === 'string' ? raw.trim() : '';
  if (!url || url.length > 500) return false;
  if (url.startsWith('/')) return UPLOAD_PATH.test(url);
  let parsed;
  try { parsed = new URL(url); } catch { return false; }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.search || parsed.hash) return false;
  if (config.publicApiUrl && parsed.origin !== new URL(config.publicApiUrl).origin) return false;
  return UPLOAD_PATH.test(parsed.pathname);
}
```

### 5. Socket.IO sessions survived a password change (Medium)

**Problem.** REST requests were rejected after a password change (`passwordChangedAt`), but an already-connected socket stayed authenticated. Leaderboards, O2O PINs and chat messages are pushed to the user's room, so a stolen session kept receiving them until the browser tab closed.

**Patch.** Close the user's sockets on password change or reset. Every socket event also re-checks the token's issue time against `passwordChangedAt`.

```js
// routes/authRoutes.js
function disconnectUserSockets(userId) {
  const io = realtime.getIO();
  if (io) io.in(realtime.rooms.user(String(userId))).disconnectSockets(true);
}
// called after PATCH /auth/me/password and POST /auth/reset-password
```

```js
// sockets/index.js
socket.data.issuedAt = issuedAt; // from the handshake JWT
const currentUser = async () => {
  const user = await User.findById(userId);
  if (!user || !user.isActive || user.tokenIssuedBeforePasswordChange(socket.data.issuedAt)) {
    socket.disconnect(true);
    throw new Error('Session no longer valid - please log in again');
  }
  return user;
};
```

The browser tab that changed the password receives a new token and reconnects automatically (`SocketContext` re-creates the socket when the token changes).

### 6. Escrow payouts were not crash-safe (Medium)

**Problem.** Money moved in two writes, wallet first and order second:

```js
await User.updateOne({ _id: order.vendorId }, { $inc: { walletBalance: order.advanceAmount } });
order.advanceReleased = true;
...
await order.save();
```

The per-order mutex lives in one Node.js process. If the process stopped between the two writes, the wallet was credited but the order still said `advanceReleased: false`, so a retry paid again. With two Render instances, two requests could both pass the state check.

**Patch.**
1. **Optimistic concurrency on `Order`.** Every save checks the document version, so only one of two concurrent transitions can succeed; the other gets HTTP 409.
2. **Save the order before moving money.** If anything fails in between, the platform under-pays (and the ledger shows exactly what is owed) instead of paying twice.

```js
// models/Order.js
{ timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true }, optimisticConcurrency: true }
```

```js
// services/orderService.js: advanceProduction (same pattern in completeOrder and resolveDispute)
await order.save();
if (creditVendor > 0) await User.updateOne({ _id: order.vendorId }, { $inc: { walletBalance: creditVendor } });
```

```js
// middleware/errorHandler.js
if (err instanceof mongoose.Error.VersionError) {
  return { status: 409, message: 'This record was changed by another request. Please refresh and try again.', code: 'CONCURRENT_UPDATE' };
}
```

*Production note:* on MongoDB Atlas (a replica set), wrapping both writes in `session.withTransaction()` makes them all-or-nothing. It isn't used here because the CI database is a standalone `mongo:7`, which doesn't support transactions.

### 7. Lead-time gaming (Medium)

**Problem.** Lead time is 20% of the score, normalised as `minLeadTime / leadTimeDays`. A vendor quoting 1 day for 200 embroidered hoodies gets the full 20% and pushes everyone else's lead-time component down.

**Patch.** A bid must quote at least half of the platform's own realistic production estimate (the same estimator that sets the buyer's minimum delivery).

```js
// services/auctionService.js: placeBid
const minLeadTime = Math.ceil(calculateExpectedDeliveryDays(rfq.designSpecs) * AUCTION.MIN_LEAD_TIME_RATIO); // 0.5
if (clean.leadTimeDays < minLeadTime) {
  throw ApiError.badRequest(`For this order the shortest credible lead time is ${minLeadTime} days`, { code: 'LEAD_TIME_TOO_SHORT' });
}
```

*Price dumping* (bidding LKR 1 to reach rank 1) is not blocked in code: a vendor can't raise the price later (`ALLOW_BID_PRICE_INCREASE=false`), so they would have to deliver at that price. The Price-Signal Diagnostic (coefficient of variation) flags such outliers to the buyer, and the buyer chooses the winner.

### 8. Default seed passwords in production (Medium)

**Problem.** `npm run seed:admin` falls back to `Admin@12345`, and the demo accounts to `Demo@12345`. Both are printed in the README.

**Patch.** With `NODE_ENV=production` the seed refuses to run unless strong passwords are supplied.

```js
// scripts/seed.js
function assertSafeSeedPasswords() {
  if (!config.isProduction) return;
  const strong = (p) => typeof p === 'string' && /^(?=.*[A-Za-z])(?=.*\d).{12,64}$/.test(p) && !/^(Admin|Demo)@12345$/.test(p);
  ...
  if (problems.length) { console.error(`[seed] Refusing to seed production with default passwords. Set: ...`); process.exit(1); }
}
```

**Action for the live site:** if the live admin was created with the default password, change it now (*Account → Change password*). If demo accounts were seeded into the live database, delete them or change their passwords.

### 9. No Content-Security-Policy on the frontend (Medium)

**Problem.** The JWT is stored in `localStorage`, so any successful XSS could read it. React escapes output and no `dangerouslySetInnerHTML` is used, but there was no second line of defence. There was also no clickjacking protection.

**Patch.** `frontend/vercel.json` now sends these headers on every page:

```
Content-Security-Policy: default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com;
  font-src 'self' data: https://fonts.gstatic.com; img-src 'self' data: blob: https://customt-api.onrender.com;
  connect-src 'self' https://customt-api.onrender.com wss://customt-api.onrender.com; worker-src 'self' blob:;
  object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; upgrade-insecure-requests
X-Frame-Options: DENY
X-Content-Type-Options: nosniff
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=()
Strict-Transport-Security: max-age=31536000; includeSubDomains
```

- `'wasm-unsafe-eval'` allows only WebAssembly (used by the 3D model loader), not JavaScript `eval`.
- The policy was tested in Chromium against the built app: configurator, 3D viewer and PDF receipt, with no violations.

*Further hardening (not done):* move the token to an `HttpOnly; Secure; SameSite` cookie. That needs CSRF protection and cross-site cookie settings between Vercel and Render, so it is a larger change.

### 10. O2O PIN stored in plain text (Low)

**Problem.** The PIN that releases the final 70% was stored as a plain 6-digit string (`select: false` hides it from queries, but not from anyone reading the database or a backup).

**Patch.** The buyer must be able to view the PIN again, so it can't be hashed. It is encrypted with AES-256-GCM instead, using a key derived from `JWT_SECRET` with HKDF.

```js
// utils/pinVault.js
function sealPin(pin) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const ciphertext = Buffer.concat([cipher.update(String(pin), 'utf8'), cipher.final()]);
  return ['v1', iv, cipher.getAuthTag(), ciphertext].map(b64url).join('.');
}
function openPin(stored) { /* verifies the GCM tag; returns null if tampered or the key changed */ }
```

PINs already stored in plain text (orders in progress at deployment) are still read correctly.

### 11. JWT algorithm pinning and login timing (Low)

```js
// middleware/auth.js
const JWT_ALGORITHM = 'HS256';
jwt.sign(payload, config.jwtSecret, { algorithm: JWT_ALGORITHM, expiresIn: config.jwtExpiresIn });
jwt.verify(token, config.jwtSecret, { algorithms: [JWT_ALGORITHM] });
```

`jsonwebtoken` 9 already rejects `alg: none`. Pinning makes the accepted algorithm explicit, and the reset tokens are pinned the same way.

**Login timing.** For an unknown e-mail the server answered without running bcrypt, about 250 ms faster than for a known one, which revealed registered e-mails. It now compares against a dummy hash:

```js
const passwordOk = user ? await user.comparePassword(password) : await bcrypt.compare(password, DUMMY_HASH).then(() => false);
```

### 12. Company rename without re-verification (Low)

Admins verify a *business*. Changing capabilities, capacity or licence date already removed verification; changing `companyName` now does too, so a verified vendor can't rename itself to impersonate another company.

### 13. Socket event flooding and upload content checks (Low)

```js
// sockets/index.js: at most 40 client events per 10 s per connection; excess events are answered with 429
socket.use((packet, next) => { ... if (eventsInWindow <= EVENT_LIMIT) return next(); safeAck(ack)({ ok: false, error: { status: 429, ... } }); });
```

Uploads used to trust the browser-declared MIME type. `routes/uploadRoutes.js` now checks the file's magic bytes (PNG, JPEG, WEBP, or an `<svg` root) and deletes files that don't match. SVGs were already served with `Content-Security-Policy: sandbox` and `nosniff`, so scripts inside them never run.

---

## Areas confirmed secure

**Authentication and JWT**
- Secret: the API refuses to start in production without `JWT_SECRET`, or with one shorter than 32 characters. Render generates a random value.
- Every request reloads the user, so suspension takes effect immediately.
- Tokens issued before the last password change are rejected.
- Reset tokens:
  - are signed with `JWT_SECRET` plus the current password hash, so they are single-use;
  - expire after 15 minutes;
  - carry a `purpose` claim, so they can't be used as login tokens (and login tokens can't reset passwords).
- `forgot-password` gives the same answer for unknown and known e-mails and is rate-limited (5 per 15 minutes).
- Login, register and reset are limited to 50 requests per 15 minutes per IP (`trust proxy` is set for Render).
- `passwordHash` is `select: false` and removed in `toJSON`.

**Role escalation**
- Registration accepts only `buyer` or `vendor`. There is no API that creates admins or changes a role.
- `isVerified`, `trustScore`, `skillBadges` and `walletBalance` can't be set through `PATCH /auth/me`: only named fields are copied, never the whole body.

**NoSQL injection**
- Every value from `req.body`, `req.query` or a socket payload that reaches a query is cast first:
  - `String(...)` for e-mails and search text;
  - status filters are checked against the enum lists;
  - ids go through `assertObjectId`;
  - `parseInt` is used for pagination.
- An object such as `{"$ne": null}` therefore never reaches MongoDB as an operator. Search strings are passed through `escapeRegex` (no ReDoS).
- Mongoose schemas enforce types, enums, ranges and lengths on every field (sizes, GSM, colours, layers, ratings, notes).

**Socket.IO authorisation**
- The handshake requires a valid JWT (same checks as REST).
- Users are joined only to their own `user_<id>` room and their role room.
- `rfq:join` calls the same role-aware `getAuctionSnapshot` as REST, which refuses buyers who don't own the RFQ and vendors who fail the PERA participant lock.
- The shared `rfq_<id>` room receives only bid count and timer, never prices, identities or the leaderboard.
- `bid:place` re-checks role, account status and full PERA eligibility in the service.
- The client can't spoof `userId` or `role`: both come from the verified token, never from the payload.

**PERA locks against Postman**
- The qualification lock (verified, licence not expired, account active) and the participant lock (capability and capacity) are enforced inside `auctionService.placeBid`, which serves both REST and Socket.IO. They can't be bypassed by calling the API directly.
- The event lock (`createRfq`) counts qualified vendors in the database.
- `acceptBid` re-checks that the winner is still qualified.
- The vendor RFQ feed filters by capability and capacity in the query.

**Rank manipulation**
- Vendors send only `price`, `leadTimeDays` and `notes`.
- `score`, `rank` and `trustScoreSnapshot` are computed on the server from database values.
- Re-bids can't raise the price.
- Vendors see only their own rank and the bid count (Rank-Based Partial Visibility).
- Bids are serialised per RFQ by a mutex, and a unique index allows one bid per vendor per RFQ.

**Escrow amounts**
- `fundEscrow` charges `order.agreedPrice` from the database. The request body contains only card details, so a buyer can't change the amount.
- Funding, production steps, PIN checks and disputes are each gated by the exact current state, so an order can't be funded twice, released twice, or refunded after completion.
- The vendor never receives the PIN: it is stripped from every order response and sent only to the buyer's private room.
- Wrong PINs are counted: after 5, the PIN locks until the buyer generates a new one, and the buyer is alerted on every failed attempt. The comparison is constant-time.

**CPAPO**
- Specs are locked by a `pre('save')` hook and by query hooks on `updateOne`, `updateMany` and `findOneAndUpdate`.
- `PUT` and `PATCH` on an RFQ always return 423.

**Error handling**
- Stack traces are returned only outside production.
- Unknown errors become a generic 500 message.
- Helmet sets API security headers.
- CORS is restricted to `CLIENT_URL` origins.

## Remaining recommendations (out of scope for code changes)

1. Replace the mock gateway with a real one (PayHere or Stripe) and confirm payments through the gateway's signed webhook, not the browser.
2. Verify phone numbers by SMS OTP at registration. This makes the self-dealing check (finding 3) much stronger.
3. Move the session token to an HttpOnly cookie (see finding 9).
4. Use MongoDB transactions on Atlas for the two-write payouts (see finding 6).
5. Store uploads in object storage (S3, Cloudinary) instead of Render's ephemeral disk.

## How the fixes are tested

- `backend/tests/security.test.js` (unit):
  - disguised contact details are blocked and ordinary order talk is untouched;
  - names with contact details are detected;
  - only CustomT upload URLs are accepted;
  - O2O PIN encryption is checked for round-trip, a fresh IV each time, tamper detection and legacy plain PINs;
  - phone linking works.
- `backend/tests/designLayers.test.js` rejects external, `wa.me`, path-traversal and `javascript:` image URLs.
- `backend/tests/e2e/fullFlow.e2e.js`, test 20 (against a real MongoDB in CI):
  - a contact name is rejected and an external image is rejected;
  - the RFQ description and bid notes are masked;
  - a 1-day lead time is rejected;
  - accepting your own bid is blocked as `SELF_DEALING`;
  - the socket is disconnected after a password change.
- The whole existing suite, which covers the auction, escrow, O2O, dispute, chat and password-reset flows, still runs unchanged.
