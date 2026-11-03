import { Link } from 'react-router-dom';
import { AlertTriangle, Download, Gavel, Hourglass, Percent, RefreshCw, Scale, Star, TrendingDown, Wallet } from 'lucide-react';
import { adminApi } from '../../api/client';
import useAsync from '../../hooks/useAsync';
import { BarList, ChartCard, ColumnChart, DataTable, Legend, RangeDotChart, SERIES } from '../../components/charts';
import { Badge, Button, Card, CardHeader, ErrorList, PageHeader, PageLoader, StatCard, StatusBadge, TrustStars } from '../../components/ui';
import { formatLKR, formatLKRCompact, formatNumber, formatDate } from '../../utils/format';
import { statusMeta } from '../../utils/status';

/** Last `n` calendar months as YYYY-MM, oldest first, so gaps show as zero instead of disappearing. */
export function lastMonths(n = 6) {
  const out = [];
  const d = new Date();
  d.setDate(1);
  for (let i = n - 1; i >= 0; i -= 1) {
    const m = new Date(d.getFullYear(), d.getMonth() - i, 1);
    out.push(`${m.getFullYear()}-${String(m.getMonth() + 1).padStart(2, '0')}`);
  }
  return out;
}

export function trendRows(monthlyTrend) {
  const byMonth = new Map(monthlyTrend.map((m) => [m.month, m]));
  return lastMonths(6).map((month) => {
    const m = byMonth.get(month) || { rfqs: 0, awarded: 0, pieces: 0 };
    const label = new Date(`${month}-01T00:00:00`).toLocaleString('en', { month: 'short' });
    return { month, label, rfqs: m.rfqs, awarded: m.awarded, pieces: m.pieces };
  });
}

export const TREND_SERIES = [
  { key: 'rfqs', label: 'RFQs launched', color: SERIES[0] },
  { key: 'awarded', label: 'RFQs awarded', color: SERIES[1] },
];

