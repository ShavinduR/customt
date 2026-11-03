/**
 * Buyer-Determined Multi-Attribute Reverse Auction scoring (pure functions, unit-tested).
 *
 *   finalScore = (minPrice / price)           * 0.50
 *              + (trustScore / maxTrustScore)  * 0.30
 *              + (minLeadTime / leadTimeDays)  * 0.20
 *
 * Every component is normalised to (0, 1], so the best possible score is 1.0.
 */
const { AUCTION } = require('../config/constants');
const { round } = require('../utils/helpers');

const { WEIGHTS } = AUCTION;

/**
 * @param {Array<{id:any, price:number, leadTimeDays:number, trustScore:number, submittedAt?:Date}>} bids
 * @returns {Array<{id:any, score:number, rank:number, breakdown:object}>} sorted by rank ascending
 */
function scoreBids(bids) {
  if (!Array.isArray(bids) || bids.length === 0) return [];

  const minPrice = Math.min(...bids.map((b) => b.price));
  const minLeadTime = Math.min(...bids.map((b) => b.leadTimeDays));
  const maxTrustScore = Math.max(...bids.map((b) => b.trustScore));

  const scored = bids.map((bid) => {
    const priceComponent = (minPrice / bid.price) * WEIGHTS.price;
    const trustComponent = maxTrustScore > 0 ? (bid.trustScore / maxTrustScore) * WEIGHTS.trust : 0;
    const leadComponent = (minLeadTime / bid.leadTimeDays) * WEIGHTS.leadTime;
    const rawScore = priceComponent + trustComponent + leadComponent;
    return {
      ...bid,
      rawScore,
      score: round(rawScore, 4),
      breakdown: {
        price: round(priceComponent, 4),
        trust: round(trustComponent, 4),
        leadTime: round(leadComponent, 4),
      },
    };
  });

  // Deterministic tie-breaks: higher score > lower price > shorter lead time > earlier submission.
  scored.sort((a, b) => {
    if (b.rawScore !== a.rawScore) return b.rawScore - a.rawScore;
    if (a.price !== b.price) return a.price - b.price;
    if (a.leadTimeDays !== b.leadTimeDays) return a.leadTimeDays - b.leadTimeDays;
    const at = a.submittedAt ? new Date(a.submittedAt).getTime() : 0;
    const bt = b.submittedAt ? new Date(b.submittedAt).getTime() : 0;
    return at - bt;
  });

  return scored.map(({ rawScore, ...rest }, index) => ({ ...rest, rank: index + 1 }));
}

/**
 * Price-Signal Diagnostic: Coefficient of Variation (population std-dev / mean).
 * CV > 0.35 with >= 3 bids suggests vendors interpreted the spec differently.
 */
function computePriceDiagnostic(prices) {
  const bidCount = prices.length;
  if (bidCount === 0) {
    return { bidCount, mean: null, stdDev: null, coefficientOfVariation: null, highVariance: false, message: null };
  }
  const mean = prices.reduce((s, p) => s + p, 0) / bidCount;
  const variance = prices.reduce((s, p) => s + (p - mean) ** 2, 0) / bidCount;
  const stdDev = Math.sqrt(variance);
  const cv = mean > 0 ? stdDev / mean : 0;
  const highVariance = bidCount >= AUCTION.PRICE_CV_MIN_BIDS && cv > AUCTION.PRICE_CV_THRESHOLD;
  return {
    bidCount,
    mean: round(mean, 2),
    stdDev: round(stdDev, 2),
    coefficientOfVariation: round(cv, 4),
    highVariance,
    message: highVariance ? 'High price variance detected — specification ambiguity possible.' : null,
  };
}

module.exports = { scoreBids, computePriceDiagnostic, WEIGHTS };
