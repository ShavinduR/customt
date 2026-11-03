import { useEffect, useState } from 'react';
import { AlertCircle, BadgeCheck, CheckCircle2, KeyRound, Save, ShieldCheck, UserCircle, Wallet } from 'lucide-react';
import { authApi } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useCatalog } from '../context/CatalogContext';
import { useSocketEvents } from '../context/SocketContext';
import { useToast } from '../context/ToastContext';
import { Alert, Badge, Button, Card, CardHeader, ErrorList, Field, Input, PageHeader, StatCard, TrustStars, cx } from '../components/ui';
import { formatDate, formatLKR } from '../utils/format';

const ROLE_LABEL = { buyer: 'Buyer', vendor: 'Vendor (SME printer)', admin: 'Platform administrator' };

function PasswordCard() {
  const toast = useToast();
  const [form, setForm] = useState({ currentPassword: '', newPassword: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await authApi.changePassword(form);
      toast.success(res.message);
      setForm({ currentPassword: '', newPassword: '' });
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader icon={KeyRound} title="Change password" />
      <form onSubmit={submit} className="space-y-4 p-5">
        <Field label="Current password">
          <Input type="password" autoComplete="current-password" value={form.currentPassword} onChange={(e) => setForm((f) => ({ ...f, currentPassword: e.target.value }))} />
        </Field>
        <Field label="New password" hint="8-64 characters with a letter and a number">
          <Input type="password" autoComplete="new-password" value={form.newPassword} onChange={(e) => setForm((f) => ({ ...f, newPassword: e.target.value }))} />
        </Field>
        <ErrorList error={error} />
        <Button type="submit" variant="secondary" loading={busy} disabled={!form.currentPassword || !form.newPassword}>
          Update password
        </Button>
      </form>
    </Card>
  );
}

export default function Account() {
  const { user, refreshUser, setUser } = useAuth();
  const { catalog } = useCatalog();
  const toast = useToast();
  const isVendor = user.role === 'vendor';
  const [form, setForm] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    refreshUser().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    setForm({
      name: user.name || '',
      phone: user.phone || '',
      companyName: user.companyName || '',
      capabilities: user.capabilities || [],
      maxCapacity: user.maxCapacity || '',
      licenseExpiryDate: user.licenseExpiryDate ? user.licenseExpiryDate.slice(0, 10) : '',
    });
  }, [user]);

  useSocketEvents(['vendor:verification', 'vendor:badges', 'vendor:trust-updated', 'order:completed', 'dispute:resolved'], () => refreshUser().catch(() => {}));

  if (!form) return null;

  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const payload = { name: form.name, phone: form.phone };
    if (isVendor) {
      Object.assign(payload, {
        companyName: form.companyName,
        capabilities: form.capabilities,
        maxCapacity: Number(form.maxCapacity),
        licenseExpiryDate: form.licenseExpiryDate,
      });
    }
    try {
      const res = await authApi.updateMe(payload);
      setUser(res.user);
      refreshUser().catch(() => {});
      toast.success(res.message);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  const issues = user.qualificationIssues || [];
  const toggleCap = (cap) =>
    setForm((f) => ({ ...f, capabilities: f.capabilities.includes(cap) ? f.capabilities.filter((c) => c !== cap) : [...f.capabilities, cap] }));

  return (
    <div>
      <PageHeader title="Account" subtitle={`${ROLE_LABEL[user.role]} · member since ${formatDate(user.createdAt, false)}`} />

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard
          label={isVendor ? 'Wallet (escrow payouts)' : 'Wallet (refunds)'}
          value={formatLKR(user.walletBalance || 0)}
          icon={Wallet}
          tone="violet"
          hint={isVendor ? 'Released escrow milestones' : 'Credited from dispute refunds'}
        />
        {isVendor && (
          <>
            <Card className="p-5">
              <p className="text-sm font-medium text-slate-500">Trust score</p>
              <div className="mt-2">
                <TrustStars score={user.trustScore} size="md" />
              </div>
              <p className="mt-1 text-xs text-slate-500">{user.ratingCount} rating(s) · weight 30% in auction ranking</p>
            </Card>
            <Card className="p-5">
              <p className="text-sm font-medium text-slate-500">Skill badges</p>
              <div className="mt-2 flex flex-wrap gap-1">
                {user.skillBadges?.length ? (
                  user.skillBadges.map((b) => (
                    <Badge key={b} tone="violet" icon={BadgeCheck}>
                      {b}
                    </Badge>
                  ))
                ) : (
                  <span className="text-sm text-slate-400">Badges are awarded by administrators</span>
                )}
              </div>
            </Card>
          </>
        )}
      </div>

      {isVendor && (
        <Card className="mb-6">
          <CardHeader icon={ShieldCheck} title="Prequalification status (PERA)" subtitle="You must pass every check to enter auction rooms." />
          <div className="p-5">
            {issues.length === 0 ? (
              <Alert tone="success" icon={CheckCircle2} title="You are prequalified">
                Verified business with a valid license until {formatDate(user.licenseExpiryDate, false)}. You will receive live RFQs for {user.capabilities.join(', ')} up to{' '}
                {user.maxCapacity} pcs.
              </Alert>
            ) : (
              <Alert tone="warning" icon={AlertCircle} title="Not yet eligible for auctions">
                <ul className="list-disc space-y-0.5 pl-4">
                  {issues.map((i) => (
                    <li key={i}>{i}</li>
                  ))}
                </ul>
                {user.verificationNotes && <p className="mt-2">Administrator note: {user.verificationNotes}</p>}
              </Alert>
            )}
          </div>
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <Card>
          <CardHeader icon={UserCircle} title="Profile" subtitle={user.email} />
          <form onSubmit={save} className="space-y-4 p-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Full name">
                <Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
              </Field>
              <Field label="Phone">
                <Input value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} />
              </Field>
            </div>
            {isVendor && (
              <>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Company name">
                    <Input value={form.companyName} onChange={(e) => setForm((f) => ({ ...f, companyName: e.target.value }))} />
                  </Field>
                  <Field label="Business reg. no." hint="Contact an administrator to change this">
                    <Input value={user.businessRegNo || ''} disabled />
                  </Field>
                  <Field label="Max capacity per order (pcs)">
                    <Input type="number" min="1" value={form.maxCapacity} onChange={(e) => setForm((f) => ({ ...f, maxCapacity: e.target.value }))} />
                  </Field>
                  <Field label="License expiry">
                    <Input type="date" value={form.licenseExpiryDate} onChange={(e) => setForm((f) => ({ ...f, licenseExpiryDate: e.target.value }))} />
                  </Field>
                </div>
                <Field label="Printing capabilities">
                  <div className="grid grid-cols-2 gap-2">
                    {(catalog?.printTypes || []).map((cap) => (
                      <label key={cap} className={cx('flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm', form.capabilities.includes(cap) ? 'border-brand-500 text-brand-800' : 'border-slate-200 text-slate-700')}>
                        <input type="checkbox" checked={form.capabilities.includes(cap)} onChange={() => toggleCap(cap)} className="h-4 w-4 accent-brand-600" />
                        {cap}
                      </label>
                    ))}
                  </div>
                </Field>
                <Alert tone="info">Adding capabilities, raising capacity or changing your license date requires re-verification by an administrator.</Alert>
              </>
            )}
            <ErrorList error={error} />
            <Button type="submit" icon={Save} loading={busy}>
              Save changes
            </Button>
          </form>
        </Card>
        <PasswordCard />
      </div>
    </div>
  );
}
