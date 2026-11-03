import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { AlertTriangle, ArrowLeft, Gavel, History, MessagesSquare, PlayCircle, RotateCcw, Scale, ShieldCheck, SplitSquareHorizontal, Store, User } from 'lucide-react';
import { adminApi, orderApi, rfqApi } from '../../api/client';
import { useSocketEvents } from '../../context/SocketContext';
import { useToast } from '../../context/ToastContext';
import OrderProgress from '../../components/orders/OrderProgress';
import EscrowBreakdown from '../../components/orders/EscrowBreakdown';
import DisputeThread from '../../components/orders/DisputeThread';
import SpecSummary from '../../components/auction/SpecSummary';
import { Alert, Badge, Button, Card, CardHeader, ErrorList, Field, Modal, PageHeader, PageLoader, StatusBadge, Textarea, TrustStars, cx } from '../../components/ui';
import { formatDate, formatLKR, titleCase } from '../../utils/format';
import { statusMeta } from '../../utils/status';

const RESOLUTIONS = [
  { value: 'RELEASE_TO_VENDOR', title: 'Release to vendor', text: 'Goods meet the locked specification. Pay the held balance to the vendor.', icon: ShieldCheck },
  { value: 'REFUND_BUYER', title: 'Refund buyer', text: 'Goods are unusable. Return the held balance to the buyer wallet.', icon: RotateCcw },
  { value: 'SPLIT', title: 'Split settlement', text: 'Partial fault. Share the held balance by percentage.', icon: SplitSquareHorizontal },
  { value: 'RESUME_PRODUCTION', title: 'Resume production (reprint)', text: 'Vendor fixes or reprints. Escrow stays held for a fresh O2O inspection.', icon: PlayCircle },
];

function ResolvePanel({ order, onResolved }) {
  const toast = useToast();
  const [resolution, setResolution] = useState(order.dispute?.desiredResolution === 'FULL_REFUND' ? 'REFUND_BUYER' : order.dispute?.desiredResolution === 'REPRINT' ? 'RESUME_PRODUCTION' : 'SPLIT');
  const [vendorPercent, setVendorPercent] = useState(50);
  const [notes, setNotes] = useState('');
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const held = order.escrowHeld;
  const vendorAmount = resolution === 'RELEASE_TO_VENDOR' ? held : resolution === 'SPLIT' ? Math.round(held * vendorPercent) / 100 : 0;
  const buyerAmount = resolution === 'REFUND_BUYER' ? held : resolution === 'SPLIT' ? Math.round((held - vendorAmount) * 100) / 100 : 0;

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await adminApi.resolveDispute(order._id, { resolution, vendorPercent: resolution === 'SPLIT' ? vendorPercent : undefined, notes });
      toast.success(res.message, { title: 'Dispute resolved' });
      setConfirm(false);
      onResolved();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="grid gap-2 sm:grid-cols-2">
        {RESOLUTIONS.map(({ value, title, text, icon: Icon }) => (
          <button
            key={value}
            type="button"
            aria-pressed={resolution === value}
            onClick={() => setResolution(value)}
            className={cx('flex gap-3 rounded-xl border p-3 text-left transition', resolution === value ? 'border-brand-500 bg-brand-50 ring-2 ring-brand-200' : 'border-slate-200 hover:bg-slate-50')}
          >
            <Icon className={cx('mt-0.5 h-5 w-5 shrink-0', resolution === value ? 'text-brand-600' : 'text-slate-400')} />
            <span>
              <span className="block text-sm font-semibold text-slate-900">{title}</span>
              <span className="block text-xs text-slate-500">{text}</span>
            </span>
          </button>
        ))}
      </div>

      {resolution === 'SPLIT' && (
        <div className="rounded-xl border border-slate-200 p-4">
          <label htmlFor="split" className="flex justify-between text-sm font-medium text-slate-700">
            Vendor share <span className="font-mono">{vendorPercent}%</span>
          </label>
          <input id="split" type="range" min="1" max="99" value={vendorPercent} onChange={(e) => setVendorPercent(Number(e.target.value))} className="mt-2 w-full accent-brand-600" />
        </div>
      )}

      <dl className="grid grid-cols-3 gap-3 rounded-xl bg-slate-50 p-4 text-sm">
        <div>
          <dt className="text-slate-500">Held in escrow</dt>
          <dd className="font-mono font-semibold text-slate-900">{formatLKR(held)}</dd>
        </div>
        <div>
          <dt className="text-slate-500">To vendor</dt>
          <dd className="font-mono font-semibold text-emerald-700">{formatLKR(vendorAmount)}</dd>
        </div>
        <div>
          <dt className="text-slate-500">To buyer</dt>
          <dd className="font-mono font-semibold text-violet-700">{formatLKR(buyerAmount)}</dd>
        </div>
      </dl>

      <Field label="Mediator's note" hint="Included in the polite resolution message sent to both parties">
        <Textarea rows={3} maxLength={1000} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. Photos confirm 35 pieces have misaligned prints; a 30% refund reflects the affected share." />
      </Field>
      <Button icon={Scale} onClick={() => setConfirm(true)}>
        Resolve dispute
      </Button>

      <Modal
        open={confirm}
        onClose={() => !busy && setConfirm(false)}
        title="Confirm resolution"
        subtitle={RESOLUTIONS.find((r) => r.value === resolution)?.title}
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirm(false)} disabled={busy}>
              Back
            </Button>
            <Button loading={busy} onClick={submit}>
              Confirm & notify parties
            </Button>
          </>
        }
      >
        <p className="text-sm text-slate-600">
          {resolution === 'RESUME_PRODUCTION'
            ? 'Escrow is unfrozen and stays held. The vendor resumes production, and the buyer will receive a new O2O PIN at the next inspection.'
            : `${formatLKR(vendorAmount)} goes to the vendor and ${formatLKR(buyerAmount)} to the buyer. Funds move immediately and this cannot be undone.`}
        </p>
        <ErrorList error={error} />
      </Modal>
    </div>
  );
}

