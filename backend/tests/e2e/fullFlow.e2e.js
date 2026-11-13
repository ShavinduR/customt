/**
 * CustomT end-to-end test: boots the real API + Socket.IO server against a real MongoDB
 * and walks the complete marketplace lifecycle over HTTP and WebSockets.
 *
 *   E2E_MONGO_URI=mongodb://localhost:27017/customt_e2e npm run test:e2e
 *
 * SAFETY: every collection in the target database is emptied before the run. The test refuses
 * to start unless the database name contains "test" or "e2e", so it can't wipe real data.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

// ── Environment must be fixed before any app module is required ─────────────────────────
const E2E_URI = process.env.E2E_MONGO_URI;
if (!E2E_URI) {
  // eslint-disable-next-line no-console
  console.error('Set E2E_MONGO_URI (e.g. mongodb://localhost:27017/customt_e2e) to run the end-to-end test.');
  process.exit(1);
}
const dbName = new URL(E2E_URI.replace(/^mongodb(\+srv)?:\/\//, 'http://')).pathname.replace(/^\//, '');
if (!/test|e2e/i.test(dbName)) {
  // eslint-disable-next-line no-console
  console.error(`Refusing to run: database "${dbName || '(none)'}" must contain "test" or "e2e" because it is wiped.`);
  process.exit(1);
}
Object.assign(process.env, {
  MONGO_URI: E2E_URI,
  JWT_SECRET: process.env.JWT_SECRET || 'e2e-secret-key-that-is-long-enough-for-tests-0123456789',
  NODE_ENV: 'test',
  PORT: '0',
  MOCK_GATEWAY_LATENCY_MS: '0',
  AUCTION_SCHEDULER_INTERVAL_MS: '3600000', // the test triggers expiry checks explicitly
  ALLOW_BID_PRICE_INCREASE: 'false',
  CLIENT_URL: 'http://localhost:5173',
  SMTP_HOST: '', // e-mails are captured in memory instead of sent
});

const { io: ioClient } = require('socket.io-client');
const { start } = require('../../server');
const { disconnectDB } = require('../../config/db');
const { User, RFQ, Bid, Order } = require('../../models');
const { closeExpiredAuctions, stopAuctionScheduler } = require('../../services/auctionService');
const { getLastTestMessage } = require('../../services/mailer');

// ── Helpers ───────────────────────────────────────────────────────────────────────────────
let BASE;
let runtime;
const sockets = [];
const S = {}; // shared state across sequential steps

async function api(method, path, token, body) {
  const res = await fetch(`${BASE}/api${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, body: json };
}

async function ok(method, path, token, body, expected = [200, 201]) {
  const res = await api(method, path, token, body);
  assert.ok(expected.includes(res.status), `${method} ${path} → ${res.status}: ${JSON.stringify(res.body)}`);
  return res.body;
}

function connect(token) {
  return new Promise((resolve, reject) => {
    const socket = ioClient(BASE, { auth: { token }, transports: ['websocket'], reconnection: false });
    socket.events = [];
    socket.onAny((event, payload) => socket.events.push({ event, payload }));
    socket.once('connect', () => resolve(socket));
    socket.once('connect_error', reject);
    sockets.push(socket);
  });
}

function waitFor(socket, event, predicate = () => true, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(event, handler);
      reject(new Error(`Timed out waiting for "${event}"`));
    }, timeoutMs);
    function handler(payload) {
      if (!predicate(payload)) return;
      clearTimeout(timer);
      socket.off(event, handler);
      resolve(payload);
    }
    socket.on(event, handler);
  });
}

/** Every value stored under `key` anywhere inside the payloads a socket received. */
function valuesOf(socket, key) {
  const found = [];
  const walk = (node) => {
    if (Array.isArray(node)) node.forEach(walk);
    else if (node && typeof node === 'object') {
      Object.entries(node).forEach(([k, v]) => {
        if (k === key) found.push(v);
        walk(v);
      });
    }
  };
  socket.events.forEach((e) => walk(e.payload));
  return found;
}

