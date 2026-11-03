import { useState } from 'react';
import { Search, UserCheck, UserX, Users } from 'lucide-react';
import { adminApi } from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import useAsync from '../../hooks/useAsync';
import useDebouncedValue from '../../hooks/useDebouncedValue';
import { Badge, Button, Card, EmptyState, ErrorList, Input, Modal, PageHeader, Spinner, Tabs } from '../../components/ui';
import { formatDate, formatLKR } from '../../utils/format';

const ROLE_TONE = { buyer: 'blue', vendor: 'violet', admin: 'slate' };

export default function UsersAdmin() {
  const { user: me } = useAuth();
  const toast = useToast();
  const [role, setRole] = useState('');
  const [search, setSearch] = useState('');
  const debounced = useDebouncedValue(search, 350);
  const [target, setTarget] = useState(null);
  const [busy, setBusy] = useState(false);
  const { data, error, loading, reload } = useAsync(() => adminApi.users({ role: role || undefined, search: debounced || undefined, limit: 100 }), [role, debounced]);

  const toggle = async () => {
    setBusy(true);
    try {
      await adminApi.setUserStatus(target._id, !target.isActive);
      toast.success(target.isActive ? `${target.name} was suspended and signed out.` : `${target.name} was reactivated.`);
      setTarget(null);
      reload({ silent: true });
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <PageHeader title="Users" subtitle="Every buyer, vendor and administrator account." />
      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <Tabs
          tabs={[
            { value: '', label: 'All' },
            { value: 'buyer', label: 'Buyers' },
            { value: 'vendor', label: 'Vendors' },
            { value: 'admin', label: 'Admins' },
          ]}
          value={role}
          onChange={setRole}
        />
        <div className="lg:w-80">
          <Input icon={Search} placeholder="Search name, email or company" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
      </div>
      {error && <ErrorList error={error} />}
      {loading && !data ? (
        <Spinner className="py-16" />
      ) : data?.items.length === 0 ? (
        <EmptyState icon={Users} title="No users found" />
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full min-w-[44rem] text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
                <th className="px-5 py-3 font-medium">User</th>
                <th className="px-5 py-3 font-medium">Role</th>
                <th className="px-5 py-3 font-medium">Joined</th>
                <th className="px-5 py-3 text-right font-medium">Wallet</th>
                <th className="px-5 py-3 font-medium">Status</th>
                <th className="px-5 py-3" />
              </tr>
            </thead>
            <tbody>
              {data?.items.map((u) => (
                <tr key={u._id} className="border-b border-slate-100 last:border-0">
                  <td className="px-5 py-3">
                    <p className="font-medium text-slate-900">{u.companyName || u.name}</p>
                    <p className="text-slate-500">
                      {u.companyName ? `${u.name} · ` : ''}
                      {u.email}
                    </p>
                  </td>
                  <td className="px-5 py-3">
                    <Badge tone={ROLE_TONE[u.role]}>{u.role}</Badge>
                  </td>
                  <td className="px-5 py-3 text-slate-600">{formatDate(u.createdAt, false)}</td>
                  <td className="px-5 py-3 text-right font-mono">{formatLKR(u.walletBalance)}</td>
                  <td className="px-5 py-3">{u.isActive ? <Badge tone="green">Active</Badge> : <Badge tone="red">Suspended</Badge>}</td>
                  <td className="px-5 py-3 text-right">
                    {u._id !== me._id && (
                      <Button size="sm" variant={u.isActive ? 'outlineDanger' : 'secondary'} icon={u.isActive ? UserX : UserCheck} onClick={() => setTarget(u)}>
                        {u.isActive ? 'Suspend' : 'Reactivate'}
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      <Modal
        open={Boolean(target)}
        onClose={() => !busy && setTarget(null)}
        title={target?.isActive ? `Suspend ${target?.name}?` : `Reactivate ${target?.name}?`}
        footer={
          <>
            <Button variant="secondary" onClick={() => setTarget(null)} disabled={busy}>
              Cancel
            </Button>
            <Button variant={target?.isActive ? 'danger' : 'primary'} loading={busy} onClick={toggle}>
              {target?.isActive ? 'Suspend account' : 'Reactivate account'}
            </Button>
          </>
        }
      >
        <p className="text-sm text-slate-600">
          {target?.isActive
            ? 'The user is signed out immediately and cannot log in, bid or launch RFQs. Their existing orders and escrow funds are not changed.'
            : 'The user can sign in again. Vendors still need to pass prequalification to enter auctions.'}
        </p>
      </Modal>
    </div>
  );
}
