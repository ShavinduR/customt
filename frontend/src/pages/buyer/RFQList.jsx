import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Gavel, PencilRuler, Search } from 'lucide-react';
import { rfqApi } from '../../api/client';
import { useSocketEvents } from '../../context/SocketContext';
import useAsync from '../../hooks/useAsync';
import useDebouncedValue from '../../hooks/useDebouncedValue';
import { RfqCard } from './BuyerDashboard';
import { Button, EmptyState, ErrorList, Input, PageHeader, Spinner, Tabs } from '../../components/ui';

const TABS = [
  { value: '', label: 'All' },
  { value: 'OPEN', label: 'Live' },
  { value: 'CLOSED', label: 'Awaiting decision' },
  { value: 'AWARDED', label: 'Awarded' },
  { value: 'EXPIRED,CANCELLED', label: 'Ended' },
];

export default function RFQList() {
  const navigate = useNavigate();
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search, 350);
  const [page, setPage] = useState(1);

  const { data, error, loading, reload } = useAsync(
    () => rfqApi.list({ status: status || undefined, search: debouncedSearch || undefined, page, limit: 12 }),
    [status, debouncedSearch, page]
  );

  useSocketEvents(['auction:leaderboard', 'auction:ended', 'auction:closed'], () => reload({ silent: true }));

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.limit)) : 1;

  return (
    <div>
      <PageHeader
        title="My auctions"
        subtitle="Every RFQ you've launched, with live bid activity."
        actions={
          <Button icon={PencilRuler} onClick={() => navigate('/buyer/rfqs/new')}>
            New RFQ
          </Button>
        }
      />
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Tabs
          tabs={TABS}
          value={status}
          onChange={(v) => {
            setStatus(v);
            setPage(1);
          }}
        />
        <div className="sm:w-72">
          <Input
            icon={Search}
            placeholder="Search title or RFQ code"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
          />
        </div>
      </div>

      {error && <ErrorList error={error} />}
      {loading && !data ? (
        <Spinner className="py-16" />
      ) : data?.items.length === 0 ? (
        <EmptyState
          icon={Gavel}
          title="No auctions found"
          description={status || search ? 'Try another filter.' : 'Launch your first reverse auction from the visual configurator.'}
          action={
            !status &&
            !search && (
              <Button size="sm" onClick={() => navigate('/buyer/rfqs/new')}>
                Design an RFQ
              </Button>
            )
          }
        />
      ) : (
        <>
          <div className="grid gap-3 md:grid-cols-2">
            {data?.items.map((rfq) => (
              <RfqCard key={rfq._id} rfq={rfq} />
            ))}
          </div>
          {totalPages > 1 && (
            <div className="mt-6 flex items-center justify-center gap-3 text-sm">
              <Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                Previous
              </Button>
              <span className="text-slate-500">
                Page {page} of {totalPages}
              </span>
              <Button size="sm" variant="secondary" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
                Next
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
