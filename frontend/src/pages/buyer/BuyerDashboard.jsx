import { Link, useNavigate } from 'react-router-dom';
import { ArrowRight, Gavel, Hourglass, Package, PencilRuler, ScanSearch, Sparkles, Wallet } from 'lucide-react';
import { orderApi, rfqApi } from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import { useSocketEvents } from '../../context/SocketContext';
import useAsync from '../../hooks/useAsync';
import TShirtPreview from '../../components/configurator/TShirtPreview';
import { Button, Card, CardHeader, Countdown, EmptyState, ErrorList, PageHeader, PageLoader, StatCard, StatusBadge } from '../../components/ui';
import { formatLKR, formatRelative } from '../../utils/format';

const LIVE_EVENTS = ['auction:leaderboard', 'auction:ended', 'auction:closed', 'order:created', 'order:updated', 'order:completed', 'o2o:ready', 'dispute:resolved'];

const ORDER_ACTION = {
  PENDING_ESCROW: 'Fund escrow',
  AWAITING_O2O: 'Inspect & verify',
  DISPUTED: 'View dispute',
};

export function RfqCard({ rfq }) {
  const navigate = useNavigate();
  return (
    <button type="button" onClick={() => navigate(`/buyer/rfqs/${rfq._id}`)} className="flex w-full gap-4 rounded-xl border border-slate-200 bg-white p-3 text-left transition hover:border-brand-300 hover:shadow-sm">
      <div className="w-20 shrink-0 rounded-lg bg-slate-50 p-1">
        <TShirtPreview specs={rfq.designSpecs} view={rfq.designSpecs.printPlacement === 'BACK' ? 'back' : 'front'} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge status={rfq.status} />
          <span className="font-mono text-xs text-slate-400">{rfq.rfqCode}</span>
        </div>
        <p className="mt-1 truncate font-semibold text-slate-900">{rfq.title}</p>
        <p className="truncate text-sm text-slate-500">
          {rfq.designSpecs.totalQuantity} pcs · {rfq.designSpecs.garmentType} · {rfq.designSpecs.printType}
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
          <span className="flex items-center gap-1">
            <Gavel className="h-3.5 w-3.5" /> {rfq.bidCount} bid{rfq.bidCount === 1 ? '' : 's'}
          </span>
          {rfq.status === 'OPEN' ? (
            <span className="flex items-center gap-1">
              <Hourglass className="h-3.5 w-3.5" /> <Countdown expiresAt={rfq.expiresAt} compact />
            </span>
          ) : (
            <span>Updated {formatRelative(rfq.updatedAt)}</span>
          )}
        </div>
      </div>
    </button>
  );
}

