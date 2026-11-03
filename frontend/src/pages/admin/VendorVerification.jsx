import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Award, BadgeCheck, Building2, CalendarDays, Factory, Search, ShieldCheck, ShieldOff } from 'lucide-react';
import { adminApi } from '../../api/client';
import { useCatalog } from '../../context/CatalogContext';
import { useSocketEvents } from '../../context/SocketContext';
import { useToast } from '../../context/ToastContext';
import useAsync from '../../hooks/useAsync';
import useDebouncedValue from '../../hooks/useDebouncedValue';
import { Alert, Badge, Button, Card, EmptyState, ErrorList, Field, Input, Modal, PageHeader, Spinner, Tabs, Textarea, TrustStars, cx } from '../../components/ui';
import { formatDate, formatLKR } from '../../utils/format';

const TABS = [
  { value: 'pending', label: 'Pending verification' },
  { value: 'verified', label: 'Verified' },
  { value: 'expired', label: 'License expired' },
  { value: 'all', label: 'All vendors' },
];

function VerifyModal({ vendor, onClose, onSaved }) {
  const toast = useToast();
  const verifying = !vendor.isVerified;
  const [license, setLicense] = useState(vendor.licenseExpiryDate ? vendor.licenseExpiryDate.slice(0, 10) : '');
  const [notes, setNotes] = useState(vendor.verificationNotes || '');
  const [checks, setChecks] = useState({ registration: false, license: false, capacity: false });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const allChecked = Object.values(checks).every(Boolean);
  const licenseValid = license && new Date(license) > new Date();

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await adminApi.setVerification(vendor._id, { isVerified: verifying, licenseExpiryDate: license || undefined, notes });
      toast.success(verifying ? `${vendor.companyName} is now verified and can join eligible auctions.` : `Verification revoked for ${vendor.companyName}.`);
      onSaved(res.vendor);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={() => !busy && onClose()}
      title={verifying ? 'Verify vendor' : 'Revoke verification'}
      subtitle={vendor.companyName}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant={verifying ? 'success' : 'danger'} icon={verifying ? ShieldCheck : ShieldOff} loading={busy} disabled={verifying && (!allChecked || !licenseValid)} onClick={save}>
            {verifying ? 'Verify & unlock auctions' : 'Revoke verification'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <dl className="grid grid-cols-2 gap-3 rounded-xl bg-slate-50 p-4 text-sm">
          <div>
            <dt className="text-slate-500">Business reg. no.</dt>
            <dd className="font-mono font-semibold text-slate-900">{vendor.businessRegNo}</dd>
          </div>
          <div>
            <dt className="text-slate-500">Contact</dt>
            <dd className="truncate text-slate-900">{vendor.name}</dd>
          </div>
          <div>
            <dt className="text-slate-500">Capabilities</dt>
            <dd className="text-slate-900">{vendor.capabilities.join(', ')}</dd>
          </div>
          <div>
            <dt className="text-slate-500">Max capacity</dt>
            <dd className="text-slate-900">{vendor.maxCapacity} pcs / order</dd>
          </div>
        </dl>
        {verifying ? (
          <>
            <Field label="License expiry date" required error={license && !licenseValid ? 'The license must be valid beyond today' : null} hint="As printed on the business license you inspected">
              <Input type="date" icon={CalendarDays} value={license} onChange={(e) => setLicense(e.target.value)} />
            </Field>
            <fieldset className="space-y-2">
              <legend className="mb-1 text-sm font-medium text-slate-700">Prequalification checklist</legend>
              {[
                ['registration', 'Business registration number matches the official registry'],
                ['license', 'Valid business / trade license document inspected'],
                ['capacity', 'Declared capabilities and capacity are credible (e.g. workshop visit or portfolio)'],
              ].map(([key, label]) => (
                <label key={key} className="flex cursor-pointer items-start gap-2 text-sm text-slate-700">
                  <input type="checkbox" checked={checks[key]} onChange={(e) => setChecks((c) => ({ ...c, [key]: e.target.checked }))} className="mt-0.5 h-4 w-4 accent-brand-600" />
                  {label}
                </label>
              ))}
            </fieldset>
          </>
        ) : (
          <Alert tone="warning">The vendor will immediately lose access to auction rooms. Existing orders are not affected.</Alert>
        )}
        <Field label="Notes shared with the vendor" hint="Optional">
          <Textarea rows={2} maxLength={500} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
        <ErrorList error={error} />
      </div>
    </Modal>
  );
}

