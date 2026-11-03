import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight, Package } from 'lucide-react';
import { orderApi } from '../../api/client';
import { useSocketEvents } from '../../context/SocketContext';
import useAsync from '../../hooks/useAsync';
import { Card, EmptyState, ErrorList, PageHeader, Spinner, StatusBadge, Tabs } from '../../components/ui';
import { formatDate, formatLKR } from '../../utils/format';

const TABS = [
  { value: '', label: 'All' },
  { value: 'PENDING_ESCROW', label: 'Awaiting escrow' },
  { value: 'IN_PROGRESS', label: 'In production' },
  { value: 'AWAITING_O2O', label: 'Hand-over' },
  { value: 'DISPUTED', label: 'Disputed' },
  { value: 'COMPLETED,REFUNDED,CANCELLED', label: 'Closed' },
];

export default function VendorOrders() {
  const [status, setStatus] = useState('');
  const { data, error, loading, reload } = useAsync(() => orderApi.list({ status: status || undefined, limit: 50 }), [status]);
  useSocketEvents(['auction:awarded', 'order:updated', 'order:completed', 'dispute:raised', 'dispute:resolved'], () => reload({ silent: true }));

  return (
    <div>
      <PageHeader title="Orders" subtitle="Auctions you won. Production milestones release your escrow payouts." />
      <div className="mb-4">
        <Tabs tabs={TABS} value={status} onChange={setStatus} />
      </div>
      {error && <ErrorList error={error} />}
      {loading && !data ? (
        <Spinner className="py-16" />
      ) : data?.items.length === 0 ? (
        <EmptyState icon={Package} title="No orders here" description="When a buyer accepts your bid, the order appears here." />
      ) : (
        <Card className="overflow-hidden">
          <ul className="divide-y divide-slate-100">
            {data?.items.map((o) => (
              <li key={o._id}>
                <Link to={`/vendor/orders/${o._id}`} className="grid gap-2 px-5 py-4 hover:bg-slate-50 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_auto_auto] sm:items-center sm:gap-4">
                  <div className="min-w-0">
                    <p className="truncate font-semibold text-slate-900">{o.specSnapshot?.title}</p>
                    <p className="truncate text-sm text-slate-500">
                      <span className="font-mono">{o.orderCode}</span> · {o.specSnapshot?.totalQuantity} pcs {o.specSnapshot?.printType} · due in {o.leadTimeDays} days from{' '}
                      {formatDate(o.createdAt, false)}
                    </p>
                  </div>
                  <div className="min-w-0 text-sm">
                    <p className="truncate text-slate-700">{o.buyerId?.name}</p>
                    <p className="font-mono font-semibold text-slate-900">{formatLKR(o.agreedPrice)}</p>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    <StatusBadge status={o.orderStatus} />
                    <StatusBadge status={o.productionStatus} />
                  </div>
                  <ChevronRight className="hidden h-5 w-5 text-slate-300 sm:block" />
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
