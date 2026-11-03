import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Crown, History, RefreshCw, Trophy, XCircle } from 'lucide-react';
import { vendorApi } from '../../api/client';
import { useSocketEvents } from '../../context/SocketContext';
import useAsync from '../../hooks/useAsync';
import { Badge, Card, EmptyState, ErrorList, PageHeader, Spinner, StatCard, StatusBadge, Tabs } from '../../components/ui';
import { formatLKR, formatRelative } from '../../utils/format';

function Outcome({ item }) {
  const { myBid, rank, totalBids, rfq } = item;
  if (myBid.status === 'ACCEPTED') return <Badge tone="green" icon={Trophy}>Won</Badge>;
  if (myBid.status === 'REJECTED') return <Badge tone="slate" icon={XCircle}>Not selected</Badge>;
  if (rfq.status === 'CANCELLED') return <Badge tone="slate">RFQ cancelled</Badge>;
  if (rank === 1) return <Badge tone="amber" icon={Crown}>Leading · #1 of {totalBids}</Badge>;
  return <Badge tone="blue">#{rank} of {totalBids}</Badge>;
}

const FILTERS = {
  all: () => true,
  active: (i) => i.rfq.status === 'OPEN',
  pending: (i) => i.rfq.status === 'CLOSED',
  won: (i) => i.myBid.status === 'ACCEPTED',
  lost: (i) => i.myBid.status === 'REJECTED' || ['CANCELLED', 'EXPIRED'].includes(i.rfq.status),
};

export default function MyBids() {
  const [filter, setFilter] = useState('all');
  const { data, error, loading, reload } = useAsync(() => vendorApi.bids({ limit: 100 }), []);
  useSocketEvents(['auction:rank', 'auction:awarded', 'auction:lost', 'auction:ended', 'auction:closed'], () => reload({ silent: true }));

  if (loading && !data) return <Spinner className="py-24" />;
  if (error) return <ErrorList error={error} />;

  const items = data.items;
  const won = items.filter(FILTERS.won).length;
  const decided = items.filter((i) => ['ACCEPTED', 'REJECTED'].includes(i.myBid.status)).length;
  const revisions = items.reduce((s, i) => s + (i.myBid.revisionCount || 0), 0);
  const visible = items.filter(FILTERS[filter]);

  return (
    <div>
      <PageHeader title="My bids" subtitle="Your bidding history. You only ever see your own prices and ranks." />
      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Total bids" value={items.length} icon={History} />
        <StatCard label="Active" value={items.filter(FILTERS.active).length} icon={Crown} tone="amber" />
        <StatCard label="Won" value={won} icon={Trophy} tone="green" hint={decided ? `${Math.round((won / decided) * 100)}% win rate` : undefined} />
        <StatCard label="Re-bids" value={revisions} icon={RefreshCw} tone="violet" hint="Multi-round revisions" />
      </div>
      <div className="mb-4">
        <Tabs
          tabs={[
            { value: 'all', label: 'All' },
            { value: 'active', label: 'Live' },
            { value: 'pending', label: 'Awaiting buyer' },
            { value: 'won', label: 'Won' },
            { value: 'lost', label: 'Closed' },
          ]}
          value={filter}
          onChange={setFilter}
        />
      </div>
      {visible.length === 0 ? (
        <EmptyState icon={History} title="No bids here" description="Bids you place on live RFQs appear in this list." />
      ) : (
        <Card className="overflow-hidden">
          <ul className="divide-y divide-slate-100">
            {visible.map((item) => (
              <li key={item.myBid.bidId}>
                <Link
                  to={`/vendor/rfqs/${item.rfq._id}`}
                  className="grid gap-2 px-5 py-4 hover:bg-slate-50 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_auto] md:items-center md:gap-4"
                >
                  <div className="min-w-0">
                    <p className="truncate font-semibold text-slate-900">{item.rfq.title}</p>
                    <p className="truncate text-sm text-slate-500">
                      <span className="font-mono">{item.rfq.rfqCode}</span> · {item.rfq.designSpecs.totalQuantity} pcs {item.rfq.designSpecs.printType}
                    </p>
                  </div>
                  <div className="text-sm">
                    <p className="font-mono font-semibold text-slate-900">{formatLKR(item.myBid.price)}</p>
                    <p className="text-slate-500">
                      {item.myBid.leadTimeDays} days{item.myBid.revisionCount ? ` · ${item.myBid.revisionCount} re-bid(s)` : ''}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    <StatusBadge status={item.rfq.status} />
                  </div>
                  <div className="flex flex-col items-start gap-1 md:items-end">
                    <Outcome item={item} />
                    <span className="text-xs text-slate-400">{formatRelative(item.myBid.lastSubmittedAt)}</span>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