export default function AdminOrderDetail() {
  const { id } = useParams();
  const [order, setOrder] = useState(null);
  const [rfq, setRfq] = useState(null);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    try {
      const res = await orderApi.get(id);
      setOrder(res.order);
      setError(null);
      return res.order;
    } catch (err) {
      setError(err);
      return null;
    }
  }, [id]);

  useEffect(() => {
    load().then((o) => o?.rfqId && rfqApi.get(o.rfqId).then(setRfq).catch(() => {}));
  }, [load]);

  useSocketEvents(['order:updated', 'order:completed', 'dispute:new', 'dispute:note', 'dispute:resolved'], (p) => p?.orderId === id && load());

  if (error) return <ErrorList error={error} />;
  if (!order) return <PageLoader />;

  const buyer = order.buyerId || {};
  const vendor = order.vendorId || {};
  const winning = rfq?.leaderboard?.find((e) => e.status === 'ACCEPTED');

  return (
    <div>
      <PageHeader
        back={
          <Link to={order.dispute?.isOpen ? '/admin/disputes' : '/admin/orders'} className="mb-2 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800">
            <ArrowLeft className="h-4 w-4" /> {order.dispute?.isOpen ? 'Disputes' : 'Escrow monitor'}
          </Link>
        }
        title={order.specSnapshot?.title}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-sm">{order.orderCode}</span>
            <StatusBadge status={order.orderStatus} />
            <StatusBadge status={order.escrowStatus} />
          </span>
        }
      />
      <Card className="mb-6 p-5">
        <OrderProgress order={order} />
      </Card>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="space-y-6">
          {order.dispute?.isOpen && (
            <Card className="border-red-200">
              <CardHeader icon={Scale} title="Mediation" subtitle={`Raised ${formatDate(order.dispute.raisedAt)} · ${titleCase(order.dispute.category)} · buyer prefers ${titleCase(order.dispute.desiredResolution)}`} />
              <div className="space-y-4 p-5">
                {order.dispute.toneFlagged && (
                  <Alert tone="warning" icon={AlertTriangle} title="Heightened emotion detected">
                    The buyer's statement contains heated language. The vendor received a softened version. Acknowledge feelings before facts in your messages.
                  </Alert>
                )}
                <div className="rounded-xl bg-slate-50 p-4">
                  <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Buyer statement (verbatim, admin only)</p>
                  <p className="mt-1 whitespace-pre-line text-sm text-slate-800">{order.dispute.description}</p>
                  {order.dispute.evidenceUrls?.length > 0 && (
                    <ul className="mt-2 space-y-1 text-sm">
                      {order.dispute.evidenceUrls.map((u) => (
                        <li key={u}>
                          <a href={u} target="_blank" rel="noreferrer" className="break-all text-brand-700 underline">
                            {u}
                          </a>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                <ResolvePanel order={order} onResolved={load} />
              </div>
            </Card>
          )}

          {order.dispute?.resolution && !order.dispute.isOpen && (
            <Alert tone="success" icon={Scale} title={`Resolved: ${titleCase(order.dispute.resolution)}`}>
              {formatDate(order.dispute.resolvedAt)} · vendor {formatLKR(order.dispute.vendorAmount)} · buyer {formatLKR(order.dispute.buyerAmount)}
              {order.dispute.resolutionNotes && <p className="mt-1">Note: {order.dispute.resolutionNotes}</p>}
            </Alert>
          )}

          {order.disputeNotes?.length > 0 && (
            <Card>
              <CardHeader icon={MessagesSquare} title="Communication log" subtitle="All templated messages, including each party's private view" />
              <div className="p-5">
                <DisputeThread order={order} onNoteAdded={load} viewerRole="admin" />
              </div>
            </Card>
          )}

          <Card>
            <CardHeader icon={ShieldCheck} title="Escrow ledger" />
            <div className="p-5">
              <EscrowBreakdown order={order} viewer="admin" />
            </div>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader icon={User} title="Parties" />
            <div className="space-y-4 p-5 text-sm">
              <div>
                <p className="text-xs uppercase tracking-wide text-slate-500">Buyer</p>
                <p className="font-semibold text-slate-900">{buyer.name}</p>
                <p className="text-slate-500">
                  {buyer.email} · {buyer.phone}
                </p>
              </div>
              <div>
                <p className="flex items-center gap-1 text-xs uppercase tracking-wide text-slate-500">
                  <Store className="h-3.5 w-3.5" /> Vendor
                </p>
                <p className="font-semibold text-slate-900">{vendor.companyName}</p>
                <p className="text-slate-500">
                  {vendor.email} · {vendor.phone}
                </p>
                <div className="mt-1">
                  <TrustStars score={vendor.trustScore || 0} />
                </div>
              </div>
              {winning && (
                <div className="rounded-xl bg-slate-50 p-3">
                  <p className="flex items-center gap-1.5 text-xs uppercase tracking-wide text-slate-500">
                    <Gavel className="h-3.5 w-3.5" /> Winning bid
                  </p>
                  <p className="mt-1">
                    Rank #{winning.rank} of {rfq.leaderboard.length} · score <span className="font-mono">{winning.score.toFixed(4)}</span>
                  </p>
                  <p className="text-slate-500">
                    {formatLKR(winning.price)} · {winning.leadTimeDays} days
                  </p>
                </div>
              )}
              {order.buyerRating?.rating && (
                <p>
                  Buyer rating: <Badge tone="amber">{order.buyerRating.rating} / 5</Badge>
                </p>
              )}
            </div>
          </Card>
          {rfq?.rfq && (
            <Card>
              <CardHeader title="Locked specification" />
              <div className="p-5">
                <SpecSummary specs={rfq.rfq.designSpecs} expectedDeliveryDays={rfq.rfq.expectedDeliveryDays} />
              </div>
            </Card>
          )}
          <Card>
            <CardHeader icon={History} title="Timeline" />
            <ol className="space-y-3 p-5">
              {[...(order.productionTimeline || [])].reverse().map((t, i) => (
                <li key={`${t.status}-${i}`} className="flex gap-3 text-sm">
                  <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-brand-500" />
                  <div>
                    <p className="font-medium text-slate-800">{statusMeta(t.status).label === t.status ? titleCase(t.status) : statusMeta(t.status).label}</p>
                    {t.note && <p className="text-slate-500">{t.note}</p>}
                    <p className="text-xs text-slate-400">{formatDate(t.at)}</p>
                  </div>
                </li>
              ))}
            </ol>
          </Card>
        </div>
      </div>
    </div>
  );
}