export default function BuyerDashboard() {
  const { user, refreshUser } = useAuth();
  const navigate = useNavigate();
  const { data, error, loading, reload } = useAsync(async () => {
    const [rfqs, orders] = await Promise.all([rfqApi.list({ limit: 50 }), orderApi.list({ limit: 50 })]);
    return { rfqs: rfqs.items, orders: orders.items };
  }, []);

  useSocketEvents(LIVE_EVENTS, (_payload, event) => {
    reload({ silent: true });
    if (event === 'dispute:resolved') refreshUser().catch(() => {});
  });

  if (loading && !data) return <PageLoader />;
  if (error) return <ErrorList error={error} />;

  const { rfqs, orders } = data;
  const live = rfqs.filter((r) => r.status === 'OPEN');
  const awaitingDecision = rfqs.filter((r) => r.status === 'CLOSED');
  const activeOrders = orders.filter((o) => ['PENDING_ESCROW', 'IN_PROGRESS', 'AWAITING_O2O', 'DISPUTED'].includes(o.orderStatus));
  const needsAction = activeOrders.filter((o) => ORDER_ACTION[o.orderStatus]);
  const escrowHeld = orders.reduce((sum, o) => sum + (o.escrowHeld || 0), 0);

  return (
    <div>
      <PageHeader
        title={`Welcome back, ${user.name.split(' ')[0]}`}
        subtitle="Design custom apparel, let verified printers compete, and pay safely through escrow."
        actions={
          <Button size="lg" icon={PencilRuler} onClick={() => navigate('/buyer/rfqs/new')}>
            Design & launch RFQ
          </Button>
        }
      />

      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Live auctions" value={live.length} icon={Gavel} tone="green" hint={`${live.reduce((s, r) => s + r.bidCount, 0)} bids received`} />
        <StatCard label="Awaiting your decision" value={awaitingDecision.length} icon={Hourglass} tone="amber" hint="Closed auctions to award" />
        <StatCard label="Active orders" value={activeOrders.length} icon={Package} tone="brand" hint={`${formatLKR(escrowHeld)} held in escrow`} />
        <StatCard label="Wallet (refunds)" value={formatLKR(user.walletBalance || 0)} icon={Wallet} tone="violet" />
      </div>

      {(needsAction.length > 0 || awaitingDecision.length > 0) && (
        <Card className="mb-6 border-amber-200 bg-amber-50/40">
          <CardHeader icon={Sparkles} title="Needs your attention" />
          <ul className="divide-y divide-amber-100">
            {awaitingDecision.map((r) => (
              <li key={r._id}>
                <Link to={`/buyer/rfqs/${r._id}`} className="flex items-center justify-between gap-3 px-5 py-3 hover:bg-amber-50">
                  <span className="min-w-0">
                    <span className="block truncate font-medium text-slate-900">{r.title}</span>
                    <span className="text-sm text-slate-500">
                      {r.bidCount} bids ready. Choose a winner.
                    </span>
                  </span>
                  <span className="flex shrink-0 items-center gap-1 text-sm font-semibold text-amber-800">
                    Review bids <ArrowRight className="h-4 w-4" />
                  </span>
                </Link>
              </li>
            ))}
            {needsAction.map((o) => (
              <li key={o._id}>
                <Link to={`/buyer/orders/${o._id}`} className="flex items-center justify-between gap-3 px-5 py-3 hover:bg-amber-50">
                  <span className="min-w-0">
                    <span className="block truncate font-medium text-slate-900">{o.specSnapshot?.title}</span>
                    <span className="text-sm text-slate-500">
                      {o.orderCode} · {formatLKR(o.agreedPrice)}
                    </span>
                  </span>
                  <span className="flex shrink-0 items-center gap-1 text-sm font-semibold text-amber-800">
                    {o.orderStatus === 'AWAITING_O2O' && <ScanSearch className="h-4 w-4" />}
                    {ORDER_ACTION[o.orderStatus]} <ArrowRight className="h-4 w-4" />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader
            icon={Gavel}
            title="Live auctions"
            action={
              <Link to="/buyer/rfqs" className="text-sm font-medium text-brand-700 hover:underline">
                View all
              </Link>
            }
          />
          <div className="space-y-3 p-4">
            {live.length === 0 ? (
              <EmptyState
                icon={PencilRuler}
                title="No live auctions"
                description="Design a T-shirt and launch a reverse auction. Prequalified printers will compete for your order."
                action={
                  <Button size="sm" onClick={() => navigate('/buyer/rfqs/new')}>
                    Start designing
                  </Button>
                }
              />
            ) : (
              live.slice(0, 4).map((r) => <RfqCard key={r._id} rfq={r} />)
            )}
          </div>
        </Card>

        <Card>
          <CardHeader
            icon={Package}
            title="Recent orders"
            action={
              <Link to="/buyer/orders" className="text-sm font-medium text-brand-700 hover:underline">
                View all
              </Link>
            }
          />
          <div className="p-4">
            {orders.length === 0 ? (
              <EmptyState icon={Package} title="No orders yet" description="When you accept a bid, the order and its escrow appear here." />
            ) : (
              <ul className="divide-y divide-slate-100">
                {orders.slice(0, 6).map((o) => (
                  <li key={o._id}>
                    <Link to={`/buyer/orders/${o._id}`} className="flex items-center justify-between gap-3 rounded-lg px-2 py-3 hover:bg-slate-50">
                      <span className="min-w-0">
                        <span className="block truncate font-medium text-slate-900">{o.specSnapshot?.title}</span>
                        <span className="block truncate text-sm text-slate-500">
                          {o.vendorId?.companyName || o.vendorId?.name} · {formatLKR(o.agreedPrice)}
                        </span>
                      </span>
                      <StatusBadge status={o.orderStatus} />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}
