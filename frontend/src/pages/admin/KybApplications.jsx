import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowLeft,
  BadgeCheck,
  CheckCircle2,
  Download,
  ExternalLink,
  FileText,
  Image as ImageIcon,
  Loader2,
  RotateCcw,
  ShieldCheck,
  XCircle,
} from 'lucide-react';
import { adminKybApi } from '../../api/client';
import { useToast } from '../../context/ToastContext';
import { useSocketEvent } from '../../context/SocketContext';
import useAsync from '../../hooks/useAsync';
import { Alert, Badge, Button, Card, EmptyState, ErrorList, Field, Input, PageHeader, PageLoader, Tabs, Textarea, cx } from '../../components/ui';
import { formatDate, formatRelative } from '../../utils/format';

const STATUS_TABS = [
  { value: 'PENDING_APPROVAL', label: 'Awaiting review' },
  { value: 'CHANGES_REQUESTED', label: 'Changes requested' },
  { value: 'APPROVED', label: 'Approved' },
  { value: 'REJECTED', label: 'Rejected' },
  { value: 'DRAFT', label: 'Drafts' },
];
const STATUS_TONE = { DRAFT: 'slate', PENDING_APPROVAL: 'amber', CHANGES_REQUESTED: 'blue', APPROVED: 'green', REJECTED: 'red', WITHDRAWN: 'slate' };
const RISK_TEXT = {
  BR_NUMBER_ALREADY_REGISTERED: 'This BR number is already used by another vendor or application',
  PHONE_SHARED_WITH_EXISTING_VENDOR: "The applicant's phone number belongs to an existing vendor",
};
const riskText = (flag) => RISK_TEXT[flag] || (flag.startsWith('NIC_ON_') ? `This NIC is on ${flag.match(/\d+/)?.[0]} other application(s)` : flag);

// ───────────────────────────── Document viewer ─────────────────────────────

/**
 * Fetches a document with the admin's token (as a Blob) and shows it. The file never has a public URL;
 * every fetch is logged on the server. Images are shown inline; PDFs can be downloaded, or opened through a
 * 60-second Cloudflare R2 link when R2 is configured.
 */
