import { useEffect, useId, useState } from 'react';
import { Award, BadgeCheck, CalendarClock, Clock, ExternalLink, Info, MessageSquareText, PackageCheck, RefreshCw, ShieldCheck, Sparkles, Star, Truck, Wallet } from 'lucide-react';
import { rfqApi } from '../../api/client';
import { Alert, Badge, Button, ErrorList, Modal, Spinner, TrustStars, cx } from '../ui';
import { formatDate, formatLKR, formatRelative } from '../../utils/format';

/**
 * Buyer's Hybrid Comparison View of a reverse auction (RFQ owner only; the server never sends this data to
 * vendors). Every bid is listed. "Best Match" keeps the research ranking: the multi-attribute score
 * (price 50%, trust 30%, lead time 20%) computed on the server. The other tabs only re-order the same
 * list on screen (price, delivery, rating) so the buyer can compare; ranks and scores never change.
 */

export const SORTS = [
  { value: 'best', label: 'Best Match', icon: Sparkles },
  { value: 'price', label: 'Lowest Price', icon: Wallet },
  { value: 'delivery', label: 'Fastest Delivery', icon: Truck },
  { value: 'rating', label: 'Highest Rated', icon: Star },
];

export const BEST_MATCH_HELP = 'Ranked by Price (50%), Vendor Trust (30%), and Delivery Speed (20%).';

const ratingOf = (e) => Number(e.currentTrustScore ?? e.trustScore ?? 0);

/** Sorted copy; ties fall back to the multi-attribute rank so the order is always stable. */
export function sortEntries(entries, sort) {
  const byRank = (a, b) => a.rank - b.rank;
  const cmp = {
    best: byRank,
    price: (a, b) => a.price - b.price || byRank(a, b),
    delivery: (a, b) => a.leadTimeDays - b.leadTimeDays || byRank(a, b),
    rating: (a, b) => ratingOf(b) - ratingOf(a) || byRank(a, b),
  }[sort] || byRank;
  return [...entries].sort(cmp);
}

const matchPercent = (score) => Math.round(Math.max(0, Math.min(1, Number(score) || 0)) * 100);
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** Small info icon with a tooltip that also opens on tap and keyboard focus (phones have no hover). */
function InfoTip({ text, label = 'How is this ranked?' }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <span className="relative inline-flex" onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      <button
        type="button"
        aria-label={label}
        aria-describedby={open ? id : undefined}
        aria-expanded={open}
        // Hover, focus and tap all open it (a toggle here would close it again right after focus opened it).
        onClick={(e) => {
          e.stopPropagation();
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={(e) => e.key === 'Escape' && setOpen(false)}
        className="inline-flex h-6 w-6 items-center justify-center rounded-full text-amber-700 hover:bg-amber-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400"
      >
        <Info className="h-3.5 w-3.5" />
      </button>
      {open && (
        <span id={id} role="tooltip" className="absolute left-1/2 top-full z-20 mt-1 w-56 -translate-x-1/2 rounded-lg bg-slate-900 px-3 py-2 text-xs font-normal leading-snug text-white shadow-lg">
          {text}
        </span>
      )}
    </span>
  );
}

function BestMatchBadge() {
  return (
    <span className="inline-flex items-center gap-0.5 rounded-full bg-amber-100 py-0.5 pl-2 pr-0.5 text-xs font-semibold text-amber-900 ring-1 ring-inset ring-amber-300">
      <Award className="h-3.5 w-3.5" /> Best Match
      <InfoTip text={BEST_MATCH_HELP} label="Why is this the best match?" />
    </span>
  );
}

/** Match score as a percentage, with the 50/30/20 breakdown in the tooltip. */
function MatchBadge({ score, breakdown, best }) {
  const parts = breakdown ? `Price ${matchPercent(breakdown.price / 0.5)}% · Trust ${matchPercent(breakdown.trust / 0.3)}% · Delivery ${matchPercent(breakdown.leadTime / 0.2)}%` : '';
  return (
    <span
      className={cx('inline-flex items-center gap-1 rounded-md px-2 py-0.5 font-mono text-xs font-semibold ring-1 ring-inset', best ? 'bg-amber-50 text-amber-900 ring-amber-200' : 'bg-slate-50 text-slate-700 ring-slate-200')}
      title={`Multi-attribute score ${Number(score).toFixed(4)} / 1.0000. ${parts}`}
    >
      {matchPercent(score)}% Match
    </span>
  );
}

function StatsPill({ entry }) {
  if (!entry.totalOrders) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-sky-50 px-2 py-0.5 text-xs font-medium text-sky-800 ring-1 ring-inset ring-sky-200">
        <Sparkles className="h-3 w-3" /> New on CustomT
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-800 ring-1 ring-inset ring-emerald-200">
      <PackageCheck className="h-3 w-3" /> {plural(entry.completedOrders, 'completed order')}
    </span>
  );
}

