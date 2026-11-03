import { Link } from 'react-router-dom';
import { ArrowUpFromLine, Lock, RotateCcw, Wallet as WalletIcon } from 'lucide-react';
import { vendorApi } from '../../api/client';
import { useSocketEvents } from '../../context/SocketContext';
import useAsync from '../../hooks/useAsync';
import { Card, CardHeader, EmptyState, ErrorList, PageHeader, Spinner, StatCard } from '../../components/ui';
import { formatDate, formatLKR } from '../../utils/format';

const TYPE = {
  ADVANCE_RELEASE: { label: 'Milestone 1 · 30% advance', icon: ArrowUpFromLine, tone: 'text-emerald-600' },
  FINAL_RELEASE: { label: 'Milestone 2 · 70% final settlement', icon: ArrowUpFromLine, tone: 'text-emerald-600' },
  DISPUTE_RELEASE: { label: 'Released after mediation', icon: ArrowUpFromLine, tone: 'text-emerald-600' },
  REFUND: { label: 'Refund', icon: RotateCcw, tone: 'text-violet-600' },
};

export default function Wallet() {
  const { data, error, loading, reload } = useAsync(() => vendorApi.wallet(), []);
  useSocketEvents(['order:updated', 'order:completed', 'dispute:resolved'], () => reload({ silent: true }));

  if (loading && !data) return <Spinner className="py-24" />;
  if (error) return <ErrorList error={error} />;

  const earned = data.transactions.reduce((s, t) => s + t.amount, 0);
  const advances = data.transactions.filter((t) => t.type === 'ADVANCE_RELEASE').reduce((s, t) => s + t.amount, 0);

  return (
    <div>
      <PageHeader title="Wallet" subtitle="Escrow payouts released to your CustomT virtual balance." />
      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <StatCard label="Available balance" value={formatLKR(data.walletBalance)} icon={WalletIcon} tone="brand" />
        <StatCard label="Still held in escrow" value={formatLKR(data.pendingInEscrow)} icon={Lock} tone="amber" hint="Released at production start and after O2O verification" />
        <StatCard label="Total paid out" value={formatLKR(earned)} icon={ArrowUpFromLine} tone="green" hint={`${formatLKR(advances)} from 30% advances`} />
      </div>
      <Card>
        <CardHeader title="Payout history" />
        {data.transactions.length === 0 ? (
          <div className="p-5">
            <EmptyState icon={WalletIcon} title="No payouts yet" description="Your 30% advance is credited when you start production on a funded order." />
          </div>
        ) : (
          <ul className="divide-y divide-slate-100">
            {data.transactions.map((t, i) => {
              const meta = TYPE[t.type] || { label: t.type, icon: ArrowUpFromLine, tone: 'text-slate-500' };
              const Icon = meta.icon;
              return (
                <li key={`${t.orderId}-${t.type}-${i}`} className="flex items-center gap-4 px-5 py-3.5">
                  <span className="rounded-lg bg-slate-50 p-2">
                    <Icon className={`h-4 w-4 ${meta.tone}`} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-slate-900">{meta.label}</p>
                    <p className="text-sm text-slate-500">
                      <Link to={`/vendor/orders/${t.orderId}`} className="font-mono text-brand-700 hover:underline">
                        {t.orderCode}
                      </Link>{' '}
                      · {formatDate(t.at)}
                    </p>
                  </div>
                  <span className="font-mono font-semibold text-emerald-700">+{formatLKR(t.amount)}</span>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}