const emitAck = (socket, event, payload) => new Promise((resolve) => socket.emit(event, payload, resolve));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const inYears = (n) => new Date(Date.now() + n * 365 * 86400000).toISOString().slice(0, 10);
const CARD_OK = { cardNumber: '4242 4242 4242 4242', cardHolder: 'E2E Buyer', expiry: '12/30', cvv: '123' };
const CARD_DECLINED = { ...CARD_OK, cardNumber: '4000 0000 0000 0002' };

const SPECS = {
  garmentType: 'Crew Neck',
  fabric: '100% Cotton',
  gsm: 180,
  color: '#1E3A8A',
  printType: 'Screen Printing',
  printPlacement: 'FRONT',
  customText: 'E2E RUN 2026',
  sizeBreakdown: { S: 20, M: 40, L: 40, XL: 15, XXL: 5 }, // 120 pcs
};

function expectedScores(bids) {
  const minPrice = Math.min(...bids.map((b) => b.price));
  const minLead = Math.min(...bids.map((b) => b.leadTimeDays));
  const maxTrust = Math.max(...bids.map((b) => b.trust));
  return bids.map((b) => (minPrice / b.price) * 0.5 + (b.trust / maxTrust) * 0.3 + (minLead / b.leadTimeDays) * 0.2);
}

async function registerVendor(name, email, capabilities, maxCapacity) {
  const res = await ok('POST', '/auth/register', null, {
    role: 'vendor',
    name,
    email,
    password: 'Vendor1234',
    phone: '+94770000000',
    companyName: `${name} Prints`,
    businessRegNo: `PV-${Math.floor(Math.random() * 1e6)}`,
    capabilities,
    maxCapacity,
    licenseExpiryDate: inYears(1),
  });
  return { token: res.token, id: res.user._id || res.user.id };
}

// ── Lifecycle ─────────────────────────────────────────────────────────────────────────────
test.before(async () => {
  runtime = await start();
  if (!runtime.server.listening) await new Promise((r) => runtime.server.once('listening', r));
  BASE = `http://127.0.0.1:${runtime.server.address().port}`;
  await Promise.all([User, RFQ, Bid, Order].map((m) => m.deleteMany({})));
});

test.after(async () => {
  sockets.forEach((s) => s.close());
  stopAuctionScheduler();
  if (runtime) {
    runtime.server.closeAllConnections();
    await new Promise((r) => runtime.io.close(() => r()));
  }
  await disconnectDB();
});

// ── 1. Accounts & PERA qualification-level lock ───────────────────────────────────────────
test('admin, buyer and vendors can be created; unverified vendors are locked out', async () => {
  const admin = new User({ role: 'admin', name: 'E2E Admin', email: 'admin@e2e.test' });
  await admin.setPassword('Admin12345');
  await admin.save();
  S.admin = (await ok('POST', '/auth/login', null, { email: 'admin@e2e.test', password: 'Admin12345' })).token;

  const buyer = await ok('POST', '/auth/register', null, { role: 'buyer', name: 'E2E Buyer', email: 'buyer@e2e.test', password: 'Buyer1234', phone: '+94771234567' });
  S.buyer = buyer.token;
  S.buyerId = buyer.user._id || buyer.user.id;

  S.v1 = await registerVendor('Alpha', 'v1@e2e.test', ['Screen Printing', 'DTF'], 1000);
  S.v2 = await registerVendor('Bravo', 'v2@e2e.test', ['Screen Printing'], 500);
  S.v3 = await registerVendor('Charlie', 'v3@e2e.test', ['Embroidery'], 1000); // wrong capability
  S.v4 = await registerVendor('Delta', 'v4@e2e.test', ['Screen Printing'], 300);

  const res = await api('GET', '/vendor/rfqs', S.v1.token);
  assert.equal(res.status, 403);
  assert.equal(res.body.code, 'PERA_QUALIFICATION_LOCK');

  const asAdmin = await api('POST', '/auth/register', null, { role: 'admin', name: 'x', email: 'x@e2e.test', password: 'abc12345' });
  assert.equal(asAdmin.status, 400, 'self-registration as admin must be refused');
});