function BadgesModal({ vendor, onClose, onSaved }) {
  const { catalog } = useCatalog();
  const toast = useToast();
  const [selected, setSelected] = useState(vendor.skillBadges || []);
  const [busy, setBusy] = useState(false);
  const toggle = (b) => setSelected((s) => (s.includes(b) ? s.filter((x) => x !== b) : [...s, b]));

  const save = async () => {
    setBusy(true);
    try {
      const res = await adminApi.setBadges(vendor._id, selected);
      toast.success('Skill badges updated');
      onSaved(res.vendor);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={() => !busy && onClose()}
      title="Assign skill badges"
      subtitle={`${vendor.companyName}: badges appear next to their bids on buyer leaderboards`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button icon={Award} loading={busy} onClick={save}>
            Save badges
          </Button>
        </>
      }
    >
      <div className="grid gap-2 sm:grid-cols-2">
        {(catalog?.skillBadges || []).map((badge) => {
          const on = selected.includes(badge);
          return (
            <button
              key={badge}
              type="button"
              aria-pressed={on}
              onClick={() => toggle(badge)}
              className={cx('flex items-center gap-2 rounded-xl border px-3 py-2.5 text-left text-sm transition', on ? 'border-violet-400 bg-violet-50 text-violet-800' : 'border-slate-200 text-slate-700 hover:bg-slate-50')}
            >
              <BadgeCheck className={cx('h-4 w-4', on ? 'text-violet-600' : 'text-slate-300')} />
              {badge}
            </button>
          );
        })}
      </div>
      <p className="mt-4 text-xs text-slate-500">
        Current trust score {vendor.trustScore?.toFixed(2)} from {vendor.ratingCount} rating(s). Award badges based on verified performance, not on request.
      </p>
    </Modal>
  );
}

export default function VendorVerification() {
  const [params, setParams] = useSearchParams();
  const status = params.get('status') || 'pending';
  const [search, setSearch] = useState('');
  const debounced = useDebouncedValue(search, 350);
  const [modal, setModal] = useState(null);

  const { data, error, loading, reload, setData } = useAsync(() => adminApi.vendors({ status, search: debounced || undefined, limit: 100 }), [status, debounced]);
  useSocketEvents(['vendor:registered'], () => reload({ silent: true }));

  const replace = (vendor) => {
    setModal(null);
    setData((d) => (d ? { ...d, items: d.items.map((v) => (v._id === vendor._id ? { ...v, ...vendor } : v)) } : d));
    reload({ silent: true });
  };

  return (
    <div>
      <PageHeader title="Vendor prequalification" subtitle="PERA qualification-level lock: only verified SMEs with a valid license can enter auction rooms." />
      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <Tabs tabs={TABS} value={status} onChange={(v) => setParams({ status: v })} />
        <div className="lg:w-80">
          <Input icon={Search} placeholder="Search company, email or reg. no." value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
      </div>

      {error && <ErrorList error={error} />}
      {loading && !data ? (
        <Spinner className="py-16" />
      ) : data?.items.length === 0 ? (
        <EmptyState icon={ShieldCheck} title={status === 'pending' ? 'No vendors waiting for verification' : 'No vendors found'} description="New vendor registrations appear here in real time." />
      ) : (
        <div className="space-y-3">
          {data?.items.map((v) => {
            const prequalified = v.qualificationIssues.length === 0;
            return (
              <Card key={v._id} className="p-5">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Building2 className="h-4 w-4 text-slate-400" />
                      <h3 className="font-semibold text-slate-900">{v.companyName}</h3>
                      {prequalified ? (
                        <Badge tone="green" icon={ShieldCheck}>
                          Prequalified
                        </Badge>
                      ) : (
                        <Badge tone="amber">{v.isVerified ? 'Locked' : 'Awaiting verification'}</Badge>
                      )}
                      {!v.isActive && <Badge tone="red">Suspended</Badge>}
                    </div>
                    <p className="mt-1 text-sm text-slate-500">
                      {v.name} · {v.email} · {v.phone} · <span className="font-mono">{v.businessRegNo}</span>
                    </p>
                    <div className="mt-3 flex flex-wrap items-center gap-1.5">
                      {v.capabilities.map((c) => (
                        <Badge key={c} tone="brand">
                          {c}
                        </Badge>
                      ))}
                      <Badge tone="slate" icon={Factory}>
                        Up to {v.maxCapacity} pcs
                      </Badge>
                      {v.skillBadges.map((b) => (
                        <Badge key={b} tone="violet" icon={BadgeCheck}>
                          {b}
                        </Badge>
                      ))}
                    </div>
                    <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-sm text-slate-600">
                      <span>
                        License expiry: <strong className={v.licenseExpiryDate && new Date(v.licenseExpiryDate) <= new Date() ? 'text-red-600' : 'text-slate-900'}>{formatDate(v.licenseExpiryDate, false)}</strong>
                      </span>
                      <span className="inline-flex items-center gap-1.5">
                        Trust <TrustStars score={v.trustScore} />
                      </span>
                      <span>Wallet {formatLKR(v.walletBalance)}</span>
                      <span>Registered {formatDate(v.createdAt, false)}</span>
                    </div>
                    {!prequalified && v.qualificationIssues.length > 0 && <p className="mt-2 text-xs text-amber-700">{v.qualificationIssues.join(' · ')}</p>}
                  </div>
                  <div className="flex shrink-0 flex-wrap gap-2">
                    <Button variant="secondary" size="sm" icon={Award} onClick={() => setModal({ type: 'badges', vendor: v })}>
                      Badges
                    </Button>
                    {v.isVerified ? (
                      <Button variant="outlineDanger" size="sm" icon={ShieldOff} onClick={() => setModal({ type: 'verify', vendor: v })}>
                        Revoke
                      </Button>
                    ) : (
                      <Button variant="success" size="sm" icon={ShieldCheck} onClick={() => setModal({ type: 'verify', vendor: v })}>
                        Review & verify
                      </Button>
                    )}
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {modal?.type === 'verify' && <VerifyModal vendor={modal.vendor} onClose={() => setModal(null)} onSaved={replace} />}
      {modal?.type === 'badges' && <BadgesModal vendor={modal.vendor} onClose={() => setModal(null)} onSaved={replace} />}
    </div>
  );
}
