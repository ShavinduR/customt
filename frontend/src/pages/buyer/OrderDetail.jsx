import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  BadgeCheck,
  Ban,
  CheckCircle2,
  Clock,
  CreditCard,
  Factory,
  Flag,
  History,
  Mail,
  MessagesSquare,
  Phone,
  ScanSearch,
  ShieldCheck,
  Star,
  Store,
  Wallet,
} from 'lucide-react';
import { orderApi, rfqApi } from '../../api/client';
import { useSocketEvents } from '../../context/SocketContext';
import { useToast } from '../../context/ToastContext';
import OrderProgress from '../../components/orders/OrderProgress';
import EscrowBreakdown from '../../components/orders/EscrowBreakdown';
import PaymentModal from '../../components/orders/PaymentModal';
import O2OPanel from '../../components/orders/O2OPanel';
import DisputeModal from '../../components/orders/DisputeModal';
import DisputeThread from '../../components/orders/DisputeThread';
import RatingModal from '../../components/orders/RatingModal';
import SpecSummary from '../../components/auction/SpecSummary';
import { Alert, Badge, Button, Card, CardHeader, ErrorList, Modal, PageHeader, PageLoader, StatusBadge, TrustStars } from '../../components/ui';
import { formatDate, formatLKR, titleCase } from '../../utils/format';
import { statusMeta } from '../../utils/status';

const ORDER_EVENTS = ['order:updated', 'order:completed', 'dispute:raised', 'dispute:note', 'dispute:resolved', 'o2o:ready'];

