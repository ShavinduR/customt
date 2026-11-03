import { Crown, EyeOff, TrendingDown, TrendingUp } from 'lucide-react';
import { cx } from '../ui';

/**
 * Rank-only visibility: the vendor sees their position, never competitors' prices or names.
 * `previousRank` drives the trend arrow (a lower number is better).
 */
export default function RankDisplay({ rank, totalBids, previousRank, size = 'lg' }) {
  if (!rank) {
    return (
      <div className="flex flex-col items-center text-center">
        <span className={cx('flex items-center justify-center rounded-full border-2 border-dashed border-slate-300 text-slate-400', size === 'lg' ? 'h-28 w-28 text-sm' : 'h-14 w-14 text-xs')}>
          No bid yet
        </span>
        {size === 'lg' && <p className="mt-3 text-sm text-slate-500">Place a bid to see your rank</p>}
      </div>
    );
  }

  const leading = rank === 1;
  const improved = previousRank && rank < previousRank;
  const dropped = previousRank && rank > previousRank;

  return (
    <div className="flex flex-col items-center text-center">
      <span
        className={cx(
          'relative flex flex-col items-center justify-center rounded-full font-bold shadow-inner',
          size === 'lg' ? 'h-28 w-28' : 'h-14 w-14',
          leading ? 'bg-gradient-to-br from-amber-300 to-amber-500 text-amber-950' : 'bg-gradient-to-br from-slate-100 to-slate-200 text-slate-800'
        )}
        aria-label={`Your rank: ${rank} of ${totalBids}`}
      >
        {leading && <Crown className={size === 'lg' ? 'h-5 w-5' : 'h-3 w-3'} />}
        <span className={cx('font-mono leading-none', size === 'lg' ? 'text-4xl' : 'text-lg')}>#{rank}</span>
        {size === 'lg' && <span className="mt-0.5 text-xs font-medium opacity-70">of {totalBids}</span>}
        {(improved || dropped) && (
          <span className={cx('absolute -right-1 -top-1 rounded-full p-1 text-white', improved ? 'bg-emerald-500' : 'bg-red-500')}>
            {improved ? <TrendingUp className="h-3.5 w-3.5" /> : <TrendingDown className="h-3.5 w-3.5" />}
          </span>
        )}
      </span>
      {size === 'lg' && (
        <>
          <p className="mt-3 font-semibold text-slate-900">
            Your Rank: #{rank} of {totalBids}
          </p>
          <p className={cx('text-sm', leading ? 'text-emerald-600' : 'text-slate-500')}>
            {leading ? "You're leading this auction" : `${rank - 1} offer${rank - 1 === 1 ? '' : 's'} currently score higher`}
          </p>
          <p className="mt-2 flex items-center gap-1 text-xs text-slate-400">
            <EyeOff className="h-3.5 w-3.5" /> Competitors' prices and identities are hidden
          </p>
        </>
      )}
    </div>
  );
}