// ── 2. PERA event-level lock ──────────────────────────────────────────────────────────────
test('RFQ launch is refused while no prequalified vendor exists (event lock)', async () => {
  const preview = await ok('POST', '/rfqs/preview', S.buyer, { designSpecs: SPECS });
  assert.equal(preview.preview.eligibleVendorCount, 0);
  assert.equal(preview.preview.canLaunch, false);
  assert.equal(preview.preview.totalQuantity, 120);

  const res = await api('POST', '/rfqs', S.buyer, { title: 'Too early', designSpecs: SPECS });
  assert.equal(res.status, 422);
  assert.equal(res.body.code, 'PERA_EVENT_LOCK');

  const moq = await api('POST', '/rfqs/preview', S.buyer, { designSpecs: { ...SPECS, sizeBreakdown: { S: 5, M: 5 } } });
  assert.equal(moq.status, 400);
  assert.equal(moq.body.code, 'MOQ_NOT_MET');
});

// ── 3. Admin verification + badges ───────────────────────────────────────────────────────
test('admin verifies vendors and assigns skill badges', async () => {
  for (const v of [S.v1, S.v2, S.v3, S.v4]) {
    const res = await ok('PATCH', `/admin/vendors/${v.id}/verification`, S.admin, { isVerified: true, licenseExpiryDate: inYears(1) });
    assert.deepEqual(res.vendor.qualificationIssues, []);
  }
  const badges = await ok('PATCH', `/admin/vendors/${S.v2.id}/badges`, S.admin, { skillBadges: ['Verified Quality', 'Fast Delivery'] });
  assert.deepEqual(badges.vendor.skillBadges, ['Verified Quality', 'Fast Delivery']);

  const pending = await ok('GET', '/admin/vendors?status=pending', S.admin);
  assert.equal(pending.total, 0);
});

// ── 4. RFQ creation, real-time broadcast to eligible vendors only, CPAPO lock ─────────────
test('buyer launches an RFQ; only capable vendors are notified; specs are locked', async () => {
  S.sBuyer = await connect(S.buyer);
  S.sV1 = await connect(S.v1.token);
  S.sV2 = await connect(S.v2.token);
  S.sV3 = await connect(S.v3.token);
  S.sV4 = await connect(S.v4.token);

  const v1New = waitFor(S.sV1, 'rfq:new');
  const v2New = waitFor(S.sV2, 'rfq:new');
  const res = await ok('POST', '/rfqs', S.buyer, { title: 'E2E staff tees', designSpecs: SPECS });
  S.rfq = res.rfq;
  assert.equal(S.rfq.status, 'OPEN');
  assert.equal(S.rfq.isLocked, true);
  assert.equal(S.rfq.eligibleVendorCount, 3, 'v1, v2 and v4 can print 120 pcs of Screen Printing');

  const [n1] = await Promise.all([v1New, v2New]);
  assert.equal(n1.rfq._id, S.rfq._id);
  assert.equal(n1.rfq.buyerId, undefined, 'vendors must not receive buyer identity');
  await sleep(300);
  assert.ok(!S.sV3.events.some((e) => e.event === 'rfq:new'), 'embroidery-only vendor must not be notified');

  const locked = await api('PUT', `/rfqs/${S.rfq._id}`, S.buyer, { title: 'changed' });
  assert.equal(locked.status, 423);
  assert.equal(locked.body.code, 'CPAPO_SPEC_LOCK');

  const feed = await ok('GET', '/vendor/rfqs', S.v1.token);
  assert.ok(feed.items.some((i) => i._id === S.rfq._id));
  const feed3 = await ok('GET', '/vendor/rfqs', S.v3.token);
  assert.ok(!feed3.items.some((i) => i._id === S.rfq._id));
});

// ── 5. Participant lock ───────────────────────────────────────────────────────────────────
test('a vendor without the required capability cannot bid (participant lock)', async () => {
  const res = await api('POST', `/rfqs/${S.rfq._id}/bids`, S.v3.token, { price: 90000, leadTimeDays: 5 });
  assert.equal(res.status, 403);
  assert.equal(res.body.code, 'PERA_PARTICIPANT_LOCK');
});