function SellerRow({ entry, quantity, canAccept, onAccept, onOpenSeller, flash }) {
  const best = entry.rank === 1;
  const awarded = entry.status === 'ACCEPTED';
  const name = entry.businessName || entry.companyName || entry.vendorName;
  return (
    <li
      className={cx(
        'rounded-xl border bg-white p-4 transition md:grid md:grid-cols-[minmax(0,1fr)_9.5rem_7rem_12.5rem] md:items-start md:gap-4',
        best ? 'border-amber-300 bg-amber-50/30' : 'border-slate-200',
        awarded && 'border-emerald-300 bg-emerald-50/40',
        flash && 'animate-flash'
      )}
      data-bid={entry.bidId}
    >
      {/* Seller */}
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="inline-flex h-6 min-w-6 items-center justify-center rounded-full bg-slate-100 px-1.5 text-xs font-bold text-slate-600" title="Multi-attribute rank">
            #{entry.rank}
          </span>
          {best && <BestMatchBadge />}
          {awarded && (
            <Badge tone="green" icon={BadgeCheck}>
              Awarded
            </Badge>
          )}
        </div>
        <div className="mt-1.5 flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1">
          <button
            type="button"
            onClick={() => onOpenSeller(entry)}
            className="min-w-0 truncate text-left text-base font-semibold text-brand-700 underline-offset-2 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
            title="View seller profile"
          >
            {name}
          </button>
          {entry.kybVerified && (
            <span className="inline-flex items-center gap-0.5 text-xs font-medium text-emerald-700" title="Business verified through KYB">
              <ShieldCheck className="h-3.5 w-3.5" /> Verified
            </span>
          )}
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
          <TrustStars score={ratingOf(entry)} />
          <span className="text-xs text-slate-500">({plural(entry.reviewCount || 0, 'review')})</span>
          <StatsPill entry={entry} />
        </div>
        {entry.skillBadges?.length > 0 && (
          <div className="mt-1.5 flex flex-wrap gap-1">
            {entry.skillBadges.map((b) => (
              <Badge key={b} tone="violet" icon={BadgeCheck}>
                {b}
              </Badge>
            ))}
          </div>
        )}
        {entry.notes && (
          <p className="mt-2 flex gap-1.5 rounded-lg bg-slate-50 px-2.5 py-1.5 text-xs text-slate-600">
            <MessageSquareText className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" />
            <span className="break-words">{entry.notes}</span>
          </p>
        )}
      </div>

      {/* Price + delivery: side by side on phones, own columns on wider screens */}
      <div className="mt-3 grid grid-cols-2 gap-3 md:contents">
        <div className="md:text-right">
          <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400 md:hidden">Total price</p>
          <p className="font-mono text-base font-bold leading-tight text-slate-900 sm:text-lg">{formatLKR(entry.price)}</p>
          <p className="text-xs text-slate-500">
            {formatLKR(entry.unitPrice)} / pc{quantity ? ` × ${quantity}` : ''}
          </p>
        </div>
        <div className="md:text-right">
          <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400 md:hidden">Delivery</p>
          <p className="inline-flex items-center gap-1 text-base font-semibold text-slate-900">
            <Clock className="h-4 w-4 text-slate-400" /> {plural(entry.leadTimeDays, 'day')}
          </p>
          <p className="text-xs text-slate-400">
            {entry.revisionCount > 0 && (
              <span className="mr-1 inline-flex items-center gap-0.5">
                <RefreshCw className="h-3 w-3" /> {plural(entry.revisionCount, 're-bid')} ·
              </span>
            )}
            {formatRelative(entry.submittedAt || entry.lastSubmittedAt)}
          </p>
        </div>
      </div>

      {/* Match + action */}
      <div className="mt-3 flex flex-col gap-2 md:mt-0 md:items-end">
        <MatchBadge score={entry.score} breakdown={entry.scoreBreakdown} best={best} />
        {canAccept && (
          <Button size="sm" className="w-full" variant={best ? 'success' : 'secondary'} icon={ShieldCheck} onClick={() => onAccept(entry)}>
            Select &amp; Pay via Escrow
          </Button>
        )}
      </div>
    </li>
  );
}

