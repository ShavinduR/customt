import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  BadgeCheck,
  Building2,
  CheckCircle2,
  Clock,
  FileText,
  Image as ImageIcon,
  Loader2,
  Lock,
  Save,
  Send,
  ShieldCheck,
  Store,
  Trash2,
  Upload,
  XCircle,
} from 'lucide-react';
import { kybApi } from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import { useCatalog } from '../../context/CatalogContext';
import { useToast } from '../../context/ToastContext';
import { useSocketEvent } from '../../context/SocketContext';
import useAsync from '../../hooks/useAsync';
import { Alert, Badge, Button, Card, ErrorList, Field, Input, PageHeader, PageLoader, Select, cx } from '../../components/ui';
import { formatDate } from '../../utils/format';

const DISTRICTS = [
  'Ampara', 'Anuradhapura', 'Badulla', 'Batticaloa', 'Colombo', 'Galle', 'Gampaha', 'Hambantota', 'Jaffna', 'Kalutara', 'Kandy', 'Kegalle', 'Kilinochchi',
  'Kurunegala', 'Mannar', 'Matale', 'Matara', 'Monaragala', 'Mullaitivu', 'Nuwara Eliya', 'Polonnaruwa', 'Puttalam', 'Ratnapura', 'Trincomalee', 'Vavuniya',
];
const ACCEPT = 'application/pdf,image/jpeg,image/png';
const DOC_HELP = {
  BR_COPY: 'The Business Registration certificate issued by the Registrar / Divisional Secretariat.',
  NIC_FRONT: "The front of the owner's National Identity Card. A single PDF with both sides is also fine.",
  NIC_BACK: 'The back of the NIC (not needed if the front is a PDF with both sides).',
  UTILITY_BILL: 'An electricity, water or telephone bill for the business address, from the last 3 months.',
  PAST_INVOICE: 'Invoices you issued to customers. They show that the business is actively trading.',
};
const REVIEW_BADGE = {
  ACCEPTED: { tone: 'green', icon: CheckCircle2, label: 'Accepted' },
  REJECTED: { tone: 'red', icon: XCircle, label: 'Not accepted' },
  PENDING: { tone: 'slate', icon: Clock, label: 'Not reviewed yet' },
};
const today = () => new Date().toISOString().slice(0, 10);

function emptyForm(app) {
  const b = app?.business || {};
  return {
    legalName: b.legalName || '',
    tradingName: b.tradingName || '',
    businessRegNo: b.businessRegNo || '',
    line1: b.address?.line1 || '',
    line2: b.address?.line2 || '',
    city: b.address?.city || '',
    district: b.address?.district || '',
    postalCode: b.address?.postalCode || '',
    capabilities: b.capabilities || [],
    maxCapacity: b.maxCapacity ? String(b.maxCapacity) : '',
    licenseExpiryDate: b.licenseExpiryDate ? String(b.licenseExpiryDate).slice(0, 10) : '',
    fullName: app?.owner?.fullName || '',
    nic: '',
  };
}

function DocumentRow({ doc, editable, onRemove }) {
  const review = REVIEW_BADGE[doc.review?.status || 'PENDING'];
  return (
    <li className="flex flex-wrap items-center gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2">
      {doc.mimeType === 'application/pdf' ? <FileText className="h-5 w-5 text-red-500" /> : <ImageIcon className="h-5 w-5 text-sky-500" />}
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-slate-900">{doc.originalName}</p>
        <p className="text-xs text-slate-500">
          {(doc.sizeBytes / 1024).toFixed(0)} KB{doc.issuedOn ? ` · dated ${formatDate(doc.issuedOn, false)}` : ''}
        </p>
        {doc.review?.status === 'REJECTED' && doc.review.reason && <p className="mt-0.5 text-xs font-medium text-red-700">Reviewer: {doc.review.reason}</p>}
      </div>
      <Badge tone={review.tone} icon={review.icon}>
        {review.label}
      </Badge>
      {editable && (
        <button type="button" onClick={() => onRemove(doc)} className="rounded-lg p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600" aria-label={`Remove ${doc.originalName}`}>
          <Trash2 className="h-4 w-4" />
        </button>
      )}
    </li>
  );
}