function toCsv(report) {
  const lines = [['Section', 'Metric', 'Value']];
  Object.entries(report.escrow).forEach(([k, v]) => lines.push(['Escrow', k, v]));
  Object.entries(report.auctionEfficiency).forEach(([k, v]) => lines.push(['Auction efficiency', k, v]));
  Object.entries(report.quality).forEach(([k, v]) => lines.push(['Quality', k, v]));
  lines.push([]);
  lines.push(['Print type', 'Avg unit price', 'Min unit price', 'Max unit price', 'Orders', 'Pieces']);
  report.unitPriceByPrintType.forEach((p) => lines.push([p.printType, p.avgUnitPrice, p.minUnitPrice, p.maxUnitPrice, p.orders, p.pieces]));
  lines.push([]);
  lines.push(['Month', 'RFQs', 'Awarded', 'Pieces']);
  trendRows(report.monthlyTrend).forEach((m) => lines.push([m.month, m.rfqs, m.awarded, m.pieces]));
  return lines.map((row) => row.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
}

function download(report) {
  const blob = new Blob([toCsv(report)], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `customt-market-intelligence-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export default function Analytics() {
  const { data, error, loading, reload } = useAsync(() => adminApi.analytics(), []);
  if (loading && !data) return <PageLoader label="Crunching marketplace data…" />;
  if (error) return <ErrorList error={error} />;

  const r = data;
  const trend = trendRows(r.monthlyTrend);
  const totalRfqs = Object.values(r.rfqs).reduce((s, v) => s + v, 0);
  const awardRate = totalRfqs ? Math.round(((r.rfqs.AWARDED || 0) / totalRfqs) * 100) : 0;
  const priceRows = r.unitPriceByPrintType.map((p) => ({ label: p.printType, min: p.minUnitPrice, avg: p.avgUnitPrice, max: p.maxUnitPrice, hint: `${p.orders} order(s) · ${formatNumber(p.pieces)} pcs` }));
  const orderStatusItems = ['PENDING_ESCROW', 'IN_PROGRESS', 'AWAITING_O2O', 'DISPUTED', 'COMPLETED', 'REFUNDED', 'CANCELLED'].map((s) => ({ label: statusMeta(s).label, value: r.orders[s] || 0 }));
  const rfqStatusItems = ['OPEN', 'CLOSED', 'AWARDED', 'EXPIRED', 'CANCELLED'].map((s) => ({ label: statusMeta(s).label, value: r.rfqs[s] || 0 }));

  return (
    <div>
      <PageHeader
        title="Market intelligence"
        subtitle={`Price discovery, auction efficiency and trust across the marketplace · generated ${formatDate(r.generatedAt)}`}
        actions={
          <>
            <Button variant="secondary" icon={RefreshCw} onClick={() => reload()}>
              Refresh
            </Button>
            <Button icon={Download} onClick={() => download(r)}>
              Export CSV
            </Button>
          </>
        }
      />

      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Gross merchandise value" value={formatLKRCompact(r.escrow.gmv)} icon={Wallet} hint={`${r.escrow.paidOrders} escrow-funded order(s)`} />
        <StatCard label="Price discovery savings" value={`${r.auctionEfficiency.avgPriceDiscoverySavingsPct}%`} icon={TrendingDown} tone="green" hint="Accepted price vs highest bid" />
        <StatCard label="Award rate" value={`${awardRate}%`} icon={Gavel} tone="violet" hint={`${r.rfqs.AWARDED || 0} of ${totalRfqs} RFQs`} />
        <StatCard label="Dispute rate" value={`${r.quality.disputeRatePct}%`} icon={Scale} tone={r.quality.disputeRatePct > 10 ? 'red' : 'amber'} hint={`${r.escrow.frozenOrders} escrow(s) frozen now`} />
        <StatCard label="Avg bids per RFQ" value={r.auctionEfficiency.avgBidsPerRfq} icon={Gavel} hint={`${r.auctionEfficiency.avgRevisionsPerRfq} re-bids per RFQ`} />
        <StatCard label="Soft-close extensions" value={r.auctionEfficiency.softCloseExtensions} icon={Hourglass} hint={`${r.auctionEfficiency.rfqsExtended} auction(s) extended`} />
        <StatCard label="Spec-ambiguity flags" value={r.auctionEfficiency.highVarianceRfqCount} icon={AlertTriangle} tone="amber" hint="Bid price CV > 0.35" />
        <StatCard label="Avg buyer rating" value={r.quality.ratingsCount ? `${r.quality.avgBuyerRating} / 5` : '—'} icon={Star} tone="amber" hint={`${r.quality.ratingsCount} rating(s)`} />
      </div>

      <div className="mb-6 grid gap-6 xl:grid-cols-2">
        <ChartCard
          title="Procurement demand"
          subtitle="RFQs launched vs awarded, last 6 months"
          legend={<Legend series={TREND_SERIES} />}
          table={<DataTable columns={[{ key: 'month', label: 'Month' }, { key: 'rfqs', label: 'Launched', align: 'right' }, { key: 'awarded', label: 'Awarded', align: 'right' }, { key: 'pieces', label: 'Pieces', align: 'right', format: (v) => formatNumber(v) }]} rows={trend} />}
        >
          <ColumnChart data={trend} series={TREND_SERIES} />
        </ChartCard>

        <ChartCard
          title="Unit price by print method"
          subtitle="Average accepted price per piece, with the min–max range"
          table={
            <DataTable
              columns={[
                { key: 'printType', label: 'Print method' },
                { key: 'avgUnitPrice', label: 'Avg', align: 'right', format: formatLKR },
                { key: 'minUnitPrice', label: 'Min', align: 'right', format: formatLKR },
                { key: 'maxUnitPrice', label: 'Max', align: 'right', format: formatLKR },
                { key: 'orders', label: 'Orders', align: 'right' },
              ]}
              rows={r.unitPriceByPrintType}
            />
          }
        >
          {priceRows.length ? <RangeDotChart rows={priceRows} formatValue={(v) => formatLKR(v).replace('.00', '')} /> : <p className="py-10 text-center text-sm text-slate-500">No orders yet.</p>}
        </ChartCard>
      </div>

      <div className="mb-6 grid gap-6 lg:grid-cols-2">
        <ChartCard title="Orders by status" table={<DataTable columns={[{ key: 'label', label: 'Status' }, { key: 'value', label: 'Orders', align: 'right' }]} rows={orderStatusItems} />}>
          <BarList items={orderStatusItems} />
        </ChartCard>
        <ChartCard title="RFQs by status" table={<DataTable columns={[{ key: 'label', label: 'Status' }, { key: 'value', label: 'RFQs', align: 'right' }]} rows={rfqStatusItems} />}>
          <BarList items={rfqStatusItems} />
        </ChartCard>
      </div>

      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <StatCard label="Escrow currently held" value={formatLKR(r.escrow.currentlyHeld)} icon={Wallet} tone="amber" />
        <StatCard label="Released to vendors" value={formatLKR(r.escrow.releasedToVendors)} icon={Wallet} tone="green" />
        <StatCard label="Refunded to buyers" value={formatLKR(r.escrow.refundedToBuyers)} icon={Percent} tone="violet" />
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader title="Top vendors by trust" subtitle={`${r.vendors.verified} verified of ${r.vendors.total} · average trust ${r.vendors.avgTrust} · ${formatNumber(r.vendors.totalCapacity)} pcs combined capacity`} />
          <ul className="divide-y divide-slate-100">
            {r.topVendors.map((v, i) => (
              <li key={v._id} className="flex items-center gap-3 px-5 py-3">
                <span className="w-6 font-mono text-sm text-slate-400">{i + 1}</span>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-slate-900">{v.companyName}</p>
                  <div className="flex flex-wrap gap-1">
                    {v.skillBadges.map((b) => (
                      <Badge key={b} tone="violet">
                        {b}
                      </Badge>
                    ))}
                  </div>
                </div>
                <div className="text-right">
                  <TrustStars score={v.trustScore} />
                  <p className="text-xs text-slate-500">{v.ratingCount} rating(s)</p>
                </div>
              </li>
            ))}
            {r.topVendors.length === 0 && <li className="px-5 py-8 text-center text-sm text-slate-500">No verified vendors yet.</li>}
          </ul>
        </Card>
        <Card>
          <CardHeader icon={AlertTriangle} title="Specification ambiguity watchlist" subtitle="RFQs whose bid prices diverged sharply (CV > 0.35)" />
          <ul className="divide-y divide-slate-100">
            {r.highVarianceRfqs.map((q) => (
              <li key={q._id} className="flex items-center justify-between gap-3 px-5 py-3">
                <div className="min-w-0">
                  <p className="truncate font-medium text-slate-900">{q.title}</p>
                  <p className="text-sm text-slate-500">
                    <span className="font-mono">{q.rfqCode}</span> · {q.designSpecs?.totalQuantity} pcs {q.designSpecs?.printType}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span className="font-mono text-sm font-semibold text-amber-700">CV {q.priceDiagnostic.coefficientOfVariation?.toFixed(2)}</span>
                  <StatusBadge status={q.status} />
                </div>
              </li>
            ))}
            {r.highVarianceRfqs.length === 0 && <li className="px-5 py-8 text-center text-sm text-slate-500">No ambiguity flags. Specifications are being read consistently.</li>}
          </ul>
          {r.highVarianceRfqs.length > 0 && (
            <p className="border-t border-slate-100 px-5 py-3 text-xs text-slate-500">
              Tip: recurring flags for one print method suggest the configurator needs clearer options. See the{' '}
              <Link to="/admin/auctions" className="text-brand-700 underline">
                live monitor
              </Link>
              .
            </p>
          )}
        </Card>
      </div>
    </div>
  );
}