// ── 6. Live bidding, scoring, rank-only visibility ───────────────────────────────────────
test('socket bids are scored with the multi-attribute formula and ranked live', async () => {
  for (const s of [S.sV1, S.sV2, S.sV4]) {
    const joined = await emitAck(s, 'rfq:join', { rfqId: S.rfq._id });
    assert.equal(joined.ok, true, JSON.stringify(joined));
    assert.equal(joined.snapshot.leaderboard, undefined, 'vendor snapshot must not include the leaderboard');
  }

  const a1 = await emitAck(S.sV1, 'bid:place', { rfqId: S.rfq._id, price: 150000, leadTimeDays: 10, notes: 'Plastisol' });
  assert.equal(a1.ok, true, JSON.stringify(a1));
  assert.equal(a1.result.rank, 1);

  const board = waitFor(S.sBuyer, 'auction:leaderboard', (p) => p.rfqId === S.rfq._id && p.bidCount === 2);
  const v1Rank = waitFor(S.sV1, 'auction:rank', (p) => p.rfqId === S.rfq._id && p.totalBids === 2);
  const a2 = await emitAck(S.sV2, 'bid:place', { rfqId: S.rfq._id, price: 135000, leadTimeDays: 7 });
  assert.equal(a2.ok, true, JSON.stringify(a2));
  assert.equal(a2.result.rank, 1, 'cheaper and faster bid takes rank #1');
  assert.equal(a2.result.rankLabel, 'Your Rank: #1 of 2');

  const lb = await board;
  const scores = expectedScores([
    { price: 150000, leadTimeDays: 10, trust: 3.5 },
    { price: 135000, leadTimeDays: 7, trust: 3.5 },
  ]);
  const byPrice = Object.fromEntries(lb.leaderboard.map((e) => [e.price, e]));
  assert.ok(Math.abs(byPrice[150000].score - scores[0]) < 1e-4);
  assert.ok(Math.abs(byPrice[135000].score - scores[1]) < 1e-4);
  assert.deepEqual(byPrice[135000].skillBadges, ['Verified Quality', 'Fast Delivery'], 'buyer sees vendor badges');

  const r1 = await v1Rank;
  assert.equal(r1.rank, 2);
  assert.equal(r1.myBid.price, 150000);
  assert.equal(r1.myBid.score, undefined, 'vendors never receive scores');
  assert.equal(r1.leaderboard, undefined);
  assert.ok(!S.sV1.events.some((e) => e.event === 'auction:leaderboard'), 'vendors never receive the leaderboard');
  assert.deepEqual([...new Set(valuesOf(S.sV1, 'price'))], [150000], "a vendor only ever receives its own price");
  assert.equal(valuesOf(S.sV1, 'vendorName').length, 0, 'competitor identities never reach a vendor');

  const vendorView = await ok('GET', `/rfqs/${S.rfq._id}`, S.v1.token);
  assert.equal(vendorView.viewer, 'vendor');
  assert.equal(vendorView.leaderboard, undefined);
  assert.equal(vendorView.rankLabel, 'Your Rank: #2 of 2');

  const buyerView = await ok('GET', `/rfqs/${S.rfq._id}`, S.buyer);
  assert.equal(buyerView.leaderboard.length, 2);
});

// ── 7. Multi-round re-bidding rules ──────────────────────────────────────────────────────
test('re-bids may lower but not raise the price, and keep a revision history', async () => {
  const raise = await api('POST', `/rfqs/${S.rfq._id}/bids`, S.v1.token, { price: 160000, leadTimeDays: 10 });
  assert.equal(raise.status, 400);
  assert.equal(raise.body.code, 'PRICE_INCREASE_NOT_ALLOWED');

  const lower = await ok('POST', `/rfqs/${S.rfq._id}/bids`, S.v1.token, { price: 120000, leadTimeDays: 10, notes: 'Plastisol' });
  assert.equal(lower.isRevision, true);
  assert.equal(lower.myBid.revisionCount, 1);
  assert.equal(lower.myBid.revisions[0].price, 150000);
});

