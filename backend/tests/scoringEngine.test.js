const test = require('node:test');
const assert = require('node:assert/strict');
const { scoreBids, computePriceDiagnostic } = require('../services/scoringEngine');
const { nextTrustScore } = require('../services/orderService');
const { calculateExpectedDeliveryDays, buildDesignSpecs } = require('../utils/rfqCalculator');

test('multi-attribute score follows the exact weighted formula', () => {
  const bids = [
    { id: 'A', price: 100000, leadTimeDays: 10, trustScore: 4.5 },
    { id: 'B', price: 80000, leadTimeDays: 14, trustScore: 3.5 },
    { id: 'C', price: 90000, leadTimeDays: 7, trustScore: 4.0 },
  ];
  const ranked = scoreBids(bids);
  const byId = Object.fromEntries(ranked.map((r) => [r.id, r]));

  // minPrice=80000, minLead=7, maxTrust=4.5
  const expected = {
    A: (80000 / 100000) * 0.5 + (4.5 / 4.5) * 0.3 + (7 / 10) * 0.2, // 0.84
    B: (80000 / 80000) * 0.5 + (3.5 / 4.5) * 0.3 + (7 / 14) * 0.2, // 0.8333
    C: (80000 / 90000) * 0.5 + (4.0 / 4.5) * 0.3 + (7 / 7) * 0.2, // 0.9111
  };
  Object.entries(expected).forEach(([id, score]) => {
    assert.ok(Math.abs(byId[id].score - score) < 1e-4, `${id}: ${byId[id].score} vs ${score}`);
  });
  assert.deepEqual(
    ranked.map((r) => [r.id, r.rank]),
    [
      ['C', 1],
      ['A', 2],
      ['B', 3],
    ]
  );
});

test('a single bid scores the maximum 1.0 and ranks #1', () => {
  const [only] = scoreBids([{ id: 'X', price: 5000, leadTimeDays: 5, trustScore: 3.5 }]);
  assert.equal(only.score, 1);
  assert.equal(only.rank, 1);
});

test('identical offers tie-break on earliest submission', () => {
  const ranked = scoreBids([
    { id: 'late', price: 100, leadTimeDays: 10, trustScore: 4, submittedAt: new Date(2000) },
    { id: 'early', price: 100, leadTimeDays: 10, trustScore: 4, submittedAt: new Date(1000) },
  ]);
  assert.deepEqual(ranked.map((r) => r.id), ['early', 'late']);
});

test('price diagnostic flags CV > 0.35 only with at least 3 bids', () => {
  assert.equal(computePriceDiagnostic([100, 300]).highVariance, false);
  const low = computePriceDiagnostic([100, 110, 95]);
  assert.equal(low.highVariance, false);
  const high = computePriceDiagnostic([50, 100, 200]);
  assert.ok(high.coefficientOfVariation > 0.35);
  assert.equal(high.highVariance, true);
  assert.match(high.message, /specification ambiguity/);
});

test('trust score EWMA: 0.7 * old + 0.3 * rating, clamped to [1, 5]', () => {
  assert.equal(nextTrustScore(3.5, 5), 3.95);
  assert.equal(nextTrustScore(3.5, 1), 2.75);
  assert.equal(nextTrustScore(5, 5), 5);
});

test('RFQ builder enforces MOQ and computes quantity + delivery days', () => {
  const base = {
    garmentType: 'Hoodie',
    fabric: '100% Cotton',
    gsm: 220,
    color: '#111827',
    printType: 'Embroidery',
    printPlacement: 'FRONT_AND_BACK',
    customText: 'Team 2026',
  };
  assert.throws(() => buildDesignSpecs({ ...base, sizeBreakdown: { S: 5, M: 5 } }), /Minimum order quantity/);
  const specs = buildDesignSpecs({ ...base, sizeBreakdown: { S: 50, M: 60, L: 60, XL: 30, XXL: 10 } });
  assert.equal(specs.totalQuantity, 210);
  // Embroidery 10 + Hoodie 2 + volume (ceil(210/100)-1 = 2) + both sides 1 = 15
  assert.equal(calculateExpectedDeliveryDays(specs), 15);
});
