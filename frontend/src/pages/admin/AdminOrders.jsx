import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowUpFromLine, ChevronRight, Lock, Package, RotateCcw } from 'lucide-react';
import { adminApi } from '../../api/client';
import { useSocketEvents } from '../../context/SocketContext';
import useAsync from '../../hooks/useAsync';
import { Card, EmptyState, ErrorList, PageHeader, Spinner, StatCard, StatusBadge, Tabs } from '../../components/ui';
import { formatDate, formatLKR } from '../../utils/format';

const TABS = [
  { value: '', label: 'All' },
  { value: 'PENDING_ESCROW', label: 'Unfunded' },
  { value: 'IN_PROGRESS', label: 'In production' },
  { value: 'AWAITING_O2O', label: 'Awaiting O2O' },
  { value: 'DISPUTED', label: 'Disputed' },
  { value: 'COMPLETED', label: 'Completed' },
  { value: 'REFUNDED,CANCELLED', label: 'Refunded / cancelled' },
];

export default function AdminOrders() {
  const [status, setStatus] = useState('');
  const { data, error, loading, reload } = useAsync(() => adminApi.orders({ status: status || undefined, limit: 100 }), [status]);
  useSocketEvents(['order:created', 'order:updated', 'order:completed', 'dispute:new', 'dispute:resolved'], () => reload({ silent: true }));

  const items = data?.items || [];
  const held = items.reduce((s, o) => s + (o.escrowHeld || 0), 0);
  const released = items.reduce((s, o) => s + (o.amountReleasedToVendor || 0), 0);
  const refunded = items.reduce((s, o) => s + (o.refundedAmount || 0), 0);

  return (
    <div>
      <PageHeader title="Escrow monitor" subtitle="Every order's funds, milestones and O2O status across the marketplace." />
      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Orders (this view)" value={items.length} icon={Package} />
        <StatCard label="Held in escrow" value={formatLKR(held)} icon={Lock} tone="amber" />
        <StatCard label="Released to vendors" value={formatLKR(released)} icon={ArrowUpFromLine} tone="green" />
        <StatCard label="Refunded to buyers" value={formatLKR(refunded)} icon={RotateCcw} tone="violet" />
      </div>
      <div className="mb-4">
        <Tabs tabs={TABS} value={status} onChange={setStatus} />
      </div>
      {error && <ErrorList error={error} />}
      {loading && !data ? (
        <Spinner className="py-16" />
      ) : items.length === 0 ? (
        <EmptyState icon={Package} title="No orders here" />
      ) : (
        <Card className="overflow-hidden">
          <ul className="divide-y divide-slate-100">
            {items.map((o) => (
              <li key={o._id}>
                <Link to={`/admin/orders/${o._id}`} className="grid gap-2 px-5 py-4 hover:bg-slate-50 lg:grid-cols-[minmax(0,2fr)_minmax(0,1.4fr)_minmax(0,1fr)_auto_auto] lg:items-center lg:gap-4">
                  <div className="min-w-0">
                    <p className="truncate font-semibold text-slate-900">{o.specSnapshot?.title}</p>
                    <p className="truncate text-sm text-slate-500">
                      <span className="font-mono">{o.orderCode}</span> · {formatDate(o.createdAt, false)}
                    </p>
                  </div>
                  <p className="truncate text-sm text-slate-600">
                    {o.buyerId?.name} → {o.vendorId?.companyName}
                  </p>
                  <div className="text-sm">
                    <p className="font-mono font-semibold text-slate-900">{formatLKR(o.agreedPrice)}</p>
                    <p className="text-slate-500">held {formatLKR(o.escrowHeld)}</p>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    <StatusBadge status={o.orderStatus} />
                    <StatusBadge status={o.escrowStatus} />
                  </div>
                  <ChevronRight className="hidden h-5 w-5 text-slate-300 lg:block" />
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