export default function OrderDetail() {
  const { id } = useParams();
  const toast = useToast();
  const [order, setOrder] = useState(null);
  const [rfq, setRfq] = useState(null);
  const [error, setError] = useState(null);
  const [modal, setModal] = useState(null); // 'pay' | 'dispute' | 'rate' | 'cancel'
  const [cancelBusy, setCancelBusy] = useState(false);

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
    load().then((o) => {
      if (o?.rfqId) rfqApi.get(o.rfqId).then((res) => setRfq(res.rfq)).catch(() => {});
    });
  }, [load]);

  // Live refresh for every order-related event that concerns this order.
  useSocketEvents(ORDER_EVENTS, (payload) => {
    if (payload?.orderId !== id) return;
    load().then((fresh) => {
      if (payload.promptRating && fresh?.canRate) setModal('rate');
    });
  });

  if (error) {
    return (
      <div className="space-y-4">
        <Link to="/buyer/orders" className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800">
          <ArrowLeft className="h-4 w-4" /> Orders
        </Link>
        <ErrorList error={error} />
      </div>
    );
  }
  if (!order) return <PageLoader label="Loading order…" />;

  const vendor = order.vendorId || {};
  const vendorName = vendor.companyName || vendor.name || 'Vendor';
  const canDispute = ['IN_PROGRESS', 'AWAITING_O2O'].includes(order.orderStatus) && ['ESCROW_LOCKED', 'PARTIALLY_RELEASED'].includes(order.escrowStatus);
  const showThread = order.disputeNotes?.length > 0;

  const cancelOrder = async () => {
    setCancelBusy(true);
    try {
      await orderApi.cancel(order._id);
      await load();
      setModal(null);
      toast.info('Order cancelled.');
    } catch (err) {
      toast.error(err.message);
    } finally {
      setCancelBusy(false);
    }
  };

  return (
    <div>
      <PageHeader
        back={
          <Link to="/buyer/orders" className="mb-2 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800">
            <ArrowLeft className="h-4 w-4" /> Orders
          </Link>
        }
        title={order.specSnapshot?.title || order.orderCode}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-sm">{order.orderCode}</span>
            <StatusBadge status={order.orderStatus} />
            <Link to={`/buyer/rfqs/${order.rfqId}`} className="text-sm text-brand-700 hover:underline">
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
          {/* ── Primary action area ── */}
          {order.orderStatus === 'PENDING_ESCROW' && (
            <Card>
              <CardHeader icon={CreditCard} title="Fund escrow to start production" subtitle="The vendor begins sourcing materials as soon as your payment is locked in escrow." />
              <div className="flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="font-mono text-2xl font-bold text-slate-900">{formatLKR(order.agreedPrice)}</p>
                  <p className="text-sm text-slate-500">Held safely by CustomT. Released in two milestones.</p>
                </div>
                <div className="flex gap-2">
                  <Button variant="ghost" icon={Ban} onClick={() => setModal('cancel')}>
                    Cancel order
                  </Button>
                  <Button size="lg" icon={ShieldCheck} onClick={() => setModal('pay')}>
                    Pay into escrow
                  </Button>
                </div>
              </div>
            </Card>
          )}

          {order.orderStatus === 'IN_PROGRESS' && (
            <Card>
              <CardHeader icon={Factory} title={statusMeta(order.productionStatus).label} subtitle={`Expected lead time: ${order.leadTimeDays} days from acceptance`} />
              <div className="space-y-3 p-5 text-sm text-slate-600">
                <p>
                  {order.productionStatus === 'NOT_STARTED' && 'Escrow is funded. The vendor will confirm once materials are sourced.'}
                  {order.productionStatus === 'MATERIAL_SOURCED' && 'Materials are sourced. The 30% advance is released when printing begins.'}
                  {order.productionStatus === 'IN_PRODUCTION' && "Your order is being printed. You'll receive an O2O verification PIN once it is ready for inspection."}
                </p>
                {canDispute && (
                  <Button variant="outlineDanger" size="sm" icon={Flag} onClick={() => setModal('dispute')}>
                    Report a problem
                  </Button>
                )}
              </div>
            </Card>
          )}

          {order.orderStatus === 'AWAITING_O2O' && (
            <Card>
              <CardHeader icon={ScanSearch} title="Online-to-Offline inspection" subtitle="Your goods are ready. Inspect them, then release the final payment." />
              <div className="p-5">
                <O2OPanel order={order} onCompleted={() => load().then((fresh) => fresh?.canRate && setModal('rate'))} onDispute={() => setModal('dispute')} />
              </div>
            </Card>
          )}

          {order.orderStatus === 'DISPUTED' && (
            <Alert tone="danger" icon={Flag} title="Dispute under mediation: escrow frozen">
              Category: {titleCase(order.dispute?.category)} · Preferred outcome: {titleCase(order.dispute?.desiredResolution)} · Raised {formatDate(order.dispute?.raisedAt)}
            </Alert>
          )}

          {order.orderStatus === 'COMPLETED' && (
            <Card className="p-5">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-start gap-3">
                  <CheckCircle2 className="h-8 w-8 shrink-0 text-emerald-500" />
                  <div>
                    <p className="font-semibold text-slate-900">Order completed</p>
                    <p className="text-sm text-slate-500">
                      {order.o2oMethod === 'PIN' && `Verified with your O2O PIN on ${formatDate(order.o2oVerifiedAt)}.`}
                      {order.o2oMethod === 'BUYER_APPROVAL' && `You approved the inspection on ${formatDate(order.o2oVerifiedAt)}.`}
                      {order.o2oMethod === 'ADMIN_RESOLUTION' && `Settled through mediation on ${formatDate(order.completedAt)}.`}
                    </p>
                  </div>
                </div>
                {order.canRate && (
                  <Button icon={Star} onClick={() => setModal('rate')}>
                    Rate {vendorName}
                  </Button>
                )}
              </div>
              {order.buyerRating?.rating && (
                <div className="mt-4 rounded-xl bg-slate-50 p-4">
                  <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Your rating</p>
                  <div className="mt-1">
                    <TrustStars score={order.buyerRating.rating} size="md" showValue={false} />
                  </div>
                  {order.buyerRating.review && <p className="mt-2 text-sm italic text-slate-600">“{order.buyerRating.review}”</p>}
                </div>
              )}
            </Card>
          )}

          {order.orderStatus === 'REFUNDED' && (
            <Alert tone="info" icon={Wallet} title="Refunded">
              {formatLKR(order.refundedAmount)} was returned to your CustomT wallet after mediation.
            </Alert>
          )}
          {order.orderStatus === 'CANCELLED' && <Alert tone="info" title="This order was cancelled before payment." />}

          {showThread && (
            <Card>
              <CardHeader icon={MessagesSquare} title="Resolution centre" subtitle="Polite, structured communication mediated by CustomT" />
              <div className="p-5">
                <DisputeThread order={order} onNoteAdded={load} />
              </div>
            </Card>
          )}

          <Card>
            <CardHeader icon={ShieldCheck} title="Escrow" subtitle="Split-payment protection" />
            <div className="p-5">
              <EscrowBreakdown order={order} />
            </div>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader icon={Store} title="Your vendor" />
            <div className="space-y-3 p-5 text-sm">
              <div>
                <p className="font-semibold text-slate-900">{vendorName}</p>
                <p className="text-slate-500">{vendor.name}</p>
              </div>
              <TrustStars score={vendor.trustScore || 0} />
              <div className="flex flex-wrap gap-1">
                {vendor.skillBadges?.map((b) => (
                  <Badge key={b} tone="violet" icon={BadgeCheck}>
                    {b}
                  </Badge>
                ))}
              </div>
              {vendor.phone && (
                <a href={`tel:${vendor.phone}`} className="flex items-center gap-2 text-slate-700 hover:text-brand-700">
                  <Phone className="h-4 w-4 text-slate-400" /> {vendor.phone}
                </a>
              )}
              {vendor.email && (
                <a href={`mailto:${vendor.email}`} className="flex items-center gap-2 break-all text-slate-700 hover:text-brand-700">
                  <Mail className="h-4 w-4 text-slate-400" /> {vendor.email}
                </a>
              )}
              <p className="flex items-center gap-2 text-slate-700">
                <Clock className="h-4 w-4 text-slate-400" /> Lead time {order.leadTimeDays} days
              </p>
            </div>
          </Card>

          {rfq && (
            <Card>
              <CardHeader title="Locked specification" />
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

      <PaymentModal order={order} open={modal === 'pay'} onClose={() => setModal(null)} onPaid={load} />
      <DisputeModal order={order} open={modal === 'dispute'} onClose={() => setModal(null)} onRaised={load} />
      <RatingModal order={order} vendorName={vendorName} open={modal === 'rate'} onClose={() => setModal(null)} onRated={load} />
      <Modal
        open={modal === 'cancel'}
        onClose={() => !cancelBusy && setModal(null)}
        title="Cancel this order?"
        footer={
          <>
            <Button variant="secondary" onClick={() => setModal(null)} disabled={cancelBusy}>
              Keep order
            </Button>
            <Button variant="danger" loading={cancelBusy} onClick={cancelOrder}>
              Cancel order
            </Button>
          </>
        }
      >
        <p className="text-sm text-slate-600">No payment has been made, so nothing will be charged. The RFQ will also be closed, and the vendor will be notified.</p>
      </Modal>
    </div>
  );
}
