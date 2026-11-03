import { useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, ChevronRight, Scale, Snowflake } from 'lucide-react';
import { adminApi } from '../../api/client';
import { useSocketEvents } from '../../context/SocketContext';
import useAsync from '../../hooks/useAsync';
import { Badge, Card, EmptyState, ErrorList, PageHeader, Spinner, StatCard, StatusBadge, Tabs } from '../../components/ui';
import { formatDate, formatLKR, formatRelative, titleCase } from '../../utils/format';

export default function Disputes() {
  const [state, setState] = useState('open');
  const { data, error, loading, reload } = useAsync(() => adminApi.disputes(state), [state]);
  useSocketEvents(['dispute:new', 'dispute:note', 'dispute:resolved'], () => reload({ silent: true }));
  const items = data?.items || [];
  const frozen = items.reduce((s, o) => s + (o.escrowStatus === 'FROZEN' ? o.escrowHeld : 0), 0);

  return (
    <div>
      <PageHeader title="Escrow dispute resolution" subtitle="Mediate quality disputes with polite, structured communication. Escrow stays frozen until you decide." />
      {state === 'open' && (
        <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-3">
          <StatCard label="Open disputes" value={items.length} icon={Scale} tone="red" />
          <StatCard label="Escrow frozen" value={formatLKR(frozen)} icon={Snowflake} tone="amber" />
          <StatCard label="Heightened emotion flagged" value={items.filter((o) => o.dispute?.toneFlagged).length} icon={AlertTriangle} tone="violet" hint="Use de-escalation language" />
        </div>
      )}
      <div className="mb-4">
        <Tabs
          tabs={[
            { value: 'open', label: 'Open' },
            { value: 'resolved', label: 'Resolved' },
          ]}
          value={state}
          onChange={setState}
        />
      </div>
      {error && <ErrorList error={error} />}
      {loading && !data ? (
        <Spinner className="py-16" />
      ) : items.length === 0 ? (
        <EmptyState icon={Scale} title={state === 'open' ? 'No open disputes' : 'No resolved disputes yet'} description="When a buyer freezes escrow during O2O inspection, the case appears here." />
      ) : (
        <Card className="overflow-hidden">
          <ul className="divide-y divide-slate-100">
            {items.map((o) => (
              <li key={o._id}>
                <Link to={`/admin/orders/${o._id}`} className="grid gap-2 px-5 py-4 hover:bg-slate-50 md:grid-cols-[minmax(0,2fr)_minmax(0,1.3fr)_auto_auto] md:items-center md:gap-4">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-xs text-slate-400">{o.orderCode}</span>
                      {o.dispute?.toneFlagged && (
                        <Badge tone="violet" icon={AlertTriangle}>
                          Tone flagged
                        </Badge>
                      )}
                    </div>
                    <p className="truncate font-semibold text-slate-900">{titleCase(o.dispute?.category)}</p>
                    <p className="truncate text-sm text-slate-500">
                      {o.buyerId?.name} vs {o.vendorId?.companyName} · wants {titleCase(o.dispute?.desiredResolution)}
                    </p>
                  </div>
                  <div className="text-sm">
                    <p className="font-mono font-semibold text-slate-900">{formatLKR(state === 'open' ? o.escrowHeld : o.agreedPrice)}</p>
                    <p className="text-slate-500">
                      {state === 'open' ? `Raised ${formatRelative(o.dispute?.raisedAt)}` : `Resolved ${formatDate(o.dispute?.resolvedAt, false)} · ${titleCase(o.dispute?.resolution)}`}
                    </p>
                  </div>
                  <StatusBadge status={o.escrowStatus} />
                  <ChevronRight className="hidden h-5 w-5 text-slate-300 md:block" />
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
