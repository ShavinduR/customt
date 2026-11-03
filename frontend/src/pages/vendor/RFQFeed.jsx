import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CalendarClock, Crown, Gavel, Hourglass, Layers, Radio, Ruler, Sparkles } from 'lucide-react';
import { vendorApi } from '../../api/client';
import { useSocket, useSocketEvent } from '../../context/SocketContext';
import { useVendorStatus } from '../../context/VendorStatusContext';
import TShirtPreview from '../../components/configurator/TShirtPreview';
import BidModal from '../../components/vendor/BidModal';
import { Badge, Button, Card, Countdown, EmptyState, ErrorList, PageHeader, Spinner, Tabs, cx } from '../../components/ui';
import { formatLKR } from '../../utils/format';

/** Live RFQ card for vendors: specs, timer and the vendor's own rank (never competitor data). */
export function VendorRfqCard({ rfq, onBid, isNew = false }) {
  const navigate = useNavigate();
  const specs = rfq.designSpecs;
  return (
    <Card className={cx('flex flex-col overflow-hidden transition hover:shadow-md', isNew && 'ring-2 ring-emerald-400')}>
      <div className="flex gap-4 p-4">
        <div className="w-24 shrink-0 rounded-xl bg-slate-50 p-1.5">
          <TShirtPreview specs={specs} view={specs.printPlacement === 'BACK' ? 'back' : 'front'} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            {isNew && <Badge tone="green">New</Badge>}
            <span className="font-mono text-xs text-slate-400">{rfq.rfqCode}</span>
          </div>
          <h3 className="mt-0.5 truncate font-semibold text-slate-900">{rfq.title}</h3>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <Badge tone="brand" icon={Sparkles}>
              {specs.printType}
            </Badge>
            <Badge tone="slate" icon={Ruler}>
              {specs.totalQuantity} pcs
            </Badge>
            <Badge tone="slate" icon={Layers}>
              {specs.garmentType} · {specs.gsm} GSM
            </Badge>
          </div>
          <p className="mt-2 truncate text-xs text-slate-500">
            {specs.fabric} · <span className="inline-block h-2.5 w-2.5 rounded-full border border-slate-300 align-middle" style={{ backgroundColor: specs.color }} /> {specs.color}
          </p>
        </div>
      </div>
      <div className="grid grid-cols-3 divide-x divide-slate-100 border-y border-slate-100 bg-slate-50/60 text-center text-xs">
        <div className="px-2 py-2">
          <p className="flex items-center justify-center gap-1 text-slate-500">
            <Hourglass className="h-3.5 w-3.5" /> Closes in
          </p>
          <Countdown expiresAt={rfq.expiresAt} compact />
        </div>
        <div className="px-2 py-2">
          <p className="flex items-center justify-center gap-1 text-slate-500">
            <CalendarClock className="h-3.5 w-3.5" /> Delivery
          </p>
          <p className="text-sm font-semibold text-slate-800">{rfq.expectedDeliveryDays} days</p>
        </div>
        <div className="px-2 py-2">
          <p className="flex items-center justify-center gap-1 text-slate-500">
            <Gavel className="h-3.5 w-3.5" /> Bids
          </p>
          <p className="text-sm font-semibold text-slate-800">{rfq.bidCount}</p>
        </div>
      </div>
      <div className="mt-auto flex flex-wrap items-center justify-between gap-3 p-4">
        {rfq.rank ? (
          <div className="min-w-0">
            <p className={cx('whitespace-nowrap font-semibold', rfq.rank === 1 ? 'text-emerald-600' : 'text-slate-900')}>
              Rank #{rfq.rank} of {rfq.totalBids}
              {rfq.rank === 1 && <Crown className="ml-1 inline h-4 w-4 -translate-y-0.5" />}
            </p>
            <p className="whitespace-nowrap text-xs text-slate-500">
              {formatLKR(rfq.myBid.price)} · {rfq.myBid.leadTimeDays} days
            </p>
          </div>
        ) : (
          <p className="text-sm text-slate-500">You haven't bid yet</p>
        )}
        <div className="flex shrink-0 gap-2">
          <Button size="sm" variant="ghost" onClick={() => navigate(`/vendor/rfqs/${rfq._id}`)}>
            Details
          </Button>
          <Button size="sm" variant={rfq.rank ? 'secondary' : 'primary'} onClick={() => onBid(rfq)}>
            {rfq.rank ? 'Improve bid' : 'Place bid'}
          </Button>
        </div>
      </div>
    </Card>
  );
}

/** Joins every listed RFQ room so the feed receives bid counts and soft-close extensions live. */
export function useJoinRfqRooms(ids) {
  const { socket, connected } = useSocket();
  const key = ids.join(',');
  useEffect(() => {
    if (!socket || !connected || !key) return undefined;
    const list = key.split(',');
    list.forEach((rfqId) => socket.emit('rfq:join', { rfqId }, () => {}));
    return () => list.forEach((rfqId) => socket.emit('rfq:leave', { rfqId }));
  }, [socket, connected, key]);
}