function DocumentViewer({ applicationId, doc, onReviewed, reviewable }) {
  const toast = useToast();
  const [objectUrl, setObjectUrl] = useState(null);
  const [loading, setLoading] = useState(false);
  const [reason, setReason] = useState(doc.review?.reason || '');
  const [busy, setBusy] = useState(null);
  const isImage = doc.mimeType.startsWith('image/');

  useEffect(() => () => objectUrl && URL.revokeObjectURL(objectUrl), [objectUrl]);

  const load = async () => {
    setLoading(true);
    try {
      const blob = await adminKybApi.documentBlob(applicationId, doc._id);
      setObjectUrl(URL.createObjectURL(blob));
      return blob;
    } catch (err) {
      toast.error(err.status === 404 ? 'This document is no longer available.' : 'Could not load the document.');
      return null;
    } finally {
      setLoading(false);
    }
  };

  const download = async () => {
    const blob = objectUrl ? null : await load();
    const href = objectUrl || (blob && URL.createObjectURL(blob));
    if (!href) return;
    const a = document.createElement('a');
    a.href = href;
    a.download = doc.originalName || 'document';
    a.click();
  };

  const openLink = async () => {
    try {
      const { url } = await adminKybApi.documentLink(applicationId, doc._id);
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (err) {
      toast.error(err.message);
    }
  };

  const review = async (status) => {
    setBusy(status);
    try {
      const res = await adminKybApi.reviewDocument(applicationId, doc._id, { status, reason });
      onReviewed(res.application);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(null);
    }
  };

  const reviewStatus = doc.review?.status || 'PENDING';
  return (
    <div className={cx('rounded-xl border bg-white p-4', reviewStatus === 'ACCEPTED' ? 'border-emerald-300' : reviewStatus === 'REJECTED' ? 'border-red-300' : 'border-slate-200')}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 font-semibold text-slate-900">
            {isImage ? <ImageIcon className="h-4 w-4 text-sky-500" /> : <FileText className="h-4 w-4 text-red-500" />}
            {doc.label}
          </p>
          <p className="text-xs text-slate-500">
            {doc.originalName} · {(doc.sizeBytes / 1024).toFixed(0)} KB{doc.issuedOn ? ` · dated ${formatDate(doc.issuedOn, false)}` : ''}
          </p>
        </div>
        <Badge tone={reviewStatus === 'ACCEPTED' ? 'green' : reviewStatus === 'REJECTED' ? 'red' : 'slate'}>{reviewStatus.toLowerCase()}</Badge>
      </div>

      <div className="mt-3 flex min-h-[8rem] items-center justify-center overflow-hidden rounded-lg bg-slate-100">
        {objectUrl && isImage ? (
          <img src={objectUrl} alt={doc.label} className="max-h-96 w-full object-contain" />
        ) : (
          <div className="flex flex-col items-center gap-2 p-4 text-center text-sm text-slate-500">
            {objectUrl && !isImage ? 'PDF loaded. Download it or open it in a new tab to read it.' : 'Documents are loaded only when you open them. Each view is logged.'}
            <div className="flex flex-wrap justify-center gap-2">
              {isImage && !objectUrl && (
                <Button size="sm" variant="secondary" icon={loading ? Loader2 : ImageIcon} onClick={load} disabled={loading}>
                  Show image
                </Button>
              )}
              <Button size="sm" variant="secondary" icon={Download} onClick={download} disabled={loading}>
                Download
              </Button>
              <Button size="sm" variant="ghost" icon={ExternalLink} onClick={openLink}>
                Open (60-second link)
              </Button>
            </div>
          </div>
        )}
      </div>

      {reviewable && (
        <div className="mt-3 space-y-2">
          <Input value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} placeholder="Reason if not accepted (shown to the applicant)" />
          <div className="flex gap-2">
            <Button size="sm" variant="success" icon={CheckCircle2} loading={busy === 'ACCEPTED'} onClick={() => review('ACCEPTED')}>
              Accept
            </Button>
            <Button size="sm" variant="outlineDanger" icon={XCircle} loading={busy === 'REJECTED'} onClick={() => review('REJECTED')} disabled={reason.trim().length < 5}>
              Not accepted
            </Button>
          </div>
        </div>
      )}
      {!reviewable && reviewStatus === 'REJECTED' && doc.review?.reason && <p className="mt-2 text-xs text-red-700">Reason: {doc.review.reason}</p>}
    </div>
  );
}

// ───────────────────────────── Detail ─────────────────────────────

