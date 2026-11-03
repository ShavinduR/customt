import { BadgeCheck, Clock, Crown, MessageSquareText, RefreshCw } from 'lucide-react';
import { Badge, Button, TrustStars, cx } from '../ui';
import { formatLKR, formatRelative } from '../../utils/format';

const RANK_STYLE = {
  1: 'bg-amber-400 text-amber-950',
  2: 'bg-slate-300 text-slate-800',
  3: 'bg-orange-300 text-orange-950',
};

export function RankBadge({ rank }) {
  return (
    <span className={cx('inline-flex h-8 w-8 items-center justify-center rounded-full text-sm font-bold', RANK_STYLE[rank] || 'bg-slate-100 text-slate-600')}>
      {rank === 1 ? <Crown className="h-4 w-4" /> : `#${rank}`}
    </span>
  );
}

/** Stacked bar visualising the multi-attribute score (price 50%, trust 30%, lead time 20%). */
export function ScoreBar({ score, breakdown }) {
  return (
    <div className="min-w-[8rem]">
      <div className="flex items-baseline justify-between">
        <span className="font-mono text-sm font-bold text-slate-900">{Number(score).toFixed(4)}</span>
        <span className="text-[10px] text-slate-400">/ 1.0000</span>
      </div>
      <div className="mt-1 flex h-2 overflow-hidden rounded-full bg-slate-100" title={`Price ${breakdown.price} · Trust ${breakdown.trust} · Lead time ${breakdown.leadTime}`}>
        <span className="bg-brand-500" style={{ width: `${breakdown.price * 100}%` }} />
        <span className="bg-amber-400" style={{ width: `${breakdown.trust * 100}%` }} />
        <span className="bg-emerald-500" style={{ width: `${breakdown.leadTime * 100}%` }} />
      </div>
    </div>
  );
}

export function ScoreLegend() {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
      <span className="flex items-center gap-1.5">
        <span className="h-2 w-3 rounded-sm bg-brand-500" /> Price × 0.50
      </span>
      <span className="flex items-center gap-1.5">
        <span className="h-2 w-3 rounded-sm bg-amber-400" /> Trust × 0.30
      </span>
      <span className="flex items-center gap-1.5">
        <span className="h-2 w-3 rounded-sm bg-emerald-500" /> Lead time × 0.20
      </span>
    </div>
  );
}

function VendorCell({ entry }) {
  return (
    <div className="min-w-0">
      <p className="truncate font-semibold text-slate-900">{entry.companyName || entry.vendorName}</p>
      <p className="truncate text-xs text-slate-500">{entry.vendorName}</p>
      <div className="mt-1 flex flex-wrap items-center gap-1">
        <TrustStars score={entry.trustScore} />
        {entry.skillBadges?.map((b) => (
          <Badge key={b} tone="violet" icon={BadgeCheck}>
            {b}
          </Badge>
        ))}
      </div>
    </div>
  );
}

/**
 * Full ranked leaderboard (buyer / admin view only).
 * `flashIds` highlights rows that just changed so the buyer can follow live bidding.
 */
export default function Leaderboard({ entries, canAccept, onAccept, flashIds = new Set(), quantity }) {
  return (
    <div>
      {/* Desktop table */}
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
              <th className="px-4 py-3 font-medium">Rank</th>
              <th className="px-4 py-3 font-medium">Vendor</th>
              <th className="px-4 py-3 text-right font-medium">Total price</th>
              <th className="whitespace-nowrap px-4 py-3 text-right font-medium">Lead time</th>
              <th className="px-4 py-3 font-medium">Score</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => (
              <tr
                key={`${e.bidId}-${e.lastSubmittedAt}`}
                className={cx('border-b border-slate-100 align-top last:border-0', e.rank === 1 && 'bg-amber-50/40', flashIds.has(e.bidId) && 'animate-flash')}
              >
                <td className="px-4 py-4">
                  <RankBadge rank={e.rank} />
                </td>
                <td className="min-w-[12rem] px-4 py-4">
                  <VendorCell entry={e} />
                  {e.notes && (
                    <p className="mt-2 flex gap-1.5 text-xs italic text-slate-500">
                      <MessageSquareText className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                      {e.notes}
                    </p>
                  )}
                </td>
                <td className="whitespace-nowrap px-4 py-4 text-right">
                  <p className="font-mono font-semibold text-slate-900">{formatLKR(e.price)}</p>
                  <p className="text-xs text-slate-500">
                    {formatLKR(e.unitPrice)} / pc{quantity ? ` × ${quantity}` : ''}
                  </p>
                </td>
                <td className="whitespace-nowrap px-4 py-4 text-right">
                  <p className="font-semibold text-slate-900">{e.leadTimeDays} days</p>
                  {e.revisionCount > 0 && (
                    <p className="mt-0.5 inline-flex items-center gap-1 text-xs text-slate-500">
                      <RefreshCw className="h-3 w-3" /> {e.revisionCount} re-bid{e.revisionCount > 1 ? 's' : ''}
                    </p>
                  )}
                  <p className="text-xs text-slate-400">{formatRelative(e.lastSubmittedAt)}</p>
                </td>
                <td className="px-4 py-4">
                  <ScoreBar score={e.score} breakdown={e.scoreBreakdown} />
                  {canAccept && (
                    <Button size="sm" className="mt-3 w-full" variant={e.rank === 1 ? 'success' : 'secondary'} onClick={() => onAccept(e)}>
                      Accept bid
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile cards */}
      <div className="space-y-3 md:hidden">
        {entries.map((e) => (
          <div key={`${e.bidId}-${e.lastSubmittedAt}`} className={cx('rounded-xl border border-slate-200 p-4', e.rank === 1 && 'border-amber-300 bg-amber-50/40', flashIds.has(e.bidId) && 'animate-flash')}>
            <div className="flex items-start gap-3">
              <RankBadge rank={e.rank} />
              <div className="min-w-0 flex-1">
                <VendorCell entry={e} />
              </div>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
              <div>
                <p className="text-xs text-slate-500">Total price</p>
                <p className="font-mono font-semibold">{formatLKR(e.price)}</p>
                <p className="text-xs text-slate-500">{formatLKR(e.unitPrice)} / pc</p>
              </div>
              <div>
                <p className="text-xs text-slate-500">Lead time</p>
                <p className="flex items-center gap-1 font-semibold">
                  <Clock className="h-3.5 w-3.5 text-slate-400" /> {e.leadTimeDays} days
                </p>
              </div>
            </div>
            <div className="mt-3">
              <ScoreBar score={e.score} breakdown={e.scoreBreakdown} />
            </div>
            {e.notes && <p className="mt-2 text-xs italic text-slate-500">“{e.notes}”</p>}
            {canAccept && (
              <Button size="sm" className="mt-3 w-full" variant={e.rank === 1 ? 'success' : 'secondary'} onClick={() => onAccept(e)}>
                Accept bid
              </Button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