/**
 * entries: the owner's leaderboard (every bid). sort/onSortChange are controlled by the page so live
 * updates (new arrays on every bid) never reset the tab the buyer chose.
 */
export default function HybridLeaderboard({ rfqId, entries, sort, onSortChange, canAccept, onAccept, flashIds = new Set(), quantity }) {
  const [seller, setSeller] = useState(null);
  const sorted = sortEntries(entries, sort);
  return (
    <div>
      <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="grid grid-cols-2 gap-1 rounded-xl bg-slate-100 p-1 sm:flex" role="tablist" aria-label="Sort bids">
          {SORTS.map(({ value, label, icon: Icon }) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={sort === value}
              onClick={() => onSortChange(value)}
              className={cx(
                'inline-flex min-h-9 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium transition',
                sort === value ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800'
              )}
            >
              <Icon className="h-3.5 w-3.5" /> {label}
            </button>
          ))}
        </div>
        <p className="text-xs text-slate-500">
          {plural(entries.length, 'bid')} · {sort === 'best' ? 'ranked by match score' : 'rank # stays the match-score rank'}
        </p>
      </div>

      {/* Column labels (wide screens) */}
      <div className="mb-1 hidden grid-cols-[minmax(0,1fr)_9.5rem_7rem_12.5rem] gap-4 px-4 text-[11px] font-medium uppercase tracking-wide text-slate-400 md:grid">
        <span>Seller</span>
        <span className="text-right">Total price</span>
        <span className="text-right">Delivery</span>
        <span className="text-right">Match</span>
      </div>
      <ul className="space-y-2.5" aria-label="Bids">
        {sorted.map((e) => (
          <SellerRow
            key={`${e.bidId}-${e.lastSubmittedAt}`}
            entry={e}
            quantity={quantity}
            canAccept={canAccept}
            onAccept={onAccept}
            onOpenSeller={setSeller}
            flash={flashIds.has(e.bidId)}
          />
        ))}
      </ul>

      <SellerProfileModal rfqId={rfqId} entry={seller} onClose={() => setSeller(null)} />
    </div>
  );
}

function ProfileStat({ icon: Icon, label, value, hint }) {
  return (
    <div className="rounded-xl border border-slate-200 p-3">
      <p className="flex items-center gap-1.5 text-xs text-slate-500">
        <Icon className="h-3.5 w-3.5" /> {label}
      </p>
      <p className="mt-1 text-lg font-bold text-slate-900">{value}</p>
      {hint && <p className="text-[11px] text-slate-400">{hint}</p>}
    </div>
  );
}

/**
 * Seller profile over the auction (a modal, so the live auction and the chosen sort stay as they are).
 * Data comes from GET /api/rfqs/:id/vendors/:vendorId: order history, KYB, trust and anonymous reviews.
 * It never contains phone numbers, e-mails or links.
 */