function ApplicationDetail({ id }) {
  const toast = useToast();
  const navigate = useNavigate();
  const { data, error, loading, setData } = useAsync(() => adminKybApi.get(id), [id]);
  const [notes, setNotes] = useState('');
  const [deciding, setDeciding] = useState(null);
  const [decisionError, setDecisionError] = useState(null);

  if (loading && !data) return <PageLoader label="Loading application…" />;
  if (error) return <ErrorList error={error} />;
  const app = data.application;
  const b = app.business || {};
  const reviewable = app.status === 'PENDING_APPROVAL';
  const allAccepted = app.documents.length > 0 && app.documents.every((d) => d.review.status === 'ACCEPTED');
  const anyRejected = app.documents.some((d) => d.review.status === 'REJECTED');
  const setApp = (application) => setData({ application });

  const decide = async (outcome) => {
    const confirmText = {
      APPROVED: `Approve ${b.legalName}? The account becomes a vendor account immediately.`,
      CHANGES_REQUESTED: 'Send the application back to the applicant for changes?',
      REJECTED: 'Reject this application? The applicant can reapply after 30 days.',
    }[outcome];
    if (!window.confirm(confirmText)) return;
    setDeciding(outcome);
    setDecisionError(null);
    try {
      const res = await adminKybApi.decide(app._id, { outcome, notes });
      setApp(res.application);
      toast.success(res.message);
      if (outcome !== 'CHANGES_REQUESTED') navigate('/admin/kyb');
    } catch (err) {
      setDecisionError(err);
    } finally {
      setDeciding(null);
    }
  };

  return (
    <div>
      <Link to="/admin/kyb" className="mb-3 inline-flex items-center gap-1 text-sm font-medium text-slate-500 hover:text-slate-800">
        <ArrowLeft className="h-4 w-4" /> All applications
      </Link>
      <PageHeader
        title={b.legalName || 'Unnamed business'}
        subtitle={`BR ${b.businessRegNo || '—'} · submitted ${app.submittedAt ? formatDate(app.submittedAt) : 'not yet'}${app.submissionCount > 1 ? ` · submission #${app.submissionCount}` : ''}`}
        actions={<Badge tone={STATUS_TONE[app.status]}>{app.status.replace(/_/g, ' ').toLowerCase()}</Badge>}
      />

      {app.riskFlags.length > 0 && (
        <Alert tone="warning" icon={AlertTriangle} title="Check carefully" className="mb-4">
          <ul className="list-disc pl-4">
            {app.riskFlags.map((f) => (
              <li key={f}>{riskText(f)}</li>
            ))}
          </ul>
        </Alert>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            {app.documents.map((doc) => (
              <DocumentViewer key={doc._id} applicationId={app._id} doc={doc} reviewable={reviewable} onReviewed={setApp} />
            ))}
          </div>
          {app.documents.length === 0 && <EmptyState icon={FileText} title="No documents" description="The documents were deleted under the retention policy, or none were uploaded." />}
        </div>

        <div className="space-y-4">
          <Card className="p-4">
            <h3 className="mb-2 text-sm font-semibold text-slate-900">Business</h3>
            <dl className="space-y-1.5 text-sm">
              {[
                ['Legal name', b.legalName],
                ['Trading name', b.tradingName],
                ['BR number', b.businessRegNo],
                ['Address', [b.address?.line1, b.address?.line2, b.address?.city, b.address?.district, b.address?.postalCode].filter(Boolean).join(', ')],
                ['Prints', (b.capabilities || []).join(', ')],
                ['Capacity', b.maxCapacity ? `${b.maxCapacity} pcs / order` : ''],
                ['Licence expiry', b.licenseExpiryDate ? formatDate(b.licenseExpiryDate, false) : ''],
              ].map(([k, v]) => (
                <div key={k} className="flex justify-between gap-3">
                  <dt className="text-slate-500">{k}</dt>
                  <dd className="text-right font-medium text-slate-900">{v || '—'}</dd>
                </div>
              ))}
            </dl>
          </Card>
          <Card className="p-4">
            <h3 className="mb-2 text-sm font-semibold text-slate-900">Owner and account</h3>
            <dl className="space-y-1.5 text-sm">
              {[
                ['Owner', app.owner.fullName],
                ['NIC', app.owner.nicLast4 ? `•••••••• ${app.owner.nicLast4}` : ''],
                ['Account', app.applicant?.name],
                ['E-mail', app.applicant?.email],
                ['Phone', app.applicant?.phone],
                ['Member since', app.applicant?.createdAt ? formatDate(app.applicant.createdAt, false) : ''],
              ].map(([k, v]) => (
                <div key={k} className="flex justify-between gap-3">
                  <dt className="text-slate-500">{k}</dt>
                  <dd className="truncate text-right font-medium text-slate-900">{v || '—'}</dd>
                </div>
              ))}
            </dl>
            <p className="mt-2 text-xs text-slate-500">Compare the NIC ending and the owner&apos;s name with the NIC image.</p>
          </Card>

          {reviewable && (
            <Card className="space-y-3 p-4">
              <h3 className="text-sm font-semibold text-slate-900">Decision</h3>
              {app.problems.length > 0 && (
                <Alert tone="danger" title="Rules not met">
                  <ul className="list-disc pl-4">
                    {app.problems.map((p) => (
                      <li key={p}>{p}</li>
                    ))}
                  </ul>
                </Alert>
              )}
              <Field label="Notes to the applicant" hint="Required when requesting changes without a rejected document, or when rejecting">
                <Textarea rows={3} maxLength={1000} value={notes} onChange={(e) => setNotes(e.target.value)} />
              </Field>
              <ErrorList error={decisionError} />
              <Button className="w-full" variant="success" icon={BadgeCheck} loading={deciding === 'APPROVED'} disabled={!allAccepted || app.problems.length > 0} onClick={() => decide('APPROVED')}>
                Approve as vendor
              </Button>
              {!allAccepted && <p className="text-xs text-slate-500">Accept every document to enable approval.</p>}
              <Button className="w-full" variant="secondary" icon={RotateCcw} loading={deciding === 'CHANGES_REQUESTED'} disabled={!anyRejected && notes.trim().length < 5} onClick={() => decide('CHANGES_REQUESTED')}>
                Request changes
              </Button>
              <Button className="w-full" variant="outlineDanger" icon={XCircle} loading={deciding === 'REJECTED'} disabled={notes.trim().length < 5} onClick={() => decide('REJECTED')}>
                Reject application
              </Button>
            </Card>
          )}

          {app.decision && (
            <Card className="p-4 text-sm">
              <h3 className="mb-1 font-semibold text-slate-900">Last decision</h3>
              <p>
                <Badge tone={STATUS_TONE[app.decision.outcome]}>{app.decision.outcome.replace(/_/g, ' ').toLowerCase()}</Badge>{' '}
                <span className="text-slate-500">{formatDate(app.decision.decidedAt)}</span>
              </p>
              {app.decision.notes && <p className="mt-1 text-slate-700">{app.decision.notes}</p>}
            </Card>
          )}

          <Card className="p-4">
            <h3 className="mb-2 text-sm font-semibold text-slate-900">History</h3>
            <ol className="space-y-1.5 text-xs text-slate-600">
              {app.history.map((h, i) => (
                // eslint-disable-next-line react/no-array-index-key
                <li key={i}>
                  <span className="font-medium text-slate-800">{h.status.replace(/_/g, ' ').toLowerCase()}</span> by {h.actorRole} · {formatDate(h.at)}
                  {h.note ? ` · ${h.note}` : ''}
                </li>
              ))}
            </ol>
          </Card>
          <p className="flex items-start gap-1.5 text-xs text-slate-500">
            <ShieldCheck className="mt-px h-3.5 w-3.5 shrink-0 text-emerald-600" /> Every document you open is recorded in the KYB access log.
          </p>
        </div>
      </div>
    </div>
  );
}

// ───────────────────────────── Queue ─────────────────────────────

function ApplicationQueue() {
  const [status, setStatus] = useState('PENDING_APPROVAL');
  const { data, error, loading, reload } = useAsync(() => adminKybApi.list({ status, limit: 50 }), [status]);
  useSocketEvent('kyb:submitted', () => reload({ silent: true }));

  return (
    <div>
      <PageHeader title="Vendor applications (KYB)" subtitle="Check each business's documents before it can sell on CustomT." />
      <Tabs value={status} onChange={setStatus} tabs={STATUS_TABS.map((t) => ({ ...t, count: t.value === 'PENDING_APPROVAL' && data ? data.pending : undefined }))} />
      <div className="mt-4">
        {loading && !data ? (
          <PageLoader />
        ) : error ? (
          <ErrorList error={error} />
        ) : data.items.length === 0 ? (
          <EmptyState icon={ShieldCheck} title="Nothing here" description="Applications in this state will appear here." />
        ) : (
          <Card className="divide-y divide-slate-100">
            {data.items.map((a) => (
              <Link key={a._id} to={`/admin/kyb/${a._id}`} className="flex flex-wrap items-center gap-3 px-4 py-3 hover:bg-slate-50">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold text-slate-900">{a.businessName}</p>
                  <p className="truncate text-xs text-slate-500">
                    BR {a.businessRegNo || '—'} · {a.applicant?.name} ({a.applicant?.email}) · {a.documents} document(s)
                  </p>
                </div>
                {a.riskFlags.length > 0 && (
                  <Badge tone="amber" icon={AlertTriangle}>
                    {a.riskFlags.length} flag{a.riskFlags.length === 1 ? '' : 's'}
                  </Badge>
                )}
                {a.submissionCount > 1 && <Badge tone="blue">resubmitted</Badge>}
                <span className="text-xs text-slate-500">{a.submittedAt ? `submitted ${formatRelative(a.submittedAt)}` : `updated ${formatRelative(a.updatedAt)}`}</span>
              </Link>
            ))}
          </Card>
        )}
      </div>
    </div>
  );
}

export default function KybApplications() {
  const { id } = useParams();
  return id ? <ApplicationDetail id={id} /> : <ApplicationQueue />;
}
