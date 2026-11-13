import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ArrowRight, MessagesSquare, Search, ShieldAlert } from 'lucide-react';
import { adminApi } from '../../api/client';
import { useSocketEvents } from '../../context/SocketContext';
import useAsync from '../../hooks/useAsync';
import useDebouncedValue from '../../hooks/useDebouncedValue';
import OrderChat from '../../components/chat/OrderChat';
import { Badge, Card, EmptyState, ErrorList, Input, PageHeader, Spinner, StatCard, StatusBadge, Tabs, cx } from '../../components/ui';
import { formatRelative } from '../../utils/format';

export default function Conversations() {
  const [params, setParams] = useSearchParams();
  const selected = params.get('order');
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  const debounced = useDebouncedValue(search, 300);

  const { data, error, loading, reload } = useAsync(
    () => adminApi.conversations({ flagged: filter === 'flagged' ? 'true' : undefined, search: debounced || undefined }),
    [filter, debounced]
  );
  useSocketEvents(['chat:monitor'], () => reload({ silent: true }));

  const items = data?.items || [];
  const totalFlagged = items.reduce((s, c) => s + c.flaggedMessages, 0);
  const current = items.find((c) => c.orderId === selected);

  return (
    <div>
      <PageHeader title="Messages" subtitle="Monitor buyer-vendor chats. Contact details are blocked automatically; flagged messages keep their original for review." />
      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-3">
        <StatCard label="Conversations (this view)" value={items.length} icon={MessagesSquare} />
        <StatCard label="Messages with blocked contact details" value={totalFlagged} icon={ShieldAlert} tone="red" />
        <StatCard label="Conversations with flags" value={items.filter((c) => c.flaggedMessages > 0).length} icon={ShieldAlert} tone="amber" />
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
        <div>
          <div className="mb-3 space-y-3">
            <Tabs
              tabs={[
                { value: 'all', label: 'All' },
                { value: 'flagged', label: 'Flagged only' },
              ]}
              value={filter}
              onChange={setFilter}
            />
            <Input icon={Search} placeholder="Order code, buyer or vendor" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          {error && <ErrorList error={error} />}
          {loading && !data ? (
            <Spinner className="py-10" />
          ) : items.length === 0 ? (
            <EmptyState icon={MessagesSquare} title={filter === 'flagged' ? 'No flagged conversations' : 'No conversations yet'} description="Chats start once a buyer accepts a bid." />
          ) : (
            <Card className="overflow-hidden">
              <ul className="divide-y divide-slate-100">
                {items.map((c) => (
                  <li key={c.orderId}>
                    <button
                      type="button"
                      onClick={() => setParams({ order: c.orderId })}
                      aria-current={c.orderId === selected}
                      className={cx('w-full px-4 py-3 text-left hover:bg-slate-50', c.orderId === selected && 'bg-brand-50/70')}
                    >
                      <span className="flex items-center justify-between gap-2">
                        <span className="font-mono text-xs text-slate-500">{c.orderCode}</span>
                        <span className="text-xs text-slate-400">{formatRelative(c.lastMessageAt)}</span>
                      </span>
                      <span className="mt-0.5 block truncate text-sm font-medium text-slate-900">
                        {c.buyerName} ↔ {c.vendorName}
                      </span>
                      <span className="block truncate text-sm text-slate-500">
                        {c.lastSender}: {c.lastBody}
                      </span>
                      <span className="mt-1 flex flex-wrap gap-1.5">
                        <Badge tone="slate">{c.messages} messages</Badge>
                        {c.flaggedMessages > 0 && <Badge tone="red">{c.flaggedMessages} flagged</Badge>}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>

        <div className="min-w-0">
          {selected ? (
            <div className="space-y-3">
              {current && (
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-slate-900">{current.title}</span>
                    <StatusBadge status={current.orderStatus} />
                  </div>
                  <Link to={`/admin/orders/${selected}`} className="inline-flex items-center gap-1 text-sm font-medium text-brand-700 hover:underline">
                    Open order <ArrowRight className="h-4 w-4" />
                  </Link>
                </div>
              )}
              <OrderChat key={selected} orderId={selected} viewerRole="admin" />
            </div>
          ) : (
            <EmptyState icon={MessagesSquare} title="Select a conversation" description="Pick a chat on the left to read it. Blocked messages show the original text and what was removed." />
          )}
        </div>
      </div>
    </div>
  );
}
