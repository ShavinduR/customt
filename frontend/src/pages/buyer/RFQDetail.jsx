import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Ban, Calculator, CheckCircle2, Gavel, Hourglass, Lock, Package, Timer, TrendingDown, Users } from 'lucide-react';
import { rfqApi } from '../../api/client';
import { useSocket, useSocketEvent } from '../../context/SocketContext';
import { useToast } from '../../context/ToastContext';
import { useCatalog } from '../../context/CatalogContext';
import Leaderboard, { RankBadge, ScoreLegend } from '../../components/auction/Leaderboard';
import PriceDiagnosticAlert from '../../components/auction/PriceDiagnosticAlert';
import SpecSummary from '../../components/auction/SpecSummary';
import { Alert, Badge, Button, Card, CardHeader, Countdown, EmptyState, ErrorList, Field, PageHeader, PageLoader, StatusBadge, Textarea, TrustStars, Modal } from '../../components/ui';
import { formatDate, formatLKR } from '../../utils/format';

function Stat({ icon: Icon, label, children }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3">
      <Icon className="h-5 w-5 text-slate-400" />
      <div className="min-w-0">
        <p className="text-xs text-slate-500">{label}</p>
        <div className="font-semibold text-slate-900">{children}</div>
      </div>
    </div>
  );
}

