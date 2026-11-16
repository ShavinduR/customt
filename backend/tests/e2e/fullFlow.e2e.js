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
const { User, RFQ, Bid, Order, Message, Post } = require('../../models');
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

/**
 * Vendors can no longer self-register (KYB onboarding). The auction tests need ready vendor accounts, so
 * this registers a buyer through the API and converts it in the database exactly like a pre-KYB vendor
 * account kept by the migration (unverified until an admin verifies it in test 3).
 * The KYB flow itself is tested end to end in test 22.
 */
async function registerVendor(name, email, capabilities, maxCapacity) {
  const res = await ok('POST', '/auth/register', null, { name, email, password: 'Vendor1234', phone: '+94770000000' });
  const id = res.user._id || res.user.id;
  await User.updateOne(
    { _id: id },
    {
      $set: {
        role: 'vendor',
        companyName: `${name} Prints`,
        businessRegNo: `PV-${Math.floor(Math.random() * 1e6)}`,
        capabilities,
        maxCapacity,
        licenseExpiryDate: new Date(inYears(1)),
        isVerified: false,
        vendorStatus: 'APPROVED',
      },
    }
  );
  return { token: res.token, id };
}

// ── Lifecycle ─────────────────────────────────────────────────────────────────────────────
test.before(async () => {
  runtime = await start();
  if (!runtime.server.listening) await new Promise((r) => runtime.server.once('listening', r));
  BASE = `http://127.0.0.1:${runtime.server.address().port}`;
  await Promise.all([User, RFQ, Bid, Order, Message, Post].map((m) => m.deleteMany({})));
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

// ── 18. Buyer-vendor chat with contact filtering ─────────────────────────────────────────
test('chat: contact details are masked before delivery; admins see originals; outsiders are refused', async () => {
  const orderId = S.order._id;
  const sAdmin = await connect(S.admin);

  const toBuyer = waitFor(S.sBuyer, 'chat:message', (p) => p.orderId === orderId);
  const toAdmin = waitFor(sAdmin, 'chat:monitor', (p) => p.orderId === orderId);
  const flaggedAlert = waitFor(sAdmin, 'chat:flagged', (p) => p.orderId === orderId);
  const raw = 'Thanks! WhatsApp me on 077 123 4567 or email kasun.silva@gmail.com for faster replies';
  const sent = await emitAck(S.sV2, 'chat:send', { orderId, body: raw });
  assert.equal(sent.ok, true, JSON.stringify(sent));
  assert.deepEqual([...sent.result.blocked].sort(), ['app', 'email', 'phone']);
  assert.ok(!/4567|kasun|gmail|whatsapp/i.test(sent.result.message.body), sent.result.message.body);
  assert.ok(sent.result.message.body.includes('[CONTACT BLOCKED]'));

  const delivered = await toBuyer;
  assert.equal(delivered.message.body, sent.result.message.body, 'the buyer receives the filtered text');
  assert.equal(delivered.message.originalBody, undefined, 'the buyer never receives the original');
  const monitored = await toAdmin;
  assert.equal(monitored.message.originalBody, raw, 'admins receive the original for monitoring');
  assert.equal((await flaggedAlert).orderCode, S.order.orderCode);

  await ok('POST', `/orders/${orderId}/messages`, S.buyer, { body: 'Great, the shirts look perfect. Thank you!' });

  const buyerView = await ok('GET', `/orders/${orderId}/messages`, S.buyer);
  assert.equal(buyerView.messages.length, 2);
  assert.equal(buyerView.unread, 1, "the vendor's message is unread for the buyer");
  assert.ok(buyerView.messages.every((m) => m.originalBody === undefined && m.flags === undefined));
  assert.equal(buyerView.canSend, true);

  const seen = waitFor(S.sV2, 'chat:read', (p) => p.orderId === orderId);
  await ok('POST', `/orders/${orderId}/messages/read`, S.buyer);
  await seen;
  assert.equal((await ok('GET', `/orders/${orderId}/messages`, S.buyer)).unread, 0);

  const outsider = await api('GET', `/orders/${orderId}/messages`, S.v1.token);
  assert.equal(outsider.status, 403, 'a vendor who lost the auction cannot read the chat');
  const outsiderSend = await api('POST', `/orders/${orderId}/messages`, S.v1.token, { body: 'hello' });
  assert.equal(outsiderSend.status, 403);

  const adminView = await ok('GET', `/orders/${orderId}/messages`, S.admin);
  assert.equal(adminView.canSend, false);
  assert.equal(adminView.messages[0].originalBody, raw);
  assert.deepEqual([...adminView.messages[0].flags].sort(), ['app', 'email', 'phone']);
  const adminPost = await emitAck(sAdmin, 'chat:send', { orderId, body: 'hi' });
  assert.equal(adminPost.ok, false, 'admins monitor but do not post');

  const conversations = await ok('GET', '/admin/conversations?flagged=true', S.admin);
  const row = conversations.items.find((c) => c.orderId === orderId);
  assert.ok(row, 'the flagged conversation is listed for admins');
  assert.equal(row.flaggedMessages, 1);
  assert.equal(row.messages, 2);

  const asBuyer = (await ok('GET', `/orders/${orderId}`, S.buyer)).order;
  assert.equal(asBuyer.vendorId.phone, undefined, "buyers don't receive the vendor's phone");
  assert.equal(asBuyer.vendorId.email, undefined);
  const asVendor = (await ok('GET', `/orders/${orderId}`, S.v2.token)).order;
  assert.equal(asVendor.buyerId.phone, undefined, "vendors don't receive the buyer's phone");
  assert.equal(asVendor.buyerId.email, undefined);
  const asAdmin = (await ok('GET', `/orders/${orderId}`, S.admin)).order;
  assert.ok(asAdmin.buyerId.email && asAdmin.vendorId.email, 'admins still see contact details');

  const stored = await Message.findOne({ orderId, flagged: true }).select('+originalBody');
  assert.equal(stored.originalBody, raw, 'the original is kept in MongoDB for audit');
});

// ── 19. Forgot / reset password ──────────────────────────────────────────────────────────
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

// ── 20. Security hardening ───────────────────────────────────────────────────────────────
test('security: contact details are masked outside chat, self-dealing and impossible lead times are blocked', async () => {
  // A buyer account registered with the same phone number as vendor Alpha.
  const self = await ok('POST', '/auth/register', null, { role: 'buyer', name: 'Same Person', email: 'self@e2e.test', password: 'Buyer1234', phone: '+94 77 000 0000' });

  const badName = await api('POST', '/auth/register', null, { role: 'buyer', name: 'Call 0771234567', email: 'n@e2e.test', password: 'Buyer1234', phone: '+94771111111' });
  assert.equal(badName.status, 400);
  assert.equal(badName.body.code, 'CONTACT_INFO_IN_NAME');

  const external = await api('POST', '/rfqs', self.token, {
    title: 'Pixel test',
    designSpecs: { ...SPECS, customText: undefined, textLayers: [], imageLayers: [{ id: 'i1', side: 'front', url: 'https://evil.example/pixel.png', x: 50, y: 50, scale: 0.5 }] },
  });
  assert.equal(external.status, 400, 'design images must be CustomT uploads');

  const rfq = (await ok('POST', '/rfqs', self.token, { title: 'Self-dealing tees', description: 'WhatsApp me on 077 123 4567 for details', designSpecs: SPECS })).rfq;
  assert.ok(!/4567|whatsapp/i.test(rfq.description), `description is masked: ${rfq.description}`);

  const tooFast = await api('POST', `/rfqs/${rfq._id}/bids`, S.v1.token, { price: 50000, leadTimeDays: 1 });
  assert.equal(tooFast.status, 400);
  assert.equal(tooFast.body.code, 'LEAD_TIME_TOO_SHORT');

  const bid = await ok('POST', `/rfqs/${rfq._id}/bids`, S.v1.token, { price: 50000, leadTimeDays: 8, notes: 'Call me on 0771234567' });
  const board = await ok('GET', `/rfqs/${rfq._id}`, self.token);
  assert.ok(board.leaderboard[0].notes.includes('[CONTACT BLOCKED]'), 'bid notes shown to the buyer are masked');

  const accept = await api('POST', `/rfqs/${rfq._id}/bids/${bid.myBid.bidId}/accept`, self.token);
  assert.equal(accept.status, 403);
  assert.equal(accept.body.code, 'SELF_DEALING');

  // Live sockets close when the password changes.
  const socket = await connect(self.token);
  const closed = new Promise((resolve) => socket.once('disconnect', resolve));
  await sleep(1100);
  await ok('PATCH', '/auth/me/password', self.token, { currentPassword: 'Buyer1234', newPassword: 'Changed1234' });
  await Promise.race([closed, sleep(3000).then(() => assert.fail('socket was not disconnected after the password change'))]);

  // O2O PINs are stored encrypted.
  const stored = await Order.findOne({ o2oPin: { $exists: true } }).select('+o2oPin').lean();
  if (stored) assert.ok(!/^\d{6}$/.test(stored.o2oPin), 'O2O PIN is not stored in plain text');
});

// ── 21. Phase 5: Global Feed, micro-storefronts and Direct RFQs ──────────────────────────
test('phase 5: vendor posts are filtered and validated, the feed paginates, Direct RFQs stay exclusive and use escrow', async () => {
  // Photos must be the posting vendor's own uploads (the uploader id is part of the filename).
  const img = (vendorId) => `/uploads/logos/${vendorId}-1731480000000-a1b2c3d4.jpg`;
  const buyer = (await ok('POST', '/auth/register', null, { role: 'buyer', name: 'Feed Buyer', email: 'feed@e2e.test', password: 'Buyer1234', phone: '+94775550000' })).token;
  const premium = {
    postType: 'PREMIUM_CATALOG',
    title: 'Heavyweight crew neck',
    postDescription: 'Pre-shrunk 220 GSM. WhatsApp me on 077 123 4567 or email alpha@prints.lk for bulk deals',
    images: [img(S.v1.id)],
    garmentType: 'Crew Neck',
    printTypes: ['Screen Printing'],
    sizeChart: [{ size: 'M', chestCm: 104, lengthCm: 72 }, { size: 'L', chestCm: 110, lengthCm: 74 }],
    fabricSpecs: { fabric: '100% Cotton', gsm: 220 },
  };

  // Publishing rules.
  assert.equal((await api('POST', '/posts', buyer, premium)).status, 403, 'buyers cannot post');
  const pendingVendor = await registerVendor('Echo', 'v5@e2e.test', ['DTF'], 200);
  const unverified = await api('POST', '/posts', pendingVendor.token, premium);
  assert.equal(unverified.status, 403);
  assert.equal(unverified.body.code, 'PERA_QUALIFICATION_LOCK', 'unverified vendors cannot post');

  const noChart = await api('POST', '/posts', S.v1.token, { ...premium, sizeChart: [], fabricSpecs: undefined });
  assert.equal(noChart.status, 400);
  assert.ok(noChart.body.details.some((d) => /size chart/.test(d)) && noChart.body.details.some((d) => /fabric specs/.test(d)), JSON.stringify(noChart.body));

  const stolen = await api('POST', '/posts', S.v1.token, { ...premium, images: [img(S.v2.id)] });
  assert.equal(stolen.status, 400, "a vendor can't publish another user's upload");
  const created = await ok('POST', '/posts', S.v1.token, premium);
  assert.ok(created.post.postDescription.includes('[CONTACT BLOCKED]'));
  assert.ok(!/4567|whatsapp|@/i.test(created.post.postDescription), created.post.postDescription);
  assert.ok(created.blocked.includes('phone') && created.blocked.includes('email'));
  const stored = await Post.findById(created.post._id).lean();
  assert.ok(!/4567|@/.test(stored.postDescription), 'the unfiltered text never reaches MongoDB');

  for (const title of ['Idea one', 'Idea two', 'Idea three']) {
    await ok('POST', '/posts', S.v2.token, { postType: 'INSPIRATION', title, images: [img(S.v2.id)] });
  }
  await ok('POST', '/posts', S.v4.token, { postType: 'CLEARANCE', title: 'Navy polos', images: [img(S.v4.id)], garmentType: 'Polo', clearance: { availableQuantity: 80, unitPrice: 600 } });

  // Global Feed: newest first, cursor pagination without duplicates, no vendor contact details.
  const seen = [];
  let cursor = null;
  do {
    const page = await ok('GET', `/posts?limit=2${cursor ? `&cursor=${cursor}` : ''}`, buyer);
    assert.ok(page.items.length <= 2);
    seen.push(...page.items);
    cursor = page.nextCursor;
  } while (cursor);
  assert.equal(seen.length, 5);
  assert.equal(new Set(seen.map((p) => p._id)).size, 5, 'no post appears twice across pages');
  assert.equal(seen[0].title, 'Navy polos', 'newest first');
  for (const p of seen) {
    assert.equal(p.vendor.phone, undefined);
    assert.equal(p.vendor.email, undefined);
    assert.equal(p.contactFlags, undefined, 'moderation flags are not shown to buyers');
  }
  const onlyClearance = await ok('GET', '/posts?type=CLEARANCE', buyer);
  assert.deepEqual(onlyClearance.items.map((p) => p.postType), ['CLEARANCE']);
  assert.equal((await api('GET', '/posts?cursor=garbage', buyer)).status, 400);

  // Micro-storefront.
  const store = await ok('GET', `/vendors/${S.v1.id}/storefront`, buyer);
  assert.equal(store.vendor.companyName, 'Alpha Prints');
  assert.equal(store.vendor.phone, undefined);
  assert.equal(store.tabs.PREMIUM_CATALOG, 1);
  assert.equal(store.tab, 'PREMIUM_CATALOG');
  assert.equal(store.items[0].sizeChart.length, 2);
  assert.equal(store.canRequestDirectQuote, true);
  assert.equal((await api('GET', `/vendors/${pendingVendor.id}/storefront`, buyer)).status, 404, 'unverified vendors have no public storefront');

  const bio = await ok('PATCH', '/vendor/storefront', S.v1.token, { bio: 'Family printers since 1998. Call 0771234567', coverUrl: img(S.v1.id) });
  assert.ok(bio.storefront.bio.includes('[CONTACT BLOCKED]'));

  // Direct RFQ: exclusive to Alpha, refused for a vendor without the capability.
  const wrongVendor = await api('POST', '/rfqs', buyer, { title: 'Direct to Charlie', designSpecs: SPECS, directVendorId: S.v3.id });
  assert.equal(wrongVendor.status, 422);
  assert.equal(wrongVendor.body.code, 'PERA_DIRECT_VENDOR_LOCK');

  const preview = await ok('POST', '/rfqs/preview', buyer, { designSpecs: SPECS, directVendorId: S.v1.id });
  assert.equal(preview.preview.directVendor.eligible, true);
  assert.equal(preview.preview.eligibleVendorCount, 1);

  const direct = (await ok('POST', '/rfqs', buyer, { title: 'Direct quote: crew necks', designSpecs: SPECS, directVendorId: S.v1.id })).rfq;
  assert.equal(String(direct.directVendorId), S.v1.id);

  const deltaFeed = await ok('GET', '/vendor/rfqs', S.v4.token);
  assert.ok(!deltaFeed.items.some((r) => r._id === direct._id), "another vendor's feed never lists a Direct RFQ");
  const peek = await api('GET', `/rfqs/${direct._id}`, S.v4.token);
  assert.equal(peek.status, 403);
  assert.equal(peek.body.code, 'DIRECT_RFQ_OTHER_VENDOR');
  const intrude = await api('POST', `/rfqs/${direct._id}/bids`, S.v4.token, { price: 40000, leadTimeDays: 8 });
  assert.equal(intrude.status, 403);
  assert.equal(intrude.body.code, 'DIRECT_RFQ_OTHER_VENDOR');

  const alphaFeed = await ok('GET', '/vendor/rfqs', S.v1.token);
  assert.ok(alphaFeed.items.some((r) => r._id === direct._id && r.isDirect), 'the chosen vendor sees it, marked as direct');

  // The Direct RFQ ends in the normal escrow flow.
  const bid = await ok('POST', `/rfqs/${direct._id}/bids`, S.v1.token, { price: 60000, leadTimeDays: 8 });
  const order = (await ok('POST', `/rfqs/${direct._id}/bids/${bid.myBid.bidId}/accept`, buyer)).order;
  assert.equal(order.orderStatus, 'PENDING_ESCROW');
  const paid = (await ok('POST', `/orders/${order._id}/pay`, buyer, CARD_OK)).order;
  assert.equal(paid.escrowStatus, 'ESCROW_LOCKED');
  assert.equal(paid.escrowHeld, 60000);

  // Archiving removes a post from the feed; only its owner (or an admin) can do it.
  assert.equal((await api('DELETE', `/posts/${created.post._id}`, S.v2.token)).status, 403);
  await ok('DELETE', `/posts/${created.post._id}`, S.v1.token);
  const after = await ok('GET', '/posts?type=PREMIUM_CATALOG', buyer);
  assert.ok(!after.items.some((p) => p._id === created.post._id));
});

// ── 22. KYB onboarding: buyer applies, admin reviews, buyer becomes a vendor ─────────────
test('KYB: buyer-only sign-up, private document upload, admin review with changes requested, approval upgrades the role', async () => {
  const sharp = require('sharp');
  const { VendorApplication, KybAccessLog } = require('../../models');
  const day = 86400000;
  const isoDaysAgo = (n) => new Date(Date.now() - n * day).toISOString().slice(0, 10);
  const png = (hex) => sharp({ create: { width: 24, height: 16, channels: 3, background: hex } }).png().toBuffer();
  const pdf = (tag) => Buffer.from(`%PDF-1.4\n% ${tag}\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n`, 'latin1');
  const upload = async (token, type, buffer, { name = 'file.png', mime = 'image/png', issuedOn } = {}) => {
    const form = new FormData();
    form.append('type', type);
    if (issuedOn) form.append('issuedOn', issuedOn);
    form.append('file', new Blob([buffer], { type: mime }), name);
    const res = await fetch(`${BASE}/api/kyb/application/documents`, { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: form });
    return { status: res.status, body: await res.json().catch(() => ({})) };
  };

  // Sign-up is buyer-only.
  const asVendor = await api('POST', '/auth/register', null, { role: 'vendor', name: 'Wannabe', email: 'wannabe@e2e.test', password: 'Vendor1234', phone: '+94771112222' });
  assert.equal(asVendor.status, 400);
  assert.equal(asVendor.body.code, 'REGISTER_BUYER_ONLY');
  const applicant = await ok('POST', '/auth/register', null, { name: 'Nuwan Perera', email: 'kyb@e2e.test', password: 'Buyer1234', phone: '+94771113333' });
  const token = applicant.token;
  const userId = applicant.user._id || applicant.user.id;
  const other = (await ok('POST', '/auth/register', null, { name: 'Other Buyer', email: 'kyb2@e2e.test', password: 'Buyer1234', phone: '+94771114444' })).token;

  // Postman-style escalation attempts change nothing.
  await ok('PATCH', '/auth/me', token, { role: 'vendor', isVerified: true, vendorStatus: 'APPROVED' });
  const me = await ok('GET', '/auth/me', token);
  assert.equal(me.user.role, 'buyer');
  assert.notEqual(me.user.vendorStatus, 'APPROVED');

  // Draft: validation, NIC never stored in full.
  const bad = await api('PUT', '/kyb/application', token, { business: { legalName: 'Call 0771234567 Prints' }, owner: { nic: '12345' } });
  assert.equal(bad.status, 400);
  assert.ok(bad.body.details.some((d) => /phone numbers/.test(d)) && bad.body.details.some((d) => /NIC must be/.test(d)), JSON.stringify(bad.body));
  const business = {
    legalName: 'Nuwan Garments (Pvt) Ltd',
    businessRegNo: 'PV 99881'.replace(' ', ''),
    address: { line1: '45 Galle Road', city: 'Moratuwa', district: 'Colombo' },
    capabilities: ['Screen Printing', 'DTF'],
    maxCapacity: 800,
    licenseExpiryDate: inYears(1),
  };
  const draft = (await ok('PUT', '/kyb/application', token, { business, owner: { fullName: 'Nuwan Perera', nic: '881234567V' } })).application;
  assert.equal(draft.status, 'DRAFT');
  assert.equal(draft.owner.nicLast4, '4567');
  const stored = await VendorApplication.findById(draft._id).select('+owner.nicHash').lean();
  assert.match(stored.owner.nicHash, /^[a-f0-9]{64}$/);
  assert.ok(!JSON.stringify(stored).includes('881234567'), 'the full NIC is not stored anywhere in the application');

  // Uploads: content is checked, not the browser's claim.
  const fake = await upload(token, 'BR_COPY', Buffer.from('<script>alert(1)</script>'), { name: 'br.png', mime: 'image/png' });
  assert.equal(fake.status, 400);
  assert.equal(fake.body.code, 'KYB_FILE_TYPE');
  const scripted = await upload(token, 'BR_COPY', pdf('x /JavaScript (app.alert(1))'), { name: 'br.pdf', mime: 'application/pdf' });
  assert.equal(scripted.body.code, 'KYB_PDF_REJECTED');

  const incomplete = await api('POST', '/kyb/application/submit', token, { consent: true });
  assert.equal(incomplete.status, 400);
  assert.equal(incomplete.body.code, 'KYB_INCOMPLETE');

  let view;
  view = (await upload(token, 'BR_COPY', pdf('br'), { name: 'br.pdf', mime: 'application/pdf' })).body.application;
  view = (await upload(token, 'NIC_FRONT', await png('#112233'), { name: 'nic-front.png' })).body.application;
  view = (await upload(token, 'NIC_BACK', await png('#223344'))).body.application;
  view = (await upload(token, 'UTILITY_BILL', await png('#334455'), { issuedOn: isoDaysAgo(20) })).body.application;
  for (const [i, ago] of [10, 45, 80].entries()) {
    // eslint-disable-next-line no-await-in-loop
    view = (await upload(token, 'PAST_INVOICE', pdf(`invoice-${i}`), { name: `inv${i}.pdf`, mime: 'application/pdf', issuedOn: isoDaysAgo(ago) })).body.application;
  }
  assert.equal(view.documents.length, 7);
  assert.deepEqual(view.problems, []);
  assert.ok(!JSON.stringify(view).includes('storageKey') && !JSON.stringify(view).includes('kyb/'), 'storage locations never reach the client');

  // Nobody else can see or touch this application (no ids in applicant routes).
  const otherView = await ok('GET', '/kyb/application', other);
  assert.equal(otherView.application, null);
  assert.equal((await api('GET', `/admin/vendor-applications/${draft._id}`, token)).status, 403, 'applicants cannot use admin routes');

  assert.equal((await api('POST', '/kyb/application/submit', token, {})).body.code, 'KYB_CONSENT_REQUIRED');
  const submitted = (await ok('POST', '/kyb/application/submit', token, { consent: true })).application;
  assert.equal(submitted.status, 'PENDING_APPROVAL');
  assert.equal((await api('PUT', '/kyb/application', token, { business: { legalName: 'Changed' } })).body.code, 'KYB_LOCKED', 'locked while under review');

  // Admin review: queue, logged document access, request changes.
  const queue = await ok('GET', '/admin/vendor-applications', S.admin);
  assert.ok(queue.items.some((a) => a._id === draft._id));
  const full = (await ok('GET', `/admin/vendor-applications/${draft._id}`, S.admin)).application;
  const brDoc = full.documents.find((d) => d.type === 'BR_COPY');
  const file = await fetch(`${BASE}/api/admin/vendor-applications/${draft._id}/documents/${brDoc._id}`, { headers: { authorization: `Bearer ${S.admin}` } });
  assert.equal(file.status, 200);
  assert.equal(file.headers.get('content-type'), 'application/pdf');
  assert.match(file.headers.get('cache-control'), /no-store/);
  assert.ok((await file.text()).startsWith('%PDF-'));
  assert.equal(await KybAccessLog.countDocuments({ applicationId: draft._id, action: 'VIEW' }), 1, 'the view was logged');
  assert.equal((await api('GET', `/admin/vendor-applications/${draft._id}/documents/${brDoc._id}`, token)).status, 403);

  const notAllAccepted = await api('POST', `/admin/vendor-applications/${draft._id}/decision`, S.admin, { outcome: 'APPROVED' });
  assert.equal(notAllAccepted.body.code, 'KYB_DOCUMENTS_NOT_ACCEPTED', 'approval needs every document accepted');
  const bill = full.documents.find((d) => d.type === 'UTILITY_BILL');
  await ok('POST', `/admin/vendor-applications/${draft._id}/documents/${bill._id}/review`, S.admin, { status: 'REJECTED', reason: 'The address on the bill is not readable' });
  const changes = (await ok('POST', `/admin/vendor-applications/${draft._id}/decision`, S.admin, { outcome: 'CHANGES_REQUESTED', notes: 'Please upload a clearer bill' })).application;
  assert.equal(changes.status, 'CHANGES_REQUESTED');

  // Applicant sees the reason, replaces the bill and resubmits.
  const mine = (await ok('GET', '/kyb/application', token)).application;
  assert.equal(mine.documents.find((d) => d.type === 'UTILITY_BILL').review.reason, 'The address on the bill is not readable');
  await upload(token, 'UTILITY_BILL', await png('#556677'), { issuedOn: isoDaysAgo(5) });
  assert.equal((await ok('POST', '/kyb/application/submit', token, { consent: true })).application.submissionCount, 2);

  // Approve: accept every document, then decide. The role changes only here.
  const again = (await ok('GET', `/admin/vendor-applications/${draft._id}`, S.admin)).application;
  for (const d of again.documents) {
    // eslint-disable-next-line no-await-in-loop
    await ok('POST', `/admin/vendor-applications/${draft._id}/documents/${d._id}/review`, S.admin, { status: 'ACCEPTED' });
  }
  const approved = (await ok('POST', `/admin/vendor-applications/${draft._id}/decision`, S.admin, { outcome: 'APPROVED', notes: 'Verified' })).application;
  assert.equal(approved.status, 'APPROVED');
  const twice = await api('POST', `/admin/vendor-applications/${draft._id}/decision`, S.admin, { outcome: 'REJECTED', notes: 'Too late now' });
  assert.equal(twice.body.code, 'KYB_INVALID_TRANSITION', 'a decided application cannot be decided again');

  const vendor = await User.findById(userId);
  assert.equal(vendor.role, 'vendor');
  assert.equal(vendor.vendorStatus, 'APPROVED');
  assert.equal(vendor.isVerified, true);
  assert.equal(vendor.companyName, 'Nuwan Garments (Pvt) Ltd');
  assert.deepEqual(vendor.qualificationIssues(), []);
  // The same token now works for vendor features (roles are read from the database on every request).
  const post = await api('POST', '/posts', token, { postType: 'INSPIRATION', title: 'Our first post', images: [`/uploads/logos/${userId}-1731480000000-a1b2c3d4.jpg`] });
  assert.equal(post.status, 201, JSON.stringify(post.body));
  assert.equal((await api('PUT', '/kyb/application', token, { business: {} })).status, 403, 'vendors cannot reapply');

  // Rejection starts a cooling-off period.
  const rejectedUser = await ok('POST', '/auth/register', null, { name: 'Reject Me', email: 'kyb3@e2e.test', password: 'Buyer1234', phone: '+94771115555' });
  const rejApp = (await ok('PUT', '/kyb/application', rejectedUser.token, { business: { legalName: 'Shady Shirts' } })).application;
  await VendorApplication.updateOne({ _id: rejApp._id }, { $set: { status: 'PENDING_APPROVAL' } });
  await ok('POST', `/admin/vendor-applications/${rejApp._id}/decision`, S.admin, { outcome: 'REJECTED', notes: 'Documents do not match' });
  const cooled = await api('PUT', '/kyb/application', rejectedUser.token, { business: { legalName: 'Shady Shirts 2' } });
  assert.equal(cooled.status, 409);
  assert.equal(cooled.body.code, 'KYB_COOLDOWN');
});

// ── 23. TEMPORARY KYB migration route (remove together with routes/tempMigrationRoutes.js) ──
test('temporary migration route: hidden without the secret, idempotent with it', async () => {
  const hidden = await api('GET', '/run-kyb-migration?secret=wrong');
  assert.equal(hidden.status, 404, 'a wrong secret looks like a missing route');

  await User.updateOne({ email: 'v1@e2e.test' }, { $unset: { vendorStatus: 1 } }); // simulate a pre-KYB vendor
  const dry = await ok('GET', '/run-kyb-migration?secret=migrate123&dryRun=1');
  assert.equal(dry.applied, false);
  assert.ok(dry.vendorsToApprove >= 1);
  assert.equal((await User.findOne({ email: 'v1@e2e.test' }).lean()).vendorStatus, undefined, 'a dry run changes nothing');

  const run = await ok('GET', '/run-kyb-migration?secret=migrate123');
  assert.equal(run.applied, true);
  assert.ok(run.vendorsUpdated >= 1);
  const v1 = await User.findOne({ email: 'v1@e2e.test' });
  assert.equal(v1.vendorStatus, 'APPROVED');
  assert.equal(v1.role, 'vendor', 'role is untouched');

  const again = await ok('GET', '/run-kyb-migration?secret=migrate123');
  assert.equal(again.vendorsUpdated + again.buyersUpdated, 0, 'running it twice changes nothing');
});