// ── 8. Price-signal diagnostic ───────────────────────────────────────────────────────────
test('a third, far-off bid raises the high price-variance flag (CV > 0.35)', async () => {
  const board = waitFor(S.sBuyer, 'auction:leaderboard', (p) => p.rfqId === S.rfq._id && p.bidCount === 3);
  await ok('POST', `/rfqs/${S.rfq._id}/bids`, S.v4.token, { price: 300000, leadTimeDays: 12 });
  const lb = await board;
  assert.equal(lb.priceDiagnostic.highVariance, true);
  assert.ok(lb.priceDiagnostic.coefficientOfVariation > 0.35);
  assert.equal(lb.leaderboard[2].price, 300000, 'the outlier ranks last');
});

// ── 9. Soft-close ────────────────────────────────────────────────────────────────────────
test('a bid in the final 2 minutes extends the auction by 5 minutes', async () => {
  const closing = new Date(Date.now() + 60 * 1000);
  await RFQ.updateOne({ _id: S.rfq._id }, { $set: { expiresAt: closing } });

  const extended = waitFor(S.sV1, 'auction:extended', (p) => p.rfqId === S.rfq._id);
  const res = await ok('POST', `/rfqs/${S.rfq._id}/bids`, S.v4.token, { price: 290000, leadTimeDays: 12 });
  assert.equal(res.extended, true);
  const event = await extended;
  assert.equal(new Date(event.expiresAt).getTime(), closing.getTime() + 5 * 60 * 1000);
  assert.equal(event.extensionCount, 1);
});

// ── 10. Award ────────────────────────────────────────────────────────────────────────────
test('buyer accepts the #1 bid: order created, winner and losers notified, auction closed', async () => {
  const buyerView = await ok('GET', `/rfqs/${S.rfq._id}`, S.buyer);
  const top = buyerView.leaderboard[0];
  assert.equal(top.price, 135000);

  const won = waitFor(S.sV2, 'auction:awarded', (p) => p.rfqId === S.rfq._id);
  const lost = waitFor(S.sV1, 'auction:lost', (p) => p.rfqId === S.rfq._id);
  const res = await ok('POST', `/rfqs/${S.rfq._id}/bids/${top.bidId}/accept`, S.buyer);
  S.order = res.order;
  assert.equal(S.order.orderStatus, 'PENDING_ESCROW');
  assert.equal(S.order.escrowStatus, 'AWAITING_PAYMENT');
  assert.equal(S.order.advanceAmount, 40500);
  assert.equal(S.order.finalAmount, 94500);
  await Promise.all([won, lost]);

  const again = await api('POST', `/rfqs/${S.rfq._id}/bids/${top.bidId}/accept`, S.buyer);
  assert.equal(again.status, 409, 'an RFQ can only be awarded once');

  const late = await api('POST', `/rfqs/${S.rfq._id}/bids`, S.v1.token, { price: 100000, leadTimeDays: 5 });
  assert.equal(late.status, 409);
  assert.equal(late.body.code, 'AUCTION_CLOSED');
});

// ── 11. Escrow funding ───────────────────────────────────────────────────────────────────
test('production cannot start before escrow; declined cards are rejected; payment locks escrow', async () => {
  const early = await api('PATCH', `/orders/${S.order._id}/production`, S.v2.token, { status: 'MATERIAL_SOURCED' });
  assert.equal(early.status, 409);

  const declined = await api('POST', `/orders/${S.order._id}/pay`, S.buyer, CARD_DECLINED);
  assert.equal(declined.status, 402);
  assert.equal(declined.body.code, 'PAYMENT_DECLINED');

  const notMine = await api('POST', `/orders/${S.order._id}/pay`, S.v2.token, CARD_OK);
  assert.equal(notMine.status, 403);

  const paid = await ok('POST', `/orders/${S.order._id}/pay`, S.buyer, CARD_OK);
  assert.equal(paid.order.escrowStatus, 'ESCROW_LOCKED');
  assert.equal(paid.order.escrowHeld, 135000);
  assert.match(paid.receipt.transactionRef, /^TXN-/);

  const twice = await api('POST', `/orders/${S.order._id}/pay`, S.buyer, CARD_OK);
  assert.equal(twice.status, 409);
});