export default function RFQDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const { catalog } = useCatalog();
  const { socket, connected, emitWithAck } = useSocket();

  const [snapshot, setSnapshot] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [flashIds, setFlashIds] = useState(new Set());
  const [extensionNotice, setExtensionNotice] = useState(null);
  const [accepting, setAccepting] = useState(null);
  const [acceptBusy, setAcceptBusy] = useState(false);
  const [acceptError, setAcceptError] = useState(null);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [cancelBusy, setCancelBusy] = useState(false);
  const flashTimer = useRef(null);
  const previousEntries = useRef(new Map());

  const rememberEntries = (entries) => {
    previousEntries.current = new Map(entries.map((e) => [e.bidId, e.lastSubmittedAt]));
  };

  const load = useCallback(async () => {
    try {
      const res = await rfqApi.get(id);
      setSnapshot(res);
      rememberEntries(res.leaderboard || []);
      setLoadError(null);
    } catch (err) {
      setLoadError(err);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  // Join the auction room (re-joins automatically after reconnects).
  useEffect(() => {
    if (!socket || !connected) return undefined;
    emitWithAck('rfq:join', { rfqId: id })
      .then((res) => {
        setSnapshot(res.snapshot);
        rememberEntries(res.snapshot.leaderboard || []);
      })
      .catch(() => {});
    return () => {
      socket.emit('rfq:leave', { rfqId: id });
    };
  }, [socket, connected, id, emitWithAck]);

  useEffect(() => () => clearTimeout(flashTimer.current), []);

  useSocketEvent('auction:leaderboard', (payload) => {
    if (payload.rfqId !== id) return;
    const changed = new Set(payload.leaderboard.filter((e) => previousEntries.current.get(e.bidId) !== e.lastSubmittedAt).map((e) => e.bidId));
    rememberEntries(payload.leaderboard);
    setSnapshot((prev) =>
      prev
        ? {
            ...prev,
            rfq: { ...prev.rfq, status: payload.status, expiresAt: payload.expiresAt, extensionCount: payload.extensionCount, bidCount: payload.bidCount },
            leaderboard: payload.leaderboard,
            priceDiagnostic: payload.priceDiagnostic,
          }
        : prev
    );
    if (changed.size) {
      setFlashIds(changed);
      clearTimeout(flashTimer.current);
      flashTimer.current = setTimeout(() => setFlashIds(new Set()), 1700);
    }
  });

  useSocketEvent('auction:extended', (payload) => {
    if (payload.rfqId !== id) return;
    setExtensionNotice(payload);
    setSnapshot((prev) => (prev ? { ...prev, rfq: { ...prev.rfq, expiresAt: payload.expiresAt, extensionCount: payload.extensionCount } } : prev));
  });

  useSocketEvent('auction:ended', (payload) => payload.rfqId === id && load());
  useSocketEvent('auction:closed', (payload) => payload.rfqId === id && load());

  if (loadError) {
    return (
      <div className="space-y-4">
        <Link to="/buyer/rfqs" className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800">
          <ArrowLeft className="h-4 w-4" /> My auctions
        </Link>
        <ErrorList error={loadError} />
      </div>
    );
  }
  if (!snapshot) return <PageLoader label="Joining auction room…" />;

  const { rfq, leaderboard = [], priceDiagnostic } = snapshot;
  const canAccept = ['OPEN', 'CLOSED'].includes(rfq.status);
  const canCancel = ['OPEN', 'CLOSED', 'EXPIRED'].includes(rfq.status);
  const bestPrice = leaderboard.length ? Math.min(...leaderboard.map((e) => e.price)) : null;
  const awarded = leaderboard.find((e) => e.status === 'ACCEPTED');
  const softCloseMs = catalog?.auction?.softCloseWindowMs || 120000;

  const confirmAccept = async () => {
    setAcceptBusy(true);
    setAcceptError(null);
    try {
      const res = await rfqApi.acceptBid(rfq._id, accepting.bidId);
      toast.success(res.message, { title: 'Bid accepted' });
      navigate(`/buyer/orders/${res.order._id}`);
    } catch (err) {
      setAcceptError(err);
    } finally {
      setAcceptBusy(false);
    }
  };

  const confirmCancel = async () => {
    setCancelBusy(true);
    try {
      await rfqApi.cancel(rfq._id, cancelReason);
      toast.info('The RFQ was cancelled and vendors were notified.');
      setCancelOpen(false);
      load();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setCancelBusy(false);
    }
  };

  const advanceRatio = catalog?.escrow?.advanceRatio ?? 0.3;

  return (
    <div>
      <PageHeader
        back={
          <Link to="/buyer/rfqs" className="mb-2 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800">
            <ArrowLeft className="h-4 w-4" /> My auctions
          </Link>
        }
        title={rfq.title}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-sm">{rfq.rfqCode}</span>
            <StatusBadge status={rfq.status} />
            <Badge tone="slate" icon={Lock}>
              Specs locked
            </Badge>
            <span className="text-sm">Launched {formatDate(rfq.createdAt)}</span>
          </span>
        }
        actions={
          <>
            {rfq.status === 'AWARDED' && rfq.orderId && (
              <Button icon={Package} onClick={() => navigate(`/buyer/orders/${rfq.orderId}`)}>
                View order
              </Button>
            )}
            {canCancel && (
              <Button variant="outlineDanger" icon={Ban} onClick={() => setCancelOpen(true)}>
                Cancel RFQ
              </Button>
            )}
          </>
        }
      />

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat icon={Timer} label={rfq.status === 'OPEN' ? 'Time remaining' : 'Bidding window'}>
          {rfq.status === 'OPEN' ? <Countdown expiresAt={rfq.expiresAt} softCloseMs={softCloseMs} compact /> : <span className="text-slate-500">Closed</span>}
        </Stat>
        <Stat icon={Gavel} label="Bids received">
          {rfq.bidCount} <span className="text-sm font-normal text-slate-500">from {rfq.eligibleVendorCount} eligible</span>
        </Stat>
        <Stat icon={TrendingDown} label="Lowest price">
          {bestPrice ? formatLKR(bestPrice) : '—'}
        </Stat>
        <Stat icon={Hourglass} label="Soft-close extensions">
          {rfq.extensionCount}
        </Stat>
      </div>

      {extensionNotice && rfq.status === 'OPEN' && (
        <Alert tone="warning" className="mb-4" title="Auction extended">
          {extensionNotice.message} New closing time: {formatDate(extensionNotice.expiresAt)}.
        </Alert>
      )}
      {rfq.status === 'CLOSED' && (
        <Alert tone="warning" className="mb-4" title="Bidding has ended — your decision is needed">
          Review the ranked bids below and accept the offer that suits you best. Rank #1 has the highest combined score for price, trust and lead time.
        </Alert>
      )}
      {rfq.status === 'EXPIRED' && (
        <Alert tone="info" className="mb-4" title="This auction ended without bids">
          No vendor bid within the window. You can{' '}
          <Link to="/buyer/rfqs/new" className="font-semibold underline">
            launch a new RFQ
          </Link>{' '}
          with adjusted quantity, delivery time or print method.
        </Alert>
      )}
      {rfq.status === 'AWARDED' && awarded && (
        <Alert tone="success" className="mb-4" title={`Awarded to ${awarded.companyName || awarded.vendorName} for ${formatLKR(awarded.price)}`}>
          Next step: fund escrow so production can begin.{' '}
          {rfq.orderId && (
            <Link to={`/buyer/orders/${rfq.orderId}`} className="font-semibold underline">
              Go to order
            </Link>
          )}
        </Alert>
      )}
      {rfq.status === 'CANCELLED' && (
        <Alert tone="info" className="mb-4" title="This RFQ was cancelled">
          {rfq.cancellationReason || 'No reason was given.'}
        </Alert>
      )}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="space-y-4">
          <PriceDiagnosticAlert diagnostic={priceDiagnostic} threshold={catalog?.auction?.priceCvThreshold} />
          <Card>
            <CardHeader
              icon={Gavel}
              title="Live ranked bids"
              subtitle="Vendors only see their own rank. Prices and identities are visible to you alone."
              action={
                <span className="hidden items-center gap-1.5 text-xs text-slate-500 sm:flex">
                  <span className={`h-2 w-2 rounded-full ${connected ? 'bg-emerald-500' : 'bg-slate-300'}`} />
                  {connected ? 'Live' : 'Reconnecting'}
                </span>
              }
            />
            <div className="p-4">
              {leaderboard.length === 0 ? (
                <EmptyState
                  icon={Users}
                  title={rfq.status === 'OPEN' ? 'Waiting for the first bids' : 'No bids were placed'}
                  description={
                    rfq.status === 'OPEN'
                      ? `${rfq.eligibleVendorCount} prequalified vendor(s) have been notified. Bids will appear here instantly.`
                      : undefined
                  }
                />
              ) : (
                <>
                  <div className="mb-3">
                    <ScoreLegend />
                  </div>
                  <Leaderboard entries={leaderboard} canAccept={canAccept} onAccept={setAccepting} flashIds={flashIds} quantity={rfq.designSpecs.totalQuantity} />
                </>
              )}
            </div>
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader icon={Lock} title="Locked specification" />
            <div className="p-4">
              <SpecSummary specs={rfq.designSpecs} expectedDeliveryDays={rfq.expectedDeliveryDays} />
            </div>
          </Card>
          <Card className="p-4">
            <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
              <Calculator className="h-4 w-4 text-slate-400" /> How bids are ranked
            </h3>
            <p className="mt-2 rounded-lg bg-slate-50 p-3 font-mono text-[11px] leading-relaxed text-slate-700">
              score = (minPrice / price) × 0.50
              <br />+ (trust / maxTrust) × 0.30
              <br />+ (minLeadTime / leadTime) × 0.20
            </p>
            <p className="mt-2 text-xs text-slate-500">
              Rankings update with every new or revised bid. A bid placed in the final 2 minutes extends the auction by 5 minutes (soft-close).
            </p>
          </Card>
        </div>
      </div>

      <Modal
        open={Boolean(accepting)}
        onClose={() => !acceptBusy && setAccepting(null)}
        title="Accept this bid?"
        dismissible={!acceptBusy}
        footer={
          <>
            <Button variant="secondary" onClick={() => setAccepting(null)} disabled={acceptBusy}>
              Back to bids
            </Button>
            <Button variant="success" icon={CheckCircle2} loading={acceptBusy} onClick={confirmAccept}>
              Accept & create order
            </Button>
          </>
        }
      >
        {accepting && (
          <div className="space-y-4">
            <div className="flex items-center gap-3 rounded-xl border border-slate-200 p-3">
              <RankBadge rank={accepting.rank} />
              <div className="min-w-0">
                <p className="font-semibold text-slate-900">{accepting.companyName || accepting.vendorName}</p>
                <TrustStars score={accepting.trustScore} />
              </div>
            </div>
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between">
                <dt className="text-slate-500">Total price</dt>
                <dd className="font-mono font-semibold">{formatLKR(accepting.price)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-slate-500">Lead time</dt>
                <dd className="font-semibold">{accepting.leadTimeDays} days</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-slate-500">Score</dt>
                <dd className="font-mono">{accepting.score.toFixed(4)}</dd>
              </div>
            </dl>
            <div className="rounded-xl bg-slate-50 p-3 text-sm text-slate-700">
              <p className="font-medium text-slate-900">How your payment is protected</p>
              <ul className="mt-1 list-disc space-y-0.5 pl-4">
                <li>You pay {formatLKR(accepting.price)} into CustomT escrow. The vendor does not receive it directly.</li>
                <li>
                  {Math.round(advanceRatio * 100)}% ({formatLKR(accepting.price * advanceRatio)}) is released when production starts.
                </li>
                <li>
                  The remaining {formatLKR(accepting.price - accepting.price * advanceRatio)} is released only after you inspect the goods and share your O2O PIN.
                </li>
              </ul>
            </div>
            {rfq.status === 'OPEN' && <Alert tone="info">Accepting now ends the auction early. Other vendors will be notified.</Alert>}
            <ErrorList error={acceptError} />
          </div>
        )}
      </Modal>

      <Modal
        open={cancelOpen}
        onClose={() => !cancelBusy && setCancelOpen(false)}
        title="Cancel this RFQ?"
        subtitle="Bidding stops immediately and every participating vendor is notified."
        footer={
          <>
            <Button variant="secondary" onClick={() => setCancelOpen(false)} disabled={cancelBusy}>
              Keep RFQ
            </Button>
            <Button variant="danger" loading={cancelBusy} onClick={confirmCancel}>
              Cancel RFQ
            </Button>
          </>
        }
      >
        <Field label="Reason (shared with vendors)" hint="Optional, but a short explanation is appreciated by vendors who spent time quoting.">
          <Textarea rows={3} maxLength={300} value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} placeholder="e.g. Event postponed" />
        </Field>
      </Modal>
    </div>
  );
}
