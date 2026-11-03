import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, CalendarClock, FileText, Gavel, History, Hourglass, Lock, Package, PartyPopper, Timer, Trophy } from 'lucide-react';
import { orderApi, rfqApi } from '../../api/client';
import { useSocket, useSocketEvent } from '../../context/SocketContext';
import { useToast } from '../../context/ToastContext';
import { useCatalog } from '../../context/CatalogContext';
import SpecSummary from '../../components/auction/SpecSummary';
import RankDisplay from '../../components/vendor/RankDisplay';
import BidModal from '../../components/vendor/BidModal';
import PeraLockScreen from '../../components/vendor/PeraLockScreen';
import { Alert, Badge, Button, Card, CardHeader, Countdown, ErrorList, PageHeader, PageLoader, StatusBadge } from '../../components/ui';
import { formatDate, formatLKR, formatRelative } from '../../utils/format';

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

export default function AuctionRoom() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const { catalog } = useCatalog();
  const { socket, connected, emitWithAck } = useSocket();

  const [view, setView] = useState(null);
  const [error, setError] = useState(null);
  const [previousRank, setPreviousRank] = useState(null);
  const [bidOpen, setBidOpen] = useState(false);
  const [extension, setExtension] = useState(null);
  const [orderId, setOrderId] = useState(null);
  const rankRef = useRef(null);

  const applySnapshot = useCallback((snap) => {
    setView(snap);
    rankRef.current = snap.rank;
  }, []);

  const load = useCallback(async () => {
    try {
      applySnapshot(await rfqApi.get(id));
      setError(null);
    } catch (err) {
      setError(err);
    }
  }, [id, applySnapshot]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!socket || !connected) return undefined;
    emitWithAck('rfq:join', { rfqId: id })
      .then((res) => applySnapshot(res.snapshot))
      .catch(() => {});
    return () => socket.emit('rfq:leave', { rfqId: id });
  }, [socket, connected, id, emitWithAck, applySnapshot]);

  // Winner: find the order created for this RFQ.
  useEffect(() => {
    if (!view?.isWinner || orderId) return;
    orderApi
      .list({ limit: 50 })
      .then((res) => setOrderId(res.items.find((o) => o.rfqId === id)?._id || null))
      .catch(() => {});
  }, [view?.isWinner, orderId, id]);

  useSocketEvent('auction:rank', (p) => {
    if (p.rfqId !== id) return;
    const before = rankRef.current;
    if (before && p.rank > before) toast.warning(`Another offer moved ahead. You're now #${p.rank} of ${p.totalBids}.`, { title: 'You were outranked' });
    if (before && p.rank < before) toast.success(`You moved up to #${p.rank} of ${p.totalBids}.`);
    if (before !== p.rank) setPreviousRank(before);
    rankRef.current = p.rank;
    setView((v) => (v ? { ...v, myBid: p.myBid, rank: p.rank, totalBids: p.totalBids, rankLabel: p.rankLabel, rfq: { ...v.rfq, status: p.status, expiresAt: p.expiresAt, bidCount: p.totalBids } } : v));
  });
  useSocketEvent('auction:activity', (p) => {
    if (p.rfqId !== id) return;
    setView((v) => (v ? { ...v, totalBids: p.bidCount, rfq: { ...v.rfq, status: p.status, bidCount: p.bidCount, expiresAt: p.expiresAt, extensionCount: p.extensionCount } } : v));
  });
  useSocketEvent('auction:extended', (p) => {
    if (p.rfqId !== id) return;
    setExtension(p);
    setView((v) => (v ? { ...v, rfq: { ...v.rfq, expiresAt: p.expiresAt, extensionCount: p.extensionCount } } : v));
  });
  useSocketEvent('auction:awarded', (p) => {
    if (p.rfqId !== id) return;
    setOrderId(p.orderId);
    load();
  });
  useSocketEvent('auction:lost', (p) => p.rfqId === id && load());
  useSocketEvent('auction:ended', (p) => p.rfqId === id && load());
  useSocketEvent('auction:closed', (p) => p.rfqId === id && load());

  if (error) {
    const locked = ['PERA_PARTICIPANT_LOCK', 'PERA_QUALIFICATION_LOCK'].includes(error.code);
    return (
      <div className="space-y-4">
        <Link to="/vendor/rfqs" className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800">
          <ArrowLeft className="h-4 w-4" /> Live RFQs
        </Link>
        {locked ? (
          <Alert tone="warning" icon={Lock} title={error.message}>
            <ul className="list-disc pl-4">
              {(error.details || []).map((d) => (
                <li key={d}>{d}</li>
              ))}
            </ul>
          </Alert>
        ) : (
          <ErrorList error={error} />
        )}
      </div>
    );
  }
  if (!view) return <PageLoader label="Entering auction room…" />;

  const { rfq, myBid, rank, totalBids, eligibility, isWinner } = view;
  const open = rfq.status === 'OPEN' && new Date(rfq.expiresAt).getTime() > Date.now();
  const lost = rfq.status === 'AWARDED' && !isWinner && myBid;

  return (
    <div>
      <PageHeader
        back={
          <Link to="/vendor/rfqs" className="mb-2 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800">
            <ArrowLeft className="h-4 w-4" /> Live RFQs
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
            <span className="text-sm">Posted {formatRelative(rfq.createdAt)}</span>
          </span>
        }
        actions={
          open &&
          eligibility?.eligible && (
            <Button size="lg" icon={Gavel} onClick={() => setBidOpen(true)}>
              {myBid ? 'Improve bid' : 'Place bid'}
            </Button>
          )
        }
      />

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat icon={Timer} label={open ? 'Time remaining' : 'Bidding'}>
          {open ? <Countdown expiresAt={rfq.expiresAt} softCloseMs={catalog?.auction?.softCloseWindowMs} compact /> : <span className="text-slate-500">Closed</span>}
        </Stat>
        <Stat icon={Gavel} label="Competing bids">
          {rfq.bidCount}
        </Stat>
        <Stat icon={CalendarClock} label="Buyer's delivery target">
          {rfq.expectedDeliveryDays} days
        </Stat>
        <Stat icon={Hourglass} label="Soft-close extensions">
          {rfq.extensionCount}
        </Stat>
      </div>

      {extension && open && (
        <Alert tone="warning" className="mb-4" title="Auction extended">
          {extension.message} New closing time: {formatDate(extension.expiresAt)}.
        </Alert>
      )}
      {isWinner && (
        <Alert tone="success" icon={PartyPopper} className="mb-4" title="Congratulations, you won this auction!">
          The buyer accepted your bid of {formatLKR(myBid?.price)}. Start production once the buyer has funded escrow.{' '}
          {orderId && (
            <button type="button" onClick={() => navigate(`/vendor/orders/${orderId}`)} className="font-semibold underline">
              Open the order
            </button>
          )}
        </Alert>
      )}
      {lost && (
        <Alert tone="info" className="mb-4" title="The buyer chose another offer">
          Thank you for bidding. Your final rank was #{rank} of {totalBids}. Keep an eye on the live feed for new RFQs.
        </Alert>
      )}
      {rfq.status === 'CLOSED' && (
        <Alert tone="info" className="mb-4" title="Bidding has closed">
          The buyer is reviewing the ranked offers. {rank ? `Your final rank is #${rank} of ${totalBids}.` : ''}
        </Alert>
      )}
      {rfq.status === 'CANCELLED' && <Alert tone="info" className="mb-4" title="The buyer cancelled this RFQ." />}
      {eligibility && !eligibility.eligible && (
        <div className="mb-4">
          <PeraLockScreen issues={eligibility.reasons} compact />
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_24rem]">
        <div className="space-y-6">
          <Card>
            <CardHeader icon={Trophy} title="Your position" subtitle="Rank-based partial visibility: you see your own standing only." />
            <div className="grid gap-6 p-6 sm:grid-cols-[auto_1fr] sm:items-center">
              <RankDisplay rank={rank} totalBids={totalBids} previousRank={previousRank} />
              {myBid ? (
                <dl className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <dt className="text-slate-500">Your total price</dt>
                    <dd className="font-mono text-lg font-bold text-slate-900">{formatLKR(myBid.price)}</dd>
                    <dd className="text-xs text-slate-500">{formatLKR(myBid.unitPrice)} per piece</dd>
                  </div>
                  <div>
                    <dt className="text-slate-500">Lead time</dt>
                    <dd className="text-lg font-bold text-slate-900">{myBid.leadTimeDays} days</dd>
                  </div>
                  <div className="col-span-2">
                    <dt className="text-slate-500">Last submitted</dt>
                    <dd className="text-slate-800">{formatDate(myBid.lastSubmittedAt)}</dd>
                  </div>
                  {myBid.notes && (
                    <div className="col-span-2">
                      <dt className="text-slate-500">Your notes</dt>
                      <dd className="italic text-slate-700">“{myBid.notes}”</dd>
                    </div>
                  )}
                  {open && (
                    <div className="col-span-2">
                      <Button variant={rank === 1 ? 'secondary' : 'primary'} icon={Gavel} onClick={() => setBidOpen(true)}>
                        {rank === 1 ? 'Adjust bid' : 'Improve bid to climb'}
                      </Button>
                    </div>
                  )}
                </dl>
              ) : (
                <div className="text-sm text-slate-600">
                  <p>You haven't bid on this RFQ yet. Your rank depends on:</p>
                  <ul className="mt-2 space-y-1">
                    <li>• Price (50%): lower than the cheapest offer scores best</li>
                    <li>• Trust score (30%): earned through well-rated orders</li>
                    <li>• Lead time (20%): faster delivery scores higher</li>
                  </ul>
                  {open && eligibility?.eligible && (
                    <Button className="mt-4" icon={Gavel} onClick={() => setBidOpen(true)}>
                      Place your first bid
                    </Button>
                  )}
                </div>
              )}
            </div>
          </Card>

          {myBid?.revisions?.length > 0 && (
            <Card>
              <CardHeader icon={History} title="Your bid history" subtitle={`${myBid.revisionCount} revision(s), multi-round re-bidding`} />
              <ol className="divide-y divide-slate-100">
                {[...myBid.revisions, { price: myBid.price, leadTimeDays: myBid.leadTimeDays, submittedAt: myBid.lastSubmittedAt, current: true }]
                  .reverse()
                  .map((r, i) => (
                    <li key={`${r.submittedAt}-${i}`} className="flex items-center justify-between gap-3 px-5 py-3 text-sm">
                      <span className="text-slate-500">{formatDate(r.submittedAt)}</span>
                      <span className="flex items-center gap-3">
                        <span className="font-mono font-semibold text-slate-900">{formatLKR(r.price)}</span>
                        <span className="text-slate-600">{r.leadTimeDays} d</span>
                        {r.current && <Badge tone="brand">Current</Badge>}
                      </span>
                    </li>
                  ))}
              </ol>
            </Card>
          )}

          {rfq.description && (
            <Card>
              <CardHeader icon={FileText} title="Buyer's notes" />
              <p className="whitespace-pre-line p-5 text-sm text-slate-700">{rfq.description}</p>
            </Card>
          )}
        </div>

        <Card>
          <CardHeader icon={Package} title="Technical specification" subtitle="Locked: it will not change after you bid" />
          <div className="p-5">
            <SpecSummary specs={rfq.designSpecs} expectedDeliveryDays={rfq.expectedDeliveryDays} />
          </div>
        </Card>
      </div>

      <BidModal
        open={bidOpen}
        onClose={() => setBidOpen(false)}
        rfq={rfq}
        myBid={myBid}
        rank={rank}
        totalBids={totalBids}
        onPlaced={(res) => {
          setPreviousRank(rankRef.current);
          rankRef.current = res.rank;
          setView((v) => ({ ...v, myBid: res.myBid, rank: res.rank, totalBids: res.totalBids, rankLabel: res.rankLabel, rfq: { ...v.rfq, expiresAt: res.expiresAt, bidCount: res.totalBids } }));
        }}
      />
    </div>
  );
}