function SellerProfileModal({ rfqId, entry, onClose }) {
  const [state, setState] = useState({ loading: false, error: null, profile: null });
  const vendorId = entry?.vendorId;

  useEffect(() => {
    if (!vendorId) return undefined;
    let cancelled = false;
    setState({ loading: true, error: null, profile: null });
    rfqApi
      .bidderProfile(rfqId, vendorId)
      .then((res) => !cancelled && setState({ loading: false, error: null, profile: res.profile }))
      .catch((error) => !cancelled && setState({ loading: false, error, profile: null }));
    return () => {
      cancelled = true;
    };
  }, [rfqId, vendorId]);

  const p = state.profile;
  const name = p?.businessName || entry?.businessName || entry?.companyName || 'Seller';
  const rate = p?.completionRate;

  return (
    <Modal
      open={Boolean(entry)}
      onClose={onClose}
      size="lg"
      title={
        <span className="flex flex-wrap items-center gap-2">
          {name}
          {(p?.kybVerified ?? entry?.kybVerified) && (
            <Badge tone="green" icon={ShieldCheck}>
              KYB verified
            </Badge>
          )}
        </span>
      }
      subtitle="Seller profile · your auction stays live in the background"
      footer={
        <div className="flex w-full flex-col-reverse gap-2 sm:flex-row sm:justify-between">
          {p?.storefrontAvailable ? (
            <a href={`/vendors/${p.vendorId}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium text-brand-700 hover:bg-brand-50">
              Open full storefront <ExternalLink className="h-3.5 w-3.5" />
            </a>
          ) : (
            <span />
          )}
          <Button onClick={onClose}>Back to auction</Button>
        </div>
      }
    >
      {state.loading && (
        <div className="flex justify-center py-10">
          <Spinner label="Loading seller profile…" />
        </div>
      )}
      {state.error && <ErrorList error={state.error} />}
      {p && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <TrustStars score={p.trustScore} size="md" />
            <span className="text-sm text-slate-500">{plural(p.reviewCount, 'review')}</span>
            <span className="inline-flex items-center gap-1 text-xs text-slate-500">
              <CalendarClock className="h-3.5 w-3.5" /> On CustomT since {formatDate(p.memberSince, false)}
            </span>
          </div>

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <ProfileStat icon={Award} label="Orders taken" value={p.totalOrders} hint={p.activeOrders ? `${p.activeOrders} in progress` : undefined} />
            <ProfileStat icon={PackageCheck} label="Completed" value={p.completedOrders} />
            <ProfileStat icon={BadgeCheck} label="Completion rate" value={rate === null || rate === undefined ? '—' : `${Math.round(rate * 100)}%`} hint={rate === null || rate === undefined ? 'No finished orders yet' : 'Of finished orders'} />
            <ProfileStat icon={ShieldCheck} label="KYB status" value={p.kybVerified ? 'Verified' : 'Not verified'} />
          </div>

          {(p.capabilities?.length > 0 || p.skillBadges?.length > 0) && (
            <div className="flex flex-wrap gap-1.5">
              {p.capabilities.map((c) => (
                <Badge key={c} tone="blue">
                  {c}
                </Badge>
              ))}
              {p.skillBadges.map((b) => (
                <Badge key={b} tone="violet" icon={BadgeCheck}>
                  {b}
                </Badge>
              ))}
              {p.maxCapacity > 0 && <Badge tone="slate">Up to {p.maxCapacity} pcs</Badge>}
            </div>
          )}

          {p.bio && <p className="whitespace-pre-line rounded-xl bg-slate-50 p-3 text-sm text-slate-700">{p.bio}</p>}

          <div>
            <h3 className="mb-2 text-sm font-semibold text-slate-900">Recent buyer reviews</h3>
            {p.reviews.length === 0 ? (
              <Alert tone="info">No reviews yet. Every CustomT order is protected by escrow and the O2O inspection PIN.</Alert>
            ) : (
              <ul className="space-y-2">
                {p.reviews.map((r, i) => (
                  // eslint-disable-next-line react/no-array-index-key
                  <li key={i} className="rounded-xl border border-slate-200 p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <TrustStars score={r.rating} showValue={false} />
                      <span className="text-xs text-slate-400">{formatDate(r.ratedAt, false)}</span>
                    </div>
                    {r.review && <p className="mt-1.5 text-sm text-slate-700">“{r.review}”</p>}
                    <p className="mt-1 text-xs text-slate-400">
                      Verified buyer{r.garmentType ? ` · ${r.quantity ? `${r.quantity} × ` : ''}${r.garmentType}` : ''}
                      {r.printType ? ` · ${r.printType}` : ''}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}
