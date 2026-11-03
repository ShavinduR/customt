import { Link } from 'react-router-dom';
import { AlertTriangle, ArrowRight, BarChart3, Gavel, Lock, Scale, ShieldCheck, TrendingDown, Users, Wallet } from 'lucide-react';
import { adminApi } from '../../api/client';
import { useSocketEvents } from '../../context/SocketContext';
import useAsync from '../../hooks/useAsync';
import { ChartCard, ColumnChart, DataTable, Legend } from '../../components/charts';
import { TREND_SERIES, trendRows } from './Analytics';
import { Card, CardHeader, Countdown, ErrorList, PageHeader, PageLoader, StatCard } from '../../components/ui';
import { formatLKR, formatLKRCompact, formatRelative, titleCase } from '../../utils/format';

const LIVE = ['vendor:registered', 'dispute:new', 'dispute:resolved', 'rfq:new', 'auction:ended', 'auction:closed', 'order:created', 'order:completed'];

export default function AdminOverview() {
  const { data, error, loading, reload } = useAsync(async () => {
    const [analytics, pending, disputes, auctions] = await Promise.all([
      adminApi.analytics(),
      adminApi.vendors({ status: 'pending', limit: 5 }),
      adminApi.disputes('open'),
      adminApi.liveAuctions(),
    ]);
    return { analytics, pending, disputes: disputes.items, auctions: auctions.items };
  }, []);
  useSocketEvents(LIVE, () => reload({ silent: true }));

  if (loading && !data) return <PageLoader />;
  if (error) return <ErrorList error={error} />;
  const { analytics: a, pending, disputes, auctions } = data;
  const trend = trendRows(a.monthlyTrend);
  const flagged = auctions.filter((x) => x.priceDiagnostic?.highVariance);

  return (
    <div>
      <PageHeader title="Platform overview" subtitle="Prequalification, live auctions, escrow and disputes at a glance." />

      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-3 xl:grid-cols-6">
        <StatCard label="GMV" value={formatLKRCompact(a.escrow.gmv)} icon={Wallet} />
        <StatCard label="Held in escrow" value={formatLKRCompact(a.escrow.currentlyHeld)} icon={Lock} tone="amber" />
        <StatCard label="Live auctions" value={auctions.length} icon={Gavel} tone="green" />
        <StatCard label="Pending vendors" value={pending.total} icon={ShieldCheck} tone="violet" />
        <StatCard label="Open disputes" value={disputes.length} icon={Scale} tone="red" />
        <StatCard label="Savings vs highest bid" value={`${a.auctionEfficiency.avgPriceDiscoverySavingsPct}%`} icon={TrendingDown} tone="green" />
      </div>

      <div className="mb-6 grid gap-6 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <ChartCard
          title="Procurement demand"
          subtitle="RFQs launched vs awarded, last 6 months"
          legend={<Legend series={TREND_SERIES} />}
          table={<DataTable columns={[{ key: 'month', label: 'Month' }, { key: 'rfqs', label: 'Launched', align: 'right' }, { key: 'awarded', label: 'Awarded', align: 'right' }]} rows={trend} />}
        >
          <ColumnChart data={trend} series={TREND_SERIES} height={220} />
        </ChartCard>

        <Card>
          <CardHeader
            icon={ShieldCheck}
            title="Vendors awaiting verification"
            action={
              <Link to="/admin/vendors?status=pending" className="text-sm font-medium text-brand-700 hover:underline">
                Review all
              </Link>
            }
          />
          <ul className="divide-y divide-slate-100">
            {pending.items.map((v) => (
              <li key={v._id}>
                <Link to="/admin/vendors?status=pending" className="flex items-center justify-between gap-3 px-5 py-3 hover:bg-slate-50">
                  <span className="min-w-0">
                    <span className="block truncate font-medium text-slate-900">{v.companyName}</span>
                    <span className="block truncate text-sm text-slate-500">
                      {v.capabilities.join(', ')} · up to {v.maxCapacity} pcs · {formatRelative(v.createdAt)}
                    </span>
                  </span>
                  <ArrowRight className="h-4 w-4 shrink-0 text-slate-400" />
                </Link>
              </li>
            ))}
            {pending.items.length === 0 && <li className="px-5 py-10 text-center text-sm text-slate-500">All vendors are reviewed.</li>}
          </ul>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader
            icon={Scale}
            title="Open disputes"
            action={
              <Link to="/admin/disputes" className="text-sm font-medium text-brand-700 hover:underline">
                Dispute centre
              </Link>
            }
          />
          <ul className="divide-y divide-slate-100">
            {disputes.slice(0, 5).map((o) => (
              <li key={o._id}>
                <Link to={`/admin/orders/${o._id}`} className="flex items-center justify-between gap-3 px-5 py-3 hover:bg-slate-50">
                  <span className="min-w-0">
                    <span className="block truncate font-medium text-slate-900">
                      {o.orderCode} · {titleCase(o.dispute?.category)}
                    </span>
                    <span className="block truncate text-sm text-slate-500">
                      {o.buyerId?.name} vs {o.vendorId?.companyName} · raised {formatRelative(o.dispute?.raisedAt)}
                    </span>
                  </span>
                  <span className="shrink-0 font-mono text-sm font-semibold text-red-600">{formatLKR(o.escrowHeld)}</span>
                </Link>
              </li>
            ))}
            {disputes.length === 0 && <li className="px-5 py-10 text-center text-sm text-slate-500">No disputes need mediation.</li>}
          </ul>
        </Card>

        <Card>
          <CardHeader
            icon={AlertTriangle}
            title="Live auctions needing attention"
            subtitle="High price variance suggests an ambiguous specification"
            action={
              <Link to="/admin/auctions" className="text-sm font-medium text-brand-700 hover:underline">
                Monitor
              </Link>
            }
          />
          <ul className="divide-y divide-slate-100">
            {(flagged.length ? flagged : auctions).slice(0, 5).map(({ rfq, leaderboard, priceDiagnostic }) => (
              <li key={rfq._id}>
                <Link to="/admin/auctions" className="flex items-center justify-between gap-3 px-5 py-3 hover:bg-slate-50">
                  <span className="min-w-0">
                    <span className="block truncate font-medium text-slate-900">{rfq.title}</span>
                    <span className="block truncate text-sm text-slate-500">
                      {leaderboard.length} bid(s){priceDiagnostic?.highVariance ? ` · CV ${priceDiagnostic.coefficientOfVariation.toFixed(2)}` : ''}
                    </span>
                  </span>
                  <Countdown expiresAt={rfq.expiresAt} compact />
                </Link>
              </li>
            ))}
            {auctions.length === 0 && <li className="px-5 py-10 text-center text-sm text-slate-500">No live auctions right now.</li>}
          </ul>
        </Card>
      </div>

      <p className="mt-6 flex items-center gap-2 text-sm text-slate-500">
        <Users className="h-4 w-4" /> {a.users.buyer || 0} buyers · {a.users.vendor || 0} vendors ·{' '}
        <Link to="/admin/analytics" className="inline-flex items-center gap-1 font-medium text-brand-700 hover:underline">
          <BarChart3 className="h-4 w-4" /> Full market intelligence
        </Link>
      </p>
    </div>
  );
}