// ── 12. Milestone 1: 30% advance ─────────────────────────────────────────────────────────
test('production follows the strict sequence and releases the 30% advance', async () => {
  const skip = await api('PATCH', `/orders/${S.order._id}/production`, S.v2.token, { status: 'IN_PRODUCTION' });
  assert.equal(skip.status, 400);
  assert.equal(skip.body.code, 'INVALID_PRODUCTION_TRANSITION');

  await ok('PATCH', `/orders/${S.order._id}/production`, S.v2.token, { status: 'MATERIAL_SOURCED' });
  const res = await ok('PATCH', `/orders/${S.order._id}/production`, S.v2.token, { status: 'IN_PRODUCTION' });
  assert.equal(res.order.escrowStatus, 'PARTIALLY_RELEASED');
  assert.equal(res.order.escrowHeld, 94500);

  const wallet = await ok('GET', '/vendor/wallet', S.v2.token);
  assert.equal(wallet.walletBalance, 40500);
  assert.equal(wallet.pendingInEscrow, 94500);
});

// ── 13. O2O verification & Milestone 2 ───────────────────────────────────────────────────
test('ready for inspection issues a buyer-only PIN; the correct PIN releases the 70%', async () => {
  const ready = waitFor(S.sBuyer, 'o2o:ready', (p) => p.orderId === S.order._id);
  await ok('PATCH', `/orders/${S.order._id}/production`, S.v2.token, { status: 'READY_FOR_INSPECTION' });
  const { pin } = await ready;
  assert.match(pin, /^\d{6}$/);
  assert.equal(valuesOf(S.sV2, 'pin').length, 0, 'the vendor must never receive the PIN');

  const view = await ok('GET', `/orders/${S.order._id}/o2o`, S.buyer);
  assert.equal(view.o2o.pin, pin);
  assert.match(view.o2o.qrDataUrl, /^data:image\/png;base64,/);
  const vendorPeek = await api('GET', `/orders/${S.order._id}/o2o`, S.v2.token);
  assert.equal(vendorPeek.status, 403);
  const vendorOrder = await ok('GET', `/orders/${S.order._id}`, S.v2.token);
  assert.equal(vendorOrder.order.o2oPin, undefined);

  const wrongPin = pin === '000000' ? '111111' : '000000';
  const wrong = await api('POST', `/orders/${S.order._id}/o2o/verify`, S.v2.token, { pin: wrongPin });
  assert.equal(wrong.status, 400);
  assert.equal(wrong.body.code, 'O2O_PIN_INVALID');
  assert.equal(wrong.body.details.attemptsRemaining, 4);

  const done = await ok('POST', `/orders/${S.order._id}/o2o/verify`, S.v2.token, { pin });
  assert.equal(done.order.orderStatus, 'COMPLETED');
  assert.equal(done.order.escrowStatus, 'FUNDS_RELEASED');
  assert.equal(done.order.escrowHeld, 0);

  const wallet = await ok('GET', '/vendor/wallet', S.v2.token);
  assert.equal(wallet.walletBalance, 135000, 'vendor received 100% across both milestones');
});

// ── 14. Trust score EWMA ─────────────────────────────────────────────────────────────────
test('a 5-star rating updates trust with the EWMA (0.7 × 3.5 + 0.3 × 5 = 3.95)', async () => {
  const res = await ok('POST', `/orders/${S.order._id}/rate`, S.buyer, { rating: 5, review: 'Great print quality' });
  assert.equal(res.trustBefore, 3.5);
  assert.equal(res.trustAfter, 3.95);
  const again = await api('POST', `/orders/${S.order._id}/rate`, S.buyer, { rating: 1 });
  assert.equal(again.status, 409, 'an order can only be rated once');
  const vendor = await User.findById(S.v2.id);
  assert.equal(vendor.trustScore, 3.95);
  assert.equal(vendor.ratingCount, 1);
});

