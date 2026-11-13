import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  ArrowRight,
  Banknote,
  CheckCircle2,
  Clock,
  Factory,
  Flag,
  History,
  KeyRound,
  Mail,
  MessagesSquare,
  Phone,
  QrCode,
  ScanSearch,
  ShieldCheck,
  Star,
  Truck,
  User,
} from 'lucide-react';
import { orderApi, rfqApi } from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import { useSocketEvents } from '../../context/SocketContext';
import { useToast } from '../../context/ToastContext';
import OrderProgress from '../../components/orders/OrderProgress';
import EscrowBreakdown from '../../components/orders/EscrowBreakdown';
import DisputeThread from '../../components/orders/DisputeThread';
import SpecSummary from '../../components/auction/SpecSummary';
import ReceiptButton from '../../components/orders/ReceiptButton';
import OrderChat from '../../components/chat/OrderChat';
import OtpInput from '../../components/vendor/OtpInput';
import QrScanner, { qrScanSupported } from '../../components/vendor/QrScanner';
import { Alert, Button, Card, CardHeader, ErrorList, Field, Modal, PageHeader, PageLoader, StatusBadge, Textarea, TrustStars } from '../../components/ui';
import { formatDate, formatLKR, titleCase } from '../../utils/format';
import { statusMeta } from '../../utils/status';

const ORDER_EVENTS = ['order:updated', 'order:completed', 'dispute:raised', 'dispute:note', 'dispute:resolved', 'o2o:failed-attempt'];

const STEP_COPY = {
  MATERIAL_SOURCED: {
    icon: Truck,
    title: 'Confirm materials are sourced',
    text: 'Blank garments, inks and threads matching the locked specification are in your workshop.',
    action: 'Mark materials sourced',
  },
  IN_PRODUCTION: {
    icon: Factory,
    title: 'Start production',
    text: 'Printing begins now. Milestone 1 releases the 30% booking advance to your wallet.',
    action: 'Start production & release 30%',
  },
  READY_FOR_INSPECTION: {
    icon: ScanSearch,
    title: 'Ready for buyer inspection',
    text: 'All pieces are printed, counted and packed. The buyer receives a 6-digit O2O PIN to hand you after inspecting the goods.',
    action: 'Mark ready for inspection',
  },
};

function ProductionPanel({ order, onUpdated }) {
  const toast = useToast();
  const [note, setNote] = useState('');
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const next = order.nextProductionStep;
  const copy = STEP_COPY[next];

  if (!copy) return null;
  const Icon = copy.icon;

  const submit = async () => {
    setBusy(true);
    try {
      const res = await orderApi.updateProduction(order._id, next, note.trim());
      toast.success(res.message);
      setConfirm(false);
      setNote('');
      onUpdated();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-4 rounded-xl border border-brand-200 bg-brand-50/50 p-4">
        <span className="rounded-xl bg-brand-600 p-2.5 text-white">
          <Icon className="h-5 w-5" />
        </span>
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-brand-700">Next milestone</p>
          <p className="font-semibold text-slate-900">{copy.title}</p>
          <p className="mt-1 text-sm text-slate-600">{copy.text}</p>
          {next === 'IN_PRODUCTION' && (
            <p className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-emerald-50 px-2.5 py-1 text-sm font-medium text-emerald-700">
              <Banknote className="h-4 w-4" /> {formatLKR(order.advanceAmount)} will be credited to your wallet
            </p>
          )}
        </div>
      </div>
      <Field label="Note for the buyer (optional)" hint="e.g. supplier, batch details or expected inspection date">
        <Textarea rows={2} maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} />
      </Field>
      <Button icon={ArrowRight} onClick={() => setConfirm(true)}>
        {copy.action}
      </Button>

      <Modal
        open={confirm}
        onClose={() => !busy && setConfirm(false)}
        title={`${copy.action}?`}
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirm(false)} disabled={busy}>
              Not yet
            </Button>
            <Button loading={busy} onClick={submit}>
              Confirm
            </Button>
          </>
        }
      >
        <p className="text-sm text-slate-600">
          Production steps are recorded on the order timeline and shared with the buyer in real time. They cannot be undone.
          {next === 'READY_FOR_INSPECTION' && ' Make sure every piece is ready: the buyer will be invited to inspect the order.'}
        </p>
      </Modal>
    </div>
  );
}