function DocumentSlot({ type, label, docs, max, needsDate, editable, onUpload, onRemove, uploading }) {
  const fileRef = useRef(null);
  const [issuedOn, setIssuedOn] = useState('');
  const full = docs.length >= max;
  const replace = max === 1 && docs.length === 1;
  const busy = uploading === type;

  const pick = () => {
    if (needsDate && !issuedOn) return;
    fileRef.current?.click();
  };

  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-semibold text-slate-900">
            {label}
            {max > 1 && <span className="ml-1 font-normal text-slate-500">({docs.length}/{max})</span>}
          </p>
          <p className="mt-0.5 text-xs text-slate-500">{DOC_HELP[type]}</p>
        </div>
        {docs.length > 0 && docs.every((d) => d.review?.status !== 'REJECTED') && <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-500" aria-label="Uploaded" />}
      </div>

      {docs.length > 0 && (
        <ul className="mt-3 space-y-2">
          {docs.map((d) => (
            <DocumentRow key={d._id} doc={d} editable={editable} onRemove={onRemove} />
          ))}
        </ul>
      )}

      {editable && (!full || replace) && (
        <div className="mt-3 flex flex-wrap items-end gap-2">
          {needsDate && (
            <label className="text-xs font-medium text-slate-600">
              Date on the document
              <Input type="date" max={today()} value={issuedOn} onChange={(e) => setIssuedOn(e.target.value)} className="mt-1 w-44" />
            </label>
          )}
          <Button variant="secondary" icon={busy ? Loader2 : Upload} disabled={busy || (needsDate && !issuedOn)} onClick={pick}>
            {busy ? 'Uploading…' : replace ? 'Replace file' : 'Upload'}
          </Button>
          {needsDate && !issuedOn && <span className="text-xs text-slate-500">Enter the date first</span>}
          <input
            ref={fileRef}
            type="file"
            accept={ACCEPT}
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (file) onUpload({ type, file, issuedOn: needsDate ? issuedOn : undefined }).then((ok) => ok && setIssuedOn(''));
            }}
          />
        </div>
      )}
    </div>
  );
}

/**
 * "Sell on CustomT": a buyer applies to become a vendor (KYB). Business details + four kinds of evidence,
 * reviewed by an administrator. The account becomes a vendor account only when the application is approved.
 */
