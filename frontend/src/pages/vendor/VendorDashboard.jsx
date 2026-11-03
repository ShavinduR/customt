import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowRight, BadgeCheck, Crown, Factory, KeyRound, MessagesSquare, Package, Radio, Trophy, Wallet } from 'lucide-react';
import { orderApi, vendorApi } from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import { useSocketEvent, useSocketEvents } from '../../context/SocketContext';
import { useVendorStatus } from '../../context/VendorStatusContext';
import useAsync from '../../hooks/useAsync';
import { VendorRfqCard, useJoinRfqRooms, useLiveRfqItems } from './RFQFeed';
import BidModal from '../../components/vendor/BidModal';
import PeraLockScreen from '../../components/vendor/PeraLockScreen';
import { Badge, Button, Card, CardHeader, EmptyState, ErrorList, PageHeader, PageLoader, StatCard, StatusBadge, TrustStars } from '../../components/ui';
import { formatLKR } from '../../utils/format';

const ORDER_ACTION = {
  IN_PROGRESS: { label: 'Update production', icon: Factory },
  AWAITING_O2O: { label: 'Enter O2O PIN', icon: KeyRound },
  DISPUTED: { label: 'Respond to dispute', icon: MessagesSquare },
};

export default function VendorDashboard() {
  const { user } = useAuth();
  const { status } = useVendorStatus();
  const navigate = useNavigate();
  const qualified = status?.isPrequalified;
  const [bidding, setBidding] = useState(null);

  const { data, error, loading, reload, setData } = useAsync(async () => {
    const [rfqs, bids, orders, wallet] = await Promise.all([
      qualified ? vendorApi.rfqs({ limit: 50 }) : Promise.resolve({ items: [] }),
      vendorApi.bids({ limit: 100 }),
      orderApi.list({ limit: 50 }),
      vendorApi.wallet(),
    ]);
    return { rfqs: rfqs.items, bids: bids.items, orders: orders.items, wallet };
  }, [qualified]);

  const setRfqs = useMemo(
    () => (updater) => setData((d) => (d ? { ...d, rfqs: typeof updater === 'function' ? updater(d.rfqs) : updater } : d)),
    [setData]
  );
  useJoinRfqRooms(useMemo(() => (data?.rfqs || []).map((r) => r._id), [data?.rfqs]));
  useLiveRfqItems(setRfqs);
  useSocketEvent('rfq:new', () => reload({ silent: true }));
  useSocketEvents(['auction:awarded', 'auction:lost', 'order:updated', 'order:completed', 'dispute:raised', 'dispute:resolved'], () => reload({ silent: true }));

  if (loading && !data) return <PageLoader />;
  if (error) return <ErrorList error={error} />;

  const { rfqs, bids, orders, wallet } = data;
  const activeBids = bids.filter((b) => b.rfq.status === 'OPEN' && b.myBid);
  const leading = activeBids.filter((b) => b.rank === 1).length;
  const decided = bids.filter((b) => ['ACCEPTED', 'REJECTED'].includes(b.myBid?.status));
  const wins = decided.filter((b) => b.myBid.status === 'ACCEPTED').length;
  const actionOrders = orders.filter((o) => ORDER_ACTION[o.orderStatus]);
  const current = bidding ? rfqs.find((r) => r._id === bidding) : null;

  return (
    <div>
      <PageHeader
        title={user.companyName || user.name}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <TrustStars score={user.trustScore} />
            {user.skillBadges?.map((b) => (
              <Badge key={b} tone="violet" icon={BadgeCheck}>
                {b}
              </Badge>
            ))}
            {qualified ? <Badge tone="green">Prequalified</Badge> : <Badge tone="amber">Awaiting verification</Badge>}
          </span>
        }
        actions={
          qualified && (
            <Button size="lg" icon={Radio} onClick={() => navigate('/vendor/rfqs')}>
              Browse live RFQs
            </Button>
          )
        }
      />

      {!qualified && (
        <div className="mb-6">
          <PeraLockScreen issues={status?.issues} compact />
        </div>
      )}

      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Eligible live RFQs" value={rfqs.length} icon={Radio} tone="green" hint={`${rfqs.filter((r) => !r.rank).length} not yet bid`} />
        <StatCard label="Active bids" value={activeBids.length} icon={Crown} tone="amber" hint={`Leading in ${leading}`} />
        <StatCard label="Win rate" value={decided.length ? `${Math.round((wins / decided.length) * 100)}%` : '—'} icon={Trophy} tone="violet" hint={`${wins} won of ${decided.length} decided`} />
        <StatCard label="Wallet balance" value={formatLKR(wallet.walletBalance)} icon={Wallet} tone="brand" hint={`${formatLKR(wallet.pendingInEscrow)} still in escrow`} />
      </div>

      {actionOrders.length > 0 && (
        <Card className="mb-6 border-amber-200 bg-amber-50/40">
          <CardHeader icon={Package} title="Orders needing your action" />
          <ul className="divide-y divide-amber-100">
            {actionOrders.map((o) => {
              const action = ORDER_ACTION[o.orderStatus];
              const Icon = action.icon;
              return (
                <li key={o._id}>
                  <Link to={`/vendor/orders/${o._id}`} className="flex items-center justify-between gap-3 px-5 py-3 hover:bg-amber-50">
                    <span className="min-w-0">
                      <span className="block truncate font-medium text-slate-900">{o.specSnapshot?.title}</span>
                      <span className="text-sm text-slate-500">
                        {o.orderCode} · {o.specSnapshot?.totalQuantity} pcs · {formatLKR(o.agreedPrice)}
                      </span>
                    </span>
                    <span className="flex shrink-0 items-center gap-1.5 text-sm font-semibold text-amber-800">
                      <Icon className="h-4 w-4" /> {action.label} <ArrowRight className="h-4 w-4" />
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </Card>
      )}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <div>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-semibold text-slate-900">Closing soon</h2>
            {qualified && (
              <Link to="/vendor/rfqs" className="text-sm font-medium text-brand-700 hover:underline">
                All live RFQs
              </Link>
            )}
          </div>
          {rfqs.length === 0 ? (
            <EmptyState icon={Radio} title={qualified ? 'No open RFQs right now' : 'Live RFQs unlock after verification'} description="New matching RFQs appear here in real time." />
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              {rfqs.slice(0, 4).map((r) => (
                <VendorRfqCard key={r._id} rfq={r} onBid={(x) => setBidding(x._id)} />
              ))}
            </div>
          )}
        </div>

        <Card>
          <CardHeader
            icon={Package}
            title="Recent orders"
            action={
              <Link to="/vendor/orders" className="text-sm font-medium text-brand-700 hover:underline">
                View all
              </Link>
            }
          />
          <div className="p-4">
            {orders.length === 0 ? (
              <p className="py-8 text-center text-sm text-slate-500">Won auctions become orders here.</p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {orders.slice(0, 6).map((o) => (
                  <li key={o._id}>
                    <Link to={`/vendor/orders/${o._id}`} className="flex items-center justify-between gap-3 rounded-lg px-2 py-3 hover:bg-slate-50">
                      <span className="min-w-0">
                        <span className="block truncate font-medium text-slate-900">{o.specSnapshot?.title}</span>
                        <span className="block truncate text-sm text-slate-500">
                          {o.buyerId?.name} · {formatLKR(o.agreedPrice)}
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

      <BidModal
        open={Boolean(current)}
        onClose={() => setBidding(null)}
        rfq={current}
        myBid={current?.myBid}
        rank={current?.rank}
        totalBids={current?.totalBids}
        onPlaced={(res) =>
          setRfqs((list) => list.map((i) => (i._id === res.rfqId ? { ...i, myBid: res.myBid, rank: res.rank, totalBids: res.totalBids, rankLabel: res.rankLabel, bidCount: res.totalBids } : i)))
        }
      />
    </div>
  );
}