// ── 15. Dispute flow with politeness CRM and split settlement ───────────────────────────
test('a dispute freezes escrow, softens hostile wording and is settled by the admin', async () => {
  const rfq2 = (await ok('POST', '/rfqs', S.buyer, { title: 'E2E dispute tees', designSpecs: SPECS })).rfq;
  const bid = await ok('POST', `/rfqs/${rfq2._id}/bids`, S.v1.token, { price: 50000, leadTimeDays: 8 });
  const order = (await ok('POST', `/rfqs/${rfq2._id}/bids/${bid.myBid.bidId}/accept`, S.buyer)).order;
  await ok('POST', `/orders/${order._id}/pay`, S.buyer, CARD_OK);
  for (const status of ['MATERIAL_SOURCED', 'IN_PRODUCTION', 'READY_FOR_INSPECTION']) {
    await ok('PATCH', `/orders/${order._id}/production`, S.v1.token, { status });
  }

  const adminAlert = waitFor(await connect(S.admin), 'dispute:new', (p) => p.orderId === order._id);
  const disputed = await ok('POST', `/orders/${order._id}/dispute`, S.buyer, {
    category: 'DESIGN_DEVIATION',
    desiredResolution: 'PARTIAL_REFUND',
    description: 'This is a SCAM!!!! The logo is printed 3cm too low on 20 of the shirts, useless for our event.',
  });
  assert.equal(disputed.order.escrowStatus, 'FROZEN');
  assert.equal(disputed.order.orderStatus, 'DISPUTED');
  const alert = await adminAlert;
  assert.equal(alert.toneFlagged, true);

  const vendorView = (await ok('GET', `/orders/${order._id}`, S.v1.token)).order;
  assert.equal(vendorView.dispute.description, undefined, 'vendor never sees the raw statement');
  const notice = vendorView.disputeNotes.find((n) => n.template === 'VENDOR_NOTIFICATION');
  assert.ok(notice, 'vendor receives a templated notice');
  assert.ok(!/scam|useless/i.test(notice.message), 'hostile words are softened for the vendor');
  assert.ok(!vendorView.disputeNotes.some((n) => n.template === 'ADMIN_CASE_SUMMARY'), 'admin summary is private');

  const frozenVerify = await api('POST', `/orders/${order._id}/o2o/verify`, S.v1.token, { pin: '123456' });
  assert.equal(frozenVerify.status, 423, 'no payout while escrow is frozen');

  await ok('POST', `/orders/${order._id}/dispute/notes`, S.v1.token, { message: 'We can reprint the 20 affected shirts within 3 days.' });

  const resolved = await ok('POST', `/admin/orders/${order._id}/resolve`, S.admin, { resolution: 'SPLIT', vendorPercent: 60, notes: 'Partial deviation confirmed.' });
  assert.equal(resolved.order.escrowStatus, 'SPLIT_SETTLED');
  assert.equal(resolved.order.dispute.vendorAmount, 21000); // 60% of the held 35,000
  assert.equal(resolved.order.dispute.buyerAmount, 14000);

  const buyer = await ok('GET', '/auth/me', S.buyer);
  assert.equal(buyer.user.walletBalance, 14000);
  const v1Wallet = await ok('GET', '/vendor/wallet', S.v1.token);
  assert.equal(v1Wallet.walletBalance, 15000 + 21000, '30% advance + 60% of the remainder');
});

// ── 16. Expiry scheduler ─────────────────────────────────────────────────────────────────
test('an auction past its deadline closes automatically (EXPIRED without bids)', async () => {
  const rfq3 = (await ok('POST', '/rfqs', S.buyer, { title: 'E2E expiring tees', designSpecs: SPECS })).rfq;
  await RFQ.updateOne({ _id: rfq3._id }, { $set: { expiresAt: new Date(Date.now() - 1000) } });
  await closeExpiredAuctions();
  const after = await ok('GET', `/rfqs/${rfq3._id}`, S.buyer);
  assert.equal(after.rfq.status, 'EXPIRED');
  const late = await api('POST', `/rfqs/${rfq3._id}/bids`, S.v1.token, { price: 1000, leadTimeDays: 5 });
  assert.equal(late.status, 409);
});

