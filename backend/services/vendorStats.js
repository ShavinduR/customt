/**
 * Vendor credibility figures for the buyer's auction comparison (order history + reviews).
 *
 * Counts come from ONE aggregation over the orders of every vendor on a leaderboard (Order.vendorId is
 * indexed), so building a leaderboard costs one extra query however many vendors bid: no N+1.
 *
 *  totalOrders     orders the vendor was awarded, excluding ones the buyer cancelled before paying
 *  completedOrders orders that ended COMPLETED (O2O verified, buyer approval, or a dispute released to them)
 *  refundedOrders  orders refunded to the buyer after a dispute
 *  activeOrders    orders still in progress (paid or awaiting payment)
 *  completionRate  completed / finished (completed + refunded), or null when nothing has finished yet,
 *                  so a vendor with orders still in production is not penalised for them.
 *
 * Nothing here carries contact details: it is safe to show to the buyer who owns the RFQ (and admins).
 * Vendors never receive these figures for their competitors.
 */
const { Order } = require('../models');
const { ORDER_STATUS } = require('../config/constants');

const EMPTY = Object.freeze({ totalOrders: 0, completedOrders: 0, refundedOrders: 0, activeOrders: 0, completionRate: null });

function finalise({ totalOrders = 0, completedOrders = 0, refundedOrders = 0 } = {}) {
  const finished = completedOrders + refundedOrders;
  return {
    totalOrders,
    completedOrders,
    refundedOrders,
    activeOrders: Math.max(0, totalOrders - finished),
    completionRate: finished > 0 ? Math.round((completedOrders / finished) * 1000) / 1000 : null,
  };
}

/** @returns {Promise<Map<string, typeof EMPTY>>} stats per vendor id (every requested id is present). */
async function vendorOrderStats(vendorIds) {
  const ids = [...new Map(vendorIds.filter(Boolean).map((id) => [String(id._id || id), id._id || id])).values()];
  const stats = new Map(ids.map((id) => [String(id), { ...EMPTY }]));
  if (!ids.length) return stats;

  const rows = await Order.aggregate([
    { $match: { vendorId: { $in: ids }, orderStatus: { $ne: ORDER_STATUS.CANCELLED } } },
    {
      $group: {
        _id: '$vendorId',
        totalOrders: { $sum: 1 },
        completedOrders: { $sum: { $cond: [{ $eq: ['$orderStatus', ORDER_STATUS.COMPLETED] }, 1, 0] } },
        refundedOrders: { $sum: { $cond: [{ $eq: ['$orderStatus', ORDER_STATUS.REFUNDED] }, 1, 0] } },
      },
    },
  ]);
  rows.forEach((r) => stats.set(String(r._id), finalise(r)));
  return stats;
}

module.exports = { vendorOrderStats, EMPTY_VENDOR_STATS: EMPTY };