export default function SellOnCustomT() {
  const { user, refreshUser } = useAuth();
  const { catalog } = useCatalog();
  const toast = useToast();
  const navigate = useNavigate();
  const { data, error, loading, reload, setData } = useAsync(() => kybApi.get(), []);
  const [form, setForm] = useState(emptyForm(null));
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const [uploading, setUploading] = useState(null);
  const [consent, setConsent] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(null);
  const [started, setStarted] = useState(false);

  const latest = data?.application || null;
  const rules = data?.rules;
  const open = Boolean(latest && ['DRAFT', 'PENDING_APPROVAL', 'CHANGES_REQUESTED'].includes(latest.status));
  // The application being worked on. A finished (rejected / withdrawn) one is only shown as history.
  const app = open ? latest : null;

  useEffect(() => {
    setForm(emptyForm(app));
    // Only when a different application (or a new decision) arrives.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [app?._id, app?.status]);

  useSocketEvent('kyb:decision', async (payload) => {
    if (payload.outcome === 'APPROVED') {
      await refreshUser().catch(() => {});
      navigate('/vendor', { replace: true });
      return;
    }
    reload({ silent: true });
  });

  const setApp = (application) => setData((d) => ({ ...d, application }));
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));
  const toggleCap = (c) => setForm((f) => ({ ...f, capabilities: f.capabilities.includes(c) ? f.capabilities.filter((x) => x !== c) : [...f.capabilities, c] }));

  const save = async (e) => {
    e?.preventDefault();
    setSaving(true);
    setSaveError(null);
    try {
      const res = await kybApi.save({
        business: {
          legalName: form.legalName,
          tradingName: form.tradingName,
          businessRegNo: form.businessRegNo,
          address: { line1: form.line1, line2: form.line2, city: form.city, district: form.district, postalCode: form.postalCode },
          capabilities: form.capabilities,
          maxCapacity: form.maxCapacity,
          licenseExpiryDate: form.licenseExpiryDate || undefined,
        },
        owner: { fullName: form.fullName, ...(form.nic.trim() ? { nic: form.nic } : {}) },
      });
      setApp(res.application);
      setForm((f) => ({ ...f, nic: '' }));
      toast.success('Business details saved.');
      return true;
    } catch (err) {
      setSaveError(err);
      return false;
    } finally {
      setSaving(false);
    }
  };

  const upload = async ({ type, file, issuedOn }) => {
    if (rules && file.size > rules.maxFileMb * 1024 * 1024) {
      toast.error(`Each file must be smaller than ${rules.maxFileMb} MB.`);
      return false;
    }
    if (!app) {
      toast.error('Save your business details first.');
      return false;
    }
    setUploading(type);
    try {
      const res = await kybApi.upload({ type, file, issuedOn });
      setApp(res.application);
      toast.success(`${rules?.docLabels?.[type] || 'Document'} uploaded.`);
      return true;
    } catch (err) {
      toast.error(err.message);
      return false;
    } finally {
      setUploading(null);
    }
  };

  const removeDoc = async (doc) => {
    if (!window.confirm(`Remove ${doc.originalName}?`)) return;
    try {
      const res = await kybApi.removeDocument(doc._id);
      setApp(res.application);
    } catch (err) {
      toast.error(err.message);
    }
  };

  const submit = async () => {
    setSubmitting(true);
    setSubmitError(null);
    try {
      const res = await kybApi.submit();
      setApp(res.application);
      await refreshUser().catch(() => {});
      toast.success(res.message, { title: 'Application submitted' });
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err) {
      setSubmitError(err);
    } finally {
      setSubmitting(false);
    }
  };

  const withdraw = async () => {
    if (!window.confirm('Withdraw your application? Your uploaded documents will be deleted.')) return;
    try {
      const res = await kybApi.withdraw();
      setApp(res.application);
      await refreshUser().catch(() => {});
      toast.info('Application withdrawn.');
    } catch (err) {
      toast.error(err.message);
    }
  };

  if (loading && !data) return <PageLoader label="Loading your application…" />;
  if (error) return <ErrorList error={error} />;

  if (user?.role === 'vendor') {
    return (
      <div>
        <PageHeader title="Sell on CustomT" />
        <Alert tone="success" icon={BadgeCheck} title="Your account is a vendor account">
          You can bid on RFQs and publish posts on your storefront.{' '}
          <Link to="/vendor" className="font-semibold underline">
            Open the vendor dashboard
          </Link>
        </Alert>
      </div>
    );
  }

  const docsOf = (type) => (app?.documents || []).filter((d) => d.type === type);
  const editable = Boolean(app?.editable);
  const showForm = editable || (!open && started);
  const printTypes = catalog?.printTypes || ['Screen Printing', 'DTF', 'Embroidery', 'Sublimation'];

  return (
    <div>
      <PageHeader
        title="Sell on CustomT"
        subtitle="Apply to become a verified vendor. We check every business before it can bid on orders, so buyers can trust who they pay."
      />

      {/* ── Status ── */}
      {app?.status === 'PENDING_APPROVAL' && (
        <Alert tone="info" icon={Clock} title="Your application is under review" className="mb-6">
          Submitted {formatDate(app.submittedAt)}. An administrator is checking your documents; you&apos;ll be notified here as soon as there is a decision. Your
          details are locked while they are reviewed.{' '}
          <button type="button" onClick={withdraw} className="font-semibold underline">
            Withdraw application
          </button>
        </Alert>
      )}
      {app?.status === 'CHANGES_REQUESTED' && (
        <Alert tone="warning" title="Changes requested" className="mb-6">
          {app.decision?.notes || 'Some documents need to be replaced.'} Replace the documents marked <strong>Not accepted</strong>, then submit again.
        </Alert>
      )}
      {latest?.status === 'REJECTED' && !open && (
        <Alert tone="danger" title="Your previous application was not approved" className="mb-6">
          {latest.decision?.notes}
          {data.reapplyAfter && new Date(data.reapplyAfter) > new Date() ? ` You can apply again from ${formatDate(data.reapplyAfter, false)}.` : ''}
        </Alert>
      )}

      {!open && !started && (
        <Card className="mb-6 p-6">
          <div className="flex flex-wrap items-start gap-5">
            <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-600 text-white">
              <Store className="h-7 w-7" />
            </span>
            <div className="min-w-0 flex-1">
              <h2 className="text-lg font-bold text-slate-900">Become a CustomT vendor</h2>
              <p className="mt-1 text-sm text-slate-600">You will need:</p>
              <ul className="mt-2 grid gap-1.5 text-sm text-slate-700 sm:grid-cols-2">
                <li className="flex items-center gap-2"><FileText className="h-4 w-4 text-brand-600" /> Business Registration (BR) copy</li>
                <li className="flex items-center gap-2"><FileText className="h-4 w-4 text-brand-600" /> Owner&apos;s NIC (front and back)</li>
                <li className="flex items-center gap-2"><FileText className="h-4 w-4 text-brand-600" /> A utility bill from the last 3 months</li>
                <li className="flex items-center gap-2"><FileText className="h-4 w-4 text-brand-600" /> {rules?.invoicesMin || 3} or more invoices from the last 12 months</li>
              </ul>
              <p className="mt-3 flex items-start gap-1.5 text-xs text-slate-500">
                <Lock className="mt-px h-3.5 w-3.5 shrink-0" /> Documents are stored privately and seen only by CustomT administrators. Your full NIC number is never stored.
              </p>
            </div>
            <Button size="lg" icon={Building2} onClick={() => setStarted(true)} disabled={!data.canApply}>
              Start application
            </Button>
          </div>
        </Card>
      )}

      {(showForm || open) && (
        <div className="space-y-6">
          {/* ── 1. Business details ── */}
          <Card className="p-5">
            <h2 className="mb-1 flex items-center gap-2 font-semibold text-slate-900">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-brand-600 text-xs font-bold text-white">1</span> Business details
            </h2>
            <p className="mb-4 text-sm text-slate-500">As shown on your Business Registration certificate.</p>
            <form onSubmit={save} className="space-y-4">
              <fieldset disabled={!editable && Boolean(app)} className="grid gap-4 sm:grid-cols-2">
                <Field label="Legal business name" required>
                  <Input value={form.legalName} maxLength={150} onChange={set('legalName')} placeholder="e.g. Colombo Print Works (Pvt) Ltd" />
                </Field>
                <Field label="Trading name" hint="If different from the legal name">
                  <Input value={form.tradingName} maxLength={150} onChange={set('tradingName')} />
                </Field>
                <Field label="BR number" required>
                  <Input value={form.businessRegNo} maxLength={50} onChange={set('businessRegNo')} placeholder="e.g. PV12345 or W/12345" />
                </Field>
                <Field label="Business licence expiry" required>
                  <Input type="date" min={today()} value={form.licenseExpiryDate} onChange={set('licenseExpiryDate')} />
                </Field>
                <Field label="Address line 1" required className="sm:col-span-2">
                  <Input value={form.line1} maxLength={150} onChange={set('line1')} placeholder="Street address" />
                </Field>
                <Field label="Address line 2" className="sm:col-span-2">
                  <Input value={form.line2} maxLength={150} onChange={set('line2')} />
                </Field>
                <Field label="City" required>
                  <Input value={form.city} maxLength={80} onChange={set('city')} />
                </Field>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="District" required>
                    <Select value={form.district} onChange={set('district')}>
                      <option value="">Choose…</option>
                      {DISTRICTS.map((d) => (
                        <option key={d}>{d}</option>
                      ))}
                    </Select>
                  </Field>
                  <Field label="Postal code">
                    <Input value={form.postalCode} maxLength={10} onChange={set('postalCode')} />
                  </Field>
                </div>
                <Field label="Printing methods you offer" required className="sm:col-span-2">
                  <div className="flex flex-wrap gap-2">
                    {printTypes.map((c) => (
                      <button
                        key={c}
                        type="button"
                        aria-pressed={form.capabilities.includes(c)}
                        onClick={() => toggleCap(c)}
                        className={cx(
                          'rounded-full border px-3 py-1.5 text-sm font-medium transition disabled:opacity-60',
                          form.capabilities.includes(c) ? 'border-brand-500 bg-brand-50 text-brand-800' : 'border-slate-300 bg-white text-slate-600 hover:bg-slate-50'
                        )}
                      >
                        {c}
                      </button>
                    ))}
                  </div>
                </Field>
                <Field label="Maximum pieces per order" required hint="You will only see RFQs up to this quantity">
                  <Input type="number" min="1" value={form.maxCapacity} onChange={set('maxCapacity')} />
                </Field>
                <div />
                <Field label="Owner's full name (as on the NIC)" required>
                  <Input value={form.fullName} maxLength={120} onChange={set('fullName')} />
                </Field>
                <Field
                  label="Owner's NIC number"
                  required={!app?.owner?.nicLast4}
                  hint={app?.owner?.nicLast4 ? `Saved: ending in ${app.owner.nicLast4}. Type it again only to change it.` : 'Old (123456789V) or new (12 digits) format. Only a secure fingerprint is stored.'}
                >
                  <Input value={form.nic} maxLength={14} autoComplete="off" onChange={set('nic')} placeholder={app?.owner?.nicLast4 ? `••••••••${app.owner.nicLast4}` : '123456789V'} />
                </Field>
              </fieldset>
              <ErrorList error={saveError} />
              {(editable || !app) && (
                <Button type="submit" icon={Save} loading={saving}>
                  {app ? 'Save details' : 'Save and continue'}
                </Button>
              )}
            </form>
          </Card>

          {/* ── 2. Documents ── */}
          {app && rules && (
            <Card className="p-5">
              <h2 className="mb-1 flex items-center gap-2 font-semibold text-slate-900">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-brand-600 text-xs font-bold text-white">2</span> Documents
              </h2>
              <p className="mb-4 text-sm text-slate-500">
                PDF, JPG or PNG, up to {rules.maxFileMb} MB each. Clear scans or photos; every corner visible.
              </p>
              <div className="grid gap-3 lg:grid-cols-2">
                {rules.docTypes.map((type) => (
                  <DocumentSlot
                    key={type}
                    type={type}
                    label={rules.docLabels[type]}
                    docs={docsOf(type)}
                    max={rules.maxPerType[type]}
                    needsDate={type === 'UTILITY_BILL' || type === 'PAST_INVOICE'}
                    editable={editable}
                    onUpload={upload}
                    onRemove={removeDoc}
                    uploading={uploading}
                  />
                ))}
              </div>
            </Card>
          )}

          {/* ── 3. Submit ── */}
          {app && editable && (
            <Card className="p-5">
              <h2 className="mb-3 flex items-center gap-2 font-semibold text-slate-900">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-brand-600 text-xs font-bold text-white">3</span> Review and submit
              </h2>
              {app.problems.length > 0 ? (
                <Alert tone="warning" title="Still needed before you can submit">
                  <ul className="list-disc space-y-0.5 pl-4">
                    {app.problems.map((p) => (
                      <li key={p}>{p}</li>
                    ))}
                  </ul>
                </Alert>
              ) : (
                <Alert tone="success" icon={CheckCircle2}>
                  Everything needed is here.
                </Alert>
              )}
              <label className="mt-4 flex items-start gap-3 text-sm text-slate-700">
                <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-0.5 h-4 w-4 accent-brand-600" />
                <span>
                  I confirm these documents are genuine and belong to this business, and I agree that CustomT administrators may review them to verify my business.
                  Documents are kept privately and deleted if the application is withdrawn or rejected (after {180} days).
                </span>
              </label>
              <ErrorList error={submitError} />
              <div className="mt-4 flex flex-wrap items-center gap-3">
                <Button size="lg" icon={Send} onClick={submit} loading={submitting} disabled={!consent || app.problems.length > 0}>
                  {app.status === 'CHANGES_REQUESTED' ? 'Submit again' : 'Submit for review'}
                </Button>
                <button type="button" onClick={withdraw} className="text-sm font-medium text-slate-500 underline hover:text-red-600">
                  Withdraw application
                </button>
              </div>
            </Card>
          )}

          {app?.status === 'PENDING_APPROVAL' && (
            <p className="flex items-center gap-1.5 text-xs text-slate-500">
              <ShieldCheck className="h-4 w-4 text-emerald-600" /> Your documents are only visible to CustomT administrators, and every view is logged.
            </p>
          )}
        </div>
      )}

      {!open && !started && !data.canApply && data.reapplyAfter && (
        <p className="text-sm text-slate-500">You can start a new application from {formatDate(data.reapplyAfter, false)}.</p>
      )}
    </div>
  );
}