function O2OVerifyPanel({ order, onVerified }) {
  const toast = useToast();
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [scanOpen, setScanOpen] = useState(false);
  const remaining = error?.details?.attemptsRemaining ?? order.o2oAttemptsRemaining;
  const lockedOut = remaining === 0 || error?.code === 'O2O_PIN_LOCKED';

  const verify = async (value = pin) => {
    if (!/^\d{6}$/.test(value)) return;
    setBusy(true);
    setError(null);
    try {
      const res = await orderApi.verifyPin(order._id, value);
      toast.success(res.message, { title: 'O2O verified' });
      onVerified();
    } catch (err) {
      setError(err);
      setPin('');
    } finally {
      setBusy(false);
    }
  };

  const onScanned = useCallback(
    (scanned) => {
      setScanOpen(false);
      setPin(scanned);
      verify(scanned);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [order._id]
  );

  return (
    <div className="space-y-4">
      <Alert tone="info" icon={ShieldCheck} title="Online-to-Offline verification">
        Meet the buyer or deliver the order. After they inspect the goods, they will give you a 6-digit PIN (or show a QR code). Entering it releases the final{' '}
        <strong>{formatLKR(order.escrowHeld)}</strong> to your wallet.
      </Alert>
      <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5 text-center">
        <p className="mb-3 flex items-center justify-center gap-1.5 text-sm font-medium text-slate-700">
          <KeyRound className="h-4 w-4" /> Enter the buyer's O2O PIN
        </p>
        <OtpInput value={pin} onChange={setPin} disabled={busy || lockedOut} invalid={Boolean(error)} />
        <div className="mt-4 flex flex-wrap justify-center gap-2">
          <Button icon={CheckCircle2} variant="success" loading={busy} disabled={pin.length !== 6 || lockedOut} onClick={() => verify()}>
            Verify & release payment
          </Button>
          {qrScanSupported() && (
            <Button variant="secondary" icon={QrCode} disabled={lockedOut} onClick={() => setScanOpen(true)}>
              Scan QR
            </Button>
          )}
        </div>
        <p className="mt-3 text-xs text-slate-500">{remaining} attempt(s) remaining</p>
      </div>
      {error && (
        <Alert tone={lockedOut ? 'danger' : 'warning'} title={error.message}>
          {lockedOut && 'Ask the buyer to generate a new PIN from their order page. Your attempts reset automatically.'}
        </Alert>
      )}
      <QrScanner open={scanOpen} onClose={() => setScanOpen(false)} expectedOrderCode={order.orderCode} onPin={onScanned} />
    </div>
  );
}

export default function VendorOrderDetail() {
  const { id } = useParams();
  const { refreshUser } = useAuth();
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
    load().then((o) => o?.rfqId && rfqApi.get(o.rfqId).then((res) => setRfq(res.rfq)).catch(() => {}));
  }, [load]);

  useSocketEvents(ORDER_EVENTS, (payload) => {
    if (payload?.orderId !== id) return;
    load();
    refreshUser().catch(() => {});
  });

  const afterChange = () => {
    load();
    refreshUser().catch(() => {});
  };

  if (error) {
    return (
      <div className="space-y-4">
        <Link to="/vendor/orders" className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800">
          <ArrowLeft className="h-4 w-4" /> Orders
        </Link>
        <ErrorList error={error} />
      </div>
    );
  }
  if (!order) return <PageLoader label="Loading order…" />;

  const buyer = order.buyerId || {};

  return (
    <div>
      <PageHeader
        back={
          <Link to="/vendor/orders" className="mb-2 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800">
            <ArrowLeft className="h-4 w-4" /> Orders
          </Link>
        }
        title={order.specSnapshot?.title || order.orderCode}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-sm">{order.orderCode}</span>
            <StatusBadge status={order.orderStatus} />
            <Link to={`/vendor/rfqs/${order.rfqId}`} className="text-sm text-brand-700 hover:underline">
              RFQ {order.specSnapshot?.rfqCode}
            </Link>
          </span>
        }
      />

      <Card className="mb-6 p-5">
        <OrderProgress order={order} />
      </Card>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="space-y-6">
          {order.orderStatus === 'PENDING_ESCROW' && (
            <Alert tone="warning" icon={Clock} title="Waiting for the buyer to fund escrow">
              Please don't buy materials yet. You'll be notified the moment {formatLKR(order.agreedPrice)} is locked in escrow, and then production can start safely.
            </Alert>
          )}

          {order.orderStatus === 'IN_PROGRESS' && (
            <Card>
              <CardHeader icon={Factory} title={`Production: ${statusMeta(order.productionStatus).label}`} subtitle={`Committed lead time: ${order.leadTimeDays} days`} />
              <div className="p-5">
                <ProductionPanel order={order} onUpdated={afterChange} />
              </div>
            </Card>
          )}

          {order.orderStatus === 'AWAITING_O2O' && (
            <Card>
              <CardHeader icon={ScanSearch} title="Hand-over & O2O verification" subtitle="Milestone 2: final 70% settlement" />
              <div className="p-5">
                <O2OVerifyPanel order={order} onVerified={afterChange} />
              </div>
            </Card>
          )}

          {order.orderStatus === 'DISPUTED' && (
            <Alert tone="danger" icon={Flag} title="The buyer raised a quality concern: escrow is on hold">
              Category: {titleCase(order.dispute?.category)}. Your 30% advance is not affected. Please respond calmly with your perspective, photos or a proposed remedy
              below. A CustomT mediator will help both sides reach a fair outcome.
            </Alert>
          )}

          {order.orderStatus === 'COMPLETED' && (
            <Card className="p-5">
              <div className="flex items-start gap-3">
                <CheckCircle2 className="h-8 w-8 shrink-0 text-emerald-500" />
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-slate-900">Order completed: payment released</p>
                  <p className="text-sm text-slate-500">
                    {order.o2oMethod === 'ADMIN_RESOLUTION' ? `Settled through mediation on ${formatDate(order.completedAt)}.` : `Verified on ${formatDate(order.o2oVerifiedAt)}.`}
                  </p>
                </div>
                <ReceiptButton order={order} />
              </div>
              {order.buyerRating?.rating ? (
                <div className="mt-4 rounded-xl bg-slate-50 p-4">
                  <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-slate-500">
                    <Star className="h-3.5 w-3.5" /> Buyer rating
                  </p>
                  <div className="mt-1">
                    <TrustStars score={order.buyerRating.rating} size="md" showValue={false} />
                  </div>
                  {order.buyerRating.review && <p className="mt-2 text-sm italic text-slate-600">“{order.buyerRating.review}”</p>}
                  <p className="mt-2 text-xs text-slate-500">
                    Trust score {order.buyerRating.trustBefore?.toFixed(2)} → <strong>{order.buyerRating.trustAfter?.toFixed(2)}</strong>
                  </p>
                </div>
              ) : (
                <p className="mt-3 text-sm text-slate-500">The buyer hasn't rated this order yet.</p>
              )}
            </Card>
          )}

          {order.orderStatus === 'REFUNDED' && <Alert tone="info" title="This order was refunded to the buyer after mediation." />}
          {order.orderStatus === 'CANCELLED' && <Alert tone="info" title="The buyer cancelled this order before funding escrow." />}

          <OrderChat orderId={order._id} viewerRole="vendor" counterpartName={buyer.name} />

          {order.disputeNotes?.length > 0 && (
            <Card>
              <CardHeader icon={MessagesSquare} title="Resolution centre" subtitle="Polite, structured communication mediated by CustomT" />
              <div className="p-5">
                <DisputeThread order={order} onNoteAdded={load} viewerRole="vendor" />
              </div>
            </Card>
          )}

          <Card>
            <CardHeader icon={ShieldCheck} title="Escrow payouts" action={<ReceiptButton order={order} />} />
            <div className="p-5">
              <EscrowBreakdown order={order} viewer="vendor" />
            </div>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader icon={User} title="Buyer" subtitle="Contact for the O2O hand-over" />
            <div className="space-y-3 p-5 text-sm">
              <p className="font-semibold text-slate-900">{buyer.name}</p>
              {buyer.phone && (
                <a href={`tel:${buyer.phone}`} className="flex items-center gap-2 text-slate-700 hover:text-brand-700">
                  <Phone className="h-4 w-4 text-slate-400" /> {buyer.phone}
                </a>
              )}
              {buyer.email && (
                <a href={`mailto:${buyer.email}`} className="flex items-center gap-2 break-all text-slate-700 hover:text-brand-700">
                  <Mail className="h-4 w-4 text-slate-400" /> {buyer.email}
                </a>
              )}
            </div>
          </Card>

          {rfq && (
            <Card>
              <CardHeader title="Locked specification" subtitle="Produce exactly to this spec" />
              <div className="p-5">
                <SpecSummary specs={rfq.designSpecs} expectedDeliveryDays={rfq.expectedDeliveryDays} />
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