// ── 17. Analytics ────────────────────────────────────────────────────────────────────────
test('admin analytics reflect the run', async () => {
  const a = await ok('GET', '/admin/analytics', S.admin);
  assert.equal(a.escrow.gmv, 185000);
  assert.equal(a.escrow.releasedToVendors, 135000 + 15000 + 21000);
  assert.equal(a.escrow.refundedToBuyers, 14000);
  assert.equal(a.rfqs.AWARDED, 2);
  assert.equal(a.rfqs.EXPIRED, 1);
  assert.ok(a.auctionEfficiency.highVarianceRfqCount >= 1);
  assert.ok(a.auctionEfficiency.avgPriceDiscoverySavingsPct > 0);
  assert.equal(a.quality.ratingsCount, 1);
});

// ── 18. Forgot / reset password ──────────────────────────────────────────────────────────
test('password reset: generic answer, e-mailed single-use link, old sessions signed out', async () => {
  const generic = await ok('POST', '/auth/forgot-password', null, { email: 'nobody@e2e.test' });
  const real = await ok('POST', '/auth/forgot-password', null, { email: 'buyer@e2e.test' });
  assert.equal(real.message, generic.message, 'unknown and known e-mails must get the same answer');

  let mail = null;
  for (let i = 0; i < 50 && !(mail && mail.to === 'buyer@e2e.test'); i += 1) {
    await sleep(20);
    mail = getLastTestMessage();
  }
  assert.ok(mail && mail.to === 'buyer@e2e.test', 'a reset e-mail was prepared for the buyer');
  const match = mail.text.match(/(http:\/\/localhost:5173\/reset-password\?token=)(\S+)/);
  assert.ok(match, 'the e-mail links to the web app reset page');
  assert.ok(mail.html.includes('Reset my password'));
  const token = decodeURIComponent(match[2]);

  const weak = await api('POST', '/auth/reset-password', null, { token, password: 'short' });
  assert.equal(weak.status, 400);
  const forged = await api('POST', '/auth/reset-password', null, { token: `${token}x`, password: 'NewBuyer123' });
  assert.equal(forged.status, 400);
  assert.equal(forged.body.code, 'RESET_TOKEN_INVALID');
  const asLogin = await api('GET', '/auth/me', token);
  assert.equal(asLogin.status, 401, 'a reset token is not a login token');

  assert.equal((await api('GET', '/auth/me', S.buyer)).status, 200, 'the old session works before the reset');
  await ok('POST', '/auth/reset-password', null, { token, password: 'NewBuyer123' });

  const oldSession = await api('GET', '/auth/me', S.buyer);
  assert.equal(oldSession.status, 401);
  assert.equal(oldSession.body.code, 'PASSWORD_CHANGED');
  const reused = await api('POST', '/auth/reset-password', null, { token, password: 'Another123' });
  assert.equal(reused.status, 400);
  assert.equal(reused.body.code, 'RESET_TOKEN_INVALID', 'a reset link works only once');

  assert.equal((await api('POST', '/auth/login', null, { email: 'buyer@e2e.test', password: 'Buyer1234' })).status, 401);
  const login = await ok('POST', '/auth/login', null, { email: 'buyer@e2e.test', password: 'NewBuyer123' });

  await sleep(1100); // the next token must be issued in a later second than this login's
  const changed = await ok('PATCH', '/auth/me/password', login.token, { currentPassword: 'NewBuyer123', newPassword: 'Changed1234' });
  assert.ok(changed.token, 'changing the password returns a fresh token');
  assert.equal((await api('GET', '/auth/me', login.token)).status, 401, 'other sessions are signed out');
  assert.equal((await api('GET', '/auth/me', changed.token)).status, 200, 'the current session stays logged in');
});
