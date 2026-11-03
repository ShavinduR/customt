import { useState } from 'react';
import { ChevronDown, ChevronUp, Gavel, Hourglass, Radio, User } from 'lucide-react';
import { adminApi } from '../../api/client';
import { useSocketEvent, useSocketEvents } from '../../context/SocketContext';
import { useCatalog } from '../../context/CatalogContext';
import useAsync from '../../hooks/useAsync';
import Leaderboard, { ScoreLegend } from '../../components/auction/Leaderboard';
import PriceDiagnosticAlert from '../../components/auction/PriceDiagnosticAlert';
import TShirtPreview from '../../components/configurator/TShirtPreview';
import { Badge, Card, Countdown, EmptyState, ErrorList, PageHeader, Spinner, StatCard, Tabs } from '../../components/ui';
import { formatLKR } from '../../utils/format';

function AuctionMonitorCard({ item, softCloseMs }) {
  const [open, setOpen] = useState(item.priceDiagnostic?.highVariance || false);
  const { rfq, leaderboard } = item;
  const specs = rfq.designSpecs;
  const best = leaderboard[0];

  return (
    <Card className="overflow-hidden">
      <button type="button" onClick={() => setOpen((v) => !v)} className="flex w-full items-center gap-4 p-4 text-left hover:bg-slate-50" aria-expanded={open}>
        <div className="w-14 shrink-0 rounded-lg bg-slate-50 p-1">
          <TShirtPreview specs={specs} view={specs.printPlacement === 'BACK' ? 'back' : 'front'} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-xs text-slate-400">{rfq.rfqCode}</span>
            {item.priceDiagnostic?.highVariance && <Badge tone="amber">High price variance</Badge>}
            {rfq.extensionCount > 0 && (
              <Badge tone="slate" icon={Hourglass}>
                Extended ×{rfq.extensionCount}
              </Badge>
            )}
          </div>
          <p className="truncate font-semibold text-slate-900">{rfq.title}</p>
          <p className="truncate text-sm text-slate-500">
            <User className="mr-1 inline h-3.5 w-3.5" />
            {rfq.buyerId?.name || 'Buyer'} · {specs.totalQuantity} pcs {specs.printType} · {rfq.eligibleVendorCount} eligible vendor(s)
          </p>
        </div>
        <div className="hidden text-right sm:block">
          <Countdown expiresAt={rfq.expiresAt} softCloseMs={softCloseMs} compact />
          <p className="text-xs text-slate-500">
            {leaderboard.length} bid(s){best ? ` · #1 ${formatLKR(best.price)}` : ''}
          </p>
        </div>
        {open ? <ChevronUp className="h-5 w-5 text-slate-400" /> : <ChevronDown className="h-5 w-5 text-slate-400" />}
      </button>
      {open && (
        <div className="space-y-3 border-t border-slate-100 p-4">
          <PriceDiagnosticAlert diagnostic={item.priceDiagnostic} />
          {leaderboard.length === 0 ? (
            <p className="py-6 text-center text-sm text-slate-500">No bids yet.</p>
          ) : (
            <>
              <ScoreLegend />
              <Leaderboard entries={leaderboard} canAccept={false} quantity={specs.totalQuantity} />
            </>
          )}
        </div>
      )}
    </Card>
  );
}

export default function LiveAuctions() {
  const { catalog } = useCatalog();
  const [filter, setFilter] = useState('all');
  const { data, error, loading, reload, setData } = useAsync(() => adminApi.liveAuctions(), []);

  useSocketEvent('auction:leaderboard', (p) =>
    setData((d) =>
      d
        ? {
            ...d,
            items: d.items
              .map((it) => (it.rfq._id === p.rfqId ? { ...it, leaderboard: p.leaderboard, priceDiagnostic: p.priceDiagnostic, rfq: { ...it.rfq, expiresAt: p.expiresAt, extensionCount: p.extensionCount, bidCount: p.bidCount, status: p.status } } : it))
              .filter((it) => it.rfq.status === 'OPEN'),
          }
        : d
    )
  );
  useSocketEvents(['rfq:new', 'auction:ended', 'auction:closed', 'order:created'], () => reload({ silent: true }));

  const items = data?.items || [];
  const visible = items.filter((i) => (filter === 'variance' ? i.priceDiagnostic?.highVariance : filter === 'nobids' ? i.leaderboard.length === 0 : true));
  const totalBids = items.reduce((s, i) => s + i.leaderboard.length, 0);

  return (
    <div>
      <PageHeader
        title="Live auction monitor"
        subtitle="Full leaderboards for every open reverse auction, updated in real time."
        actions={
          <Badge tone="green" icon={Radio} className="px-3 py-1 text-sm">
            Live
          </Badge>
        }
      />
      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Open auctions" value={items.length} icon={Gavel} tone="green" />
        <StatCard label="Bids in play" value={totalBids} icon={Gavel} />
        <StatCard label="High-variance auctions" value={items.filter((i) => i.priceDiagnostic?.highVariance).length} icon={Gavel} tone="amber" hint="CV > 0.35 with 3+ bids" />
        <StatCard label="Waiting for first bid" value={items.filter((i) => i.leaderboard.length === 0).length} icon={Hourglass} tone="violet" />
      </div>
      <div className="mb-4">
        <Tabs
          tabs={[
            { value: 'all', label: 'All live' },
            { value: 'variance', label: 'Price variance flagged' },
            { value: 'nobids', label: 'No bids yet' },
          ]}
          value={filter}
          onChange={setFilter}
        />
      </div>
      {error && <ErrorList error={error} />}
      {loading && !data ? (
        <Spinner className="py-16" />
      ) : visible.length === 0 ? (
        <EmptyState icon={Radio} title="No auctions match" description="Newly launched RFQs appear here instantly." />
      ) : (
        <div className="space-y-3">
          {visible.map((item) => (
            <AuctionMonitorCard key={item.rfq._id} item={item} softCloseMs={catalog?.auction?.softCloseWindowMs} />
          ))}
        </div>
      )}
    </div>
  );
}