/** Applies live socket events to a list of vendor RFQ items held in state. */
export function useLiveRfqItems(setItems, { removeClosed = true } = {}) {
  const patch = useCallback(
    (rfqId, updater) => setItems((items) => (items ? items.map((it) => (it._id === rfqId ? { ...it, ...updater(it) } : it)) : items)),
    [setItems]
  );
  useSocketEvent('auction:activity', (p) => {
    if (p.status !== 'OPEN' && removeClosed) setItems((items) => items?.filter((it) => it._id !== p.rfqId));
    else patch(p.rfqId, () => ({ bidCount: p.bidCount, expiresAt: p.expiresAt, status: p.status, extensionCount: p.extensionCount }));
  });
  useSocketEvent('auction:rank', (p) =>
    patch(p.rfqId, () => ({ rank: p.rank, totalBids: p.totalBids, rankLabel: p.rankLabel, myBid: p.myBid, bidCount: p.totalBids, expiresAt: p.expiresAt, status: p.status }))
  );
  useSocketEvent('auction:extended', (p) => patch(p.rfqId, () => ({ expiresAt: p.expiresAt, extensionCount: p.extensionCount })));
  const drop = (p) => removeClosed && setItems((items) => items?.filter((it) => it._id !== p.rfqId));
  useSocketEvent('auction:ended', drop);
  useSocketEvent('auction:closed', drop);
}

export default function RFQFeed() {
  const { status } = useVendorStatus();
  const [items, setItems] = useState(null);
  const [error, setError] = useState(null);
  const [filter, setFilter] = useState('all');
  const [printType, setPrintType] = useState('');
  const [newIds, setNewIds] = useState(new Set());
  const [bidding, setBidding] = useState(null);

  const load = useCallback(async () => {
    try {
      const res = await vendorApi.rfqs({ limit: 50, printType: printType || undefined });
      setItems(res.items);
      setError(null);
    } catch (err) {
      setError(err);
    }
  }, [printType]);

  useEffect(() => {
    load();
  }, [load]);

  useJoinRfqRooms(useMemo(() => (items || []).map((i) => i._id), [items]));
  useLiveRfqItems(setItems);

  useSocketEvent('rfq:new', (p) => {
    if (!p.rfq || (printType && p.rfq.designSpecs.printType !== printType)) return;
    setItems((list) => (list && !list.some((i) => i._id === p.rfq._id) ? [{ ...p.rfq, myBid: null, rank: null, totalBids: p.rfq.bidCount }, ...list] : list));
    setNewIds((s) => new Set(s).add(p.rfq._id));
  });

  const visible = (items || []).filter((i) => (filter === 'open' ? !i.rank : filter === 'mine' ? Boolean(i.rank) : true));
  const counts = { all: items?.length || 0, open: items?.filter((i) => !i.rank).length || 0, mine: items?.filter((i) => i.rank).length || 0 };
  const current = bidding ? items?.find((i) => i._id === bidding) : null;

  return (
    <div>
      <PageHeader
        title="Live RFQs"
        subtitle={`Open auctions matching your capabilities (${status?.capabilities?.join(', ')}) and capacity (up to ${status?.maxCapacity} pcs).`}
        actions={
          <Badge tone="green" icon={Radio} className="px-3 py-1 text-sm">
            Live feed
          </Badge>
        }
      />

      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <Tabs
          tabs={[
            { value: 'all', label: 'All eligible', count: counts.all },
            { value: 'open', label: 'Not yet bid', count: counts.open },
            { value: 'mine', label: 'My active bids', count: counts.mine },
          ]}
          value={filter}
          onChange={setFilter}
        />
        <div className="flex flex-wrap gap-2">
          {['', ...(status?.capabilities || [])].map((p) => (
            <button
              key={p || 'all'}
              type="button"
              onClick={() => setPrintType(p)}
              className={cx('rounded-full border px-3 py-1 text-xs font-medium', printType === p ? 'border-brand-500 bg-brand-50 text-brand-700' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50')}
            >
              {p || 'All print types'}
            </button>
          ))}
        </div>
      </div>

      {error && <ErrorList error={error} />}
      {!items && !error ? (
        <Spinner className="py-16" label="Loading eligible auctions…" />
      ) : visible.length === 0 ? (
        <EmptyState
          icon={Radio}
          title={filter === 'mine' ? 'No active bids' : 'No open RFQs right now'}
          description="New RFQs that match your capabilities appear here instantly. You'll also get a notification."
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {visible.map((rfq) => (
            <VendorRfqCard key={rfq._id} rfq={rfq} isNew={newIds.has(rfq._id)} onBid={(r) => setBidding(r._id)} />
          ))}
        </div>
      )}

      <BidModal
        open={Boolean(current)}
        onClose={() => setBidding(null)}
        rfq={current}
        myBid={current?.myBid}
        rank={current?.rank}
        totalBids={current?.totalBids}
        onPlaced={(res) =>
          setItems((list) => list.map((i) => (i._id === res.rfqId ? { ...i, myBid: res.myBid, rank: res.rank, totalBids: res.totalBids, rankLabel: res.rankLabel, bidCount: res.totalBids, expiresAt: res.expiresAt } : i)))
        }
      />
    </div>
  );
}
