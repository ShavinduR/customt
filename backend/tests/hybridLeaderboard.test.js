const test = require('node:test');
const assert = require('node:assert/strict');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'unit-test-secret-unit-test-secret-1234';

const { buildLeaderboard, buildVendorBidView, isKybVerified } = require('../services/auctionService');
const { scoreBids } = require('../services/scoringEngine');

const at = (s) => new Date(`2026-11-20T10:00:${String(s).padStart(2, '0')}Z`);
const vendor = (id, over = {}) => ({ _id: id, name: `Owner ${id}`, companyName: `Shop ${id}`, trustScore: 4, ratingCount: 3, skillBadges: [], vendorStatus: 'APPROVED', isVerified: true, phone: '+94770000000', email: `${id}@x.lk`, ...over });
const bid = (id, v, price, leadTimeDays, trust, s) => ({
  _id: id,
  vendorId: v,
  vendorName: v.name,
  companyName: v.companyName,
  price,
  unitPrice: price / 100,
  leadTimeDays,
  notes: '',
  status: 'ACTIVE',
  revisionCount: 0,
  trustScoreSnapshot: trust,
  lastSubmittedAt: at(s),
  rank: null,
});

const BIDS = [
  bid('b1', vendor('v1'), 150000, 10, 3.5, 1),
  bid('b2', vendor('v2', { trustScore: 4.6, ratingCount: 12 }), 135000, 7, 4.6, 2),
  bid('b3', vendor('v3', { vendorStatus: 'NONE' }), 120000, 14, 2.5, 3),
  bid('b4', vendor('v4', { companyName: '' }), 300000, 12, 3.5, 4),
];
const STATS = new Map([
  ['v2', { totalOrders: 14, completedOrders: 12, refundedOrders: 1, activeOrders: 1, completionRate: 0.923 }],
  ['v1', { totalOrders: 2, completedOrders: 1, refundedOrders: 0, activeOrders: 1, completionRate: 1 }],
]);

test('the buyer leaderboard returns every bid, ranked by the unchanged multi-attribute score', () => {
  const board = buildLeaderboard(BIDS, STATS);
  assert.equal(board.length, BIDS.length, 'no truncation');
  const engine = scoreBids(BIDS.map((b) => ({ id: b._id, price: b.price, leadTimeDays: b.leadTimeDays, trustScore: b.trustScoreSnapshot, submittedAt: b.lastSubmittedAt })));
  assert.deepEqual(
    board.map((e) => [e.bidId, e.rank, e.score]),
    engine.map((e) => [e.id, e.rank, e.score]),
    'same ranks and scores as the scoring engine'
  );
});

test('each entry carries the comparison fields, and no contact details', () => {
  const byId = Object.fromEntries(buildLeaderboard(BIDS, STATS).map((e) => [e.vendorId, e]));
  assert.deepEqual(
    [byId.v2.businessName, byId.v2.kybVerified, byId.v2.trustScore, byId.v2.reviewCount, byId.v2.totalOrders, byId.v2.completedOrders, byId.v2.completionRate],
    ['Shop v2', true, 4.6, 12, 14, 12, 0.923]
  );
  assert.equal(byId.v3.kybVerified, false, 'not KYB approved');
  assert.equal(byId.v4.businessName, 'Owner v4', 'falls back to the owner name');
  assert.deepEqual([byId.v4.totalOrders, byId.v4.completedOrders, byId.v4.completionRate], [0, 0, null], 'no history yet');
  assert.ok(byId.v1.submittedAt instanceof Date);
  for (const e of Object.values(byId)) {
    const raw = JSON.stringify(e);
    assert.ok(!raw.includes('+9477') && !raw.includes('@x.lk'), 'no phone or e-mail');
  }
});

test('a vendor view holds only its own bid and rank', () => {
  const ranked = buildLeaderboard(BIDS, STATS);
  const mine = { ...BIDS[0], rank: ranked.find((e) => e.bidId === 'b1').rank, revisions: [] };
  const view = buildVendorBidView(mine, BIDS.length);
  assert.deepEqual(Object.keys(view).sort(), ['myBid', 'rank', 'rankLabel', 'totalBids']);
  const raw = JSON.stringify(view);
  for (const leak of ['Shop v2', 'v2', '135000', 'totalOrders', 'completedOrders', 'kybVerified', 'score']) assert.ok(!raw.includes(leak), `vendor view leaks ${leak}`);
});

test('KYB verified needs both KYB approval and current verification', () => {
  assert.equal(isKybVerified({ vendorStatus: 'APPROVED', isVerified: true }), true);
  assert.equal(isKybVerified({ vendorStatus: 'APPROVED', isVerified: false }), false);
  assert.equal(isKybVerified({ vendorStatus: 'PENDING_APPROVAL', isVerified: true }), false);
  assert.equal(isKybVerified(null), false);
});
