import { useEffect, useState } from 'react';
import { AlertTriangle, EyeOff, Gavel, Hourglass, Send, Timer } from 'lucide-react';
import { rfqApi } from '../../api/client';
import { useSocket } from '../../context/SocketContext';
import { useCatalog } from '../../context/CatalogContext';
import { useAuth } from '../../context/AuthContext';
import RankDisplay from './RankDisplay';
import { Alert, Button, Countdown, ErrorList, Field, Input, Modal, Textarea, TrustStars, cx } from '../ui';
import { formatLKR } from '../../utils/format';

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

/**
 * Real-time bidding modal: place a first bid or revise (multi-round re-bidding).
 * Submits over Socket.IO (bid:place with ack) and falls back to REST if the socket is down.
 * The response only ever contains the vendor's own bid and rank.
 */
export default function BidModal({ open, onClose, rfq, myBid, rank, totalBids, onPlaced }) {
  const { connected, emitWithAck } = useSocket();
  const { catalog } = useCatalog();
  const { user } = useAuth();
  const qty = rfq?.designSpecs?.totalQuantity || 1;
  const allowIncrease = catalog?.auction?.allowPriceIncrease;
  const maxLead = catalog?.auction?.maxLeadTimeDays || 120;

  const [mode, setMode] = useState('total');
  const [amount, setAmount] = useState('');
  const [leadTimeDays, setLeadTimeDays] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);

  useEffect(() => {
    if (!open) return;
    setResult(null);
    setError(null);
    setMode('total');
    setAmount(myBid ? String(myBid.price) : '');
    setLeadTimeDays(myBid ? String(myBid.leadTimeDays) : rfq ? String(rfq.expectedDeliveryDays) : '');
    setNotes(myBid?.notes || '');
    // Reset only when the modal opens: live rank updates must not wipe what the vendor is typing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!rfq) return null;

  const numeric = Number(amount);
  const total = mode === 'total' ? round2(numeric) : round2(numeric * qty);
  const unit = mode === 'total' ? round2(numeric / qty) : round2(numeric);
  const lead = Number(leadTimeDays);
  const ended = new Date(rfq.expiresAt).getTime() <= Date.now();

  const problems = [];
  if (!(numeric > 0)) problems.push('Enter your price');
  if (myBid && !allowIncrease && total > myBid.price) problems.push(`A re-bid cannot be higher than your current ${formatLKR(myBid.price)}`);
  if (!Number.isInteger(lead) || lead < 1 || lead > maxLead) problems.push(`Lead time must be 1–${maxLead} whole days`);
  if (myBid && total === myBid.price && lead === myBid.leadTimeDays && notes.trim() === (myBid.notes || '')) problems.push('Change your price, lead time or notes to re-bid');

  const lowerBy = (pct) => {
    const base = myBid ? myBid.price : total;
    if (!base) return;
    const next = round2(base * (1 - pct / 100));
    setMode('total');
    setAmount(String(next));
  };

  const submit = async (e) => {
    e.preventDefault();
    if (problems.length) return;
    setBusy(true);
    setError(null);
    const payload = { rfqId: rfq._id, price: total, leadTimeDays: lead, notes: notes.trim() };
    try {
      let res;
      if (connected) {
        res = (await emitWithAck('bid:place', payload)).result;
      } else {
        res = await rfqApi.placeBid(rfq._id, payload);
      }
      setResult({ ...res, previousRank: rank });
      onPlaced?.(res);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  if (result) {
    return (
      <Modal open={open} onClose={onClose} title={result.isRevision ? 'Bid updated' : 'Bid placed'} size="sm" footer={<Button onClick={onClose}>Back to auction</Button>}>
        <div className="space-y-4">
          <RankDisplay rank={result.rank} totalBids={result.totalBids} previousRank={result.previousRank} />
          <dl className="space-y-1.5 rounded-xl bg-slate-50 p-3 text-sm">
            <div className="flex justify-between">
              <dt className="text-slate-500">Your price</dt>
              <dd className="font-mono font-semibold">{formatLKR(result.myBid.price)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-500">Lead time</dt>
              <dd className="font-semibold">{result.myBid.leadTimeDays} days</dd>
            </div>
          </dl>
          {result.extended && (
            <Alert tone="warning" icon={Hourglass}>
              Your bid landed in the final 2 minutes, so the auction was extended by 5 minutes (soft-close).
            </Alert>
          )}
        </div>
      </Modal>
    );
  }

  return (
    <Modal
      open={open}
      onClose={() => !busy && onClose()}
      dismissible={!busy}
      size="lg"
      title={myBid ? 'Improve your bid' : 'Place your bid'}
      subtitle={`${rfq.rfqCode} · ${rfq.title}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" form="bid-form" icon={Send} loading={busy} disabled={problems.length > 0 || ended}>
            {myBid ? 'Submit revised bid' : 'Submit bid'}
          </Button>
        </>
      }
    >
      <form id="bid-form" onSubmit={submit} className="space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-slate-50 px-4 py-3 text-sm">
          <span className="flex items-center gap-2 text-slate-600">
            <Timer className="h-4 w-4" /> Closes in <Countdown expiresAt={rfq.expiresAt} softCloseMs={catalog?.auction?.softCloseWindowMs} compact />
          </span>
          <span className="text-slate-600">
            <strong>{qty}</strong> pcs · deliver within <strong>{rfq.expectedDeliveryDays}</strong> days
          </span>
          {rank && (
            <span className="font-semibold text-slate-900">
              Current rank #{rank} of {totalBids}
            </span>
          )}
        </div>

        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <span className="text-sm font-medium text-slate-700">Your price (LKR)</span>
            <div className="flex rounded-lg bg-slate-100 p-0.5 text-xs">
              {[
                ['total', 'Total order'],
                ['unit', 'Per piece'],
              ].map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => {
                    if (numeric > 0) setAmount(String(value === 'total' ? total : unit));
                    setMode(value);
                  }}
                  className={cx('rounded-md px-2.5 py-1 font-medium', mode === value ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500')}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <Input type="number" min="1" step="0.01" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} className="font-mono text-lg" placeholder="0.00" autoFocus />
          <p className="mt-1.5 text-sm text-slate-600">
            {numeric > 0 ? (
              <>
                Total <span className="font-mono font-semibold">{formatLKR(total)}</span> · <span className="font-mono">{formatLKR(unit)}</span> per piece × {qty}
              </>
            ) : (
              'Quote the full price for all pieces, or switch to a per-piece price.'
            )}
          </p>
          {myBid && (
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
              <span className="text-slate-500">Current: {formatLKR(myBid.price)} · Quick lower:</span>
              {[1, 2, 5].map((pct) => (
                <button key={pct} type="button" onClick={() => lowerBy(pct)} className="rounded-full border border-slate-200 bg-white px-2.5 py-0.5 font-medium text-slate-600 hover:border-brand-300 hover:text-brand-700">
                  −{pct}%
                </button>
              ))}
            </div>
          )}
        </div>

        <Field label="Lead time (days)" hint={`The buyer expects delivery within ${rfq.expectedDeliveryDays} days. Shorter lead times score higher (20%).`}>
          <Input type="number" min="1" max={maxLead} step="1" value={leadTimeDays} onChange={(e) => setLeadTimeDays(e.target.value)} />
        </Field>
        {lead > rfq.expectedDeliveryDays && (
          <Alert tone="warning" icon={AlertTriangle}>
            Your lead time is longer than the buyer's expected {rfq.expectedDeliveryDays} days. You can still bid, but it lowers your score.
          </Alert>
        )}

        <Field label="Notes for the buyer" hint={`${notes.length}/500 · e.g. ink/thread matching, packaging, sample offer`}>
          <Textarea rows={3} maxLength={500} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>

        <div className="grid gap-3 rounded-xl border border-slate-200 p-4 text-sm sm:grid-cols-[1fr_auto] sm:items-center">
          <div>
            <p className="flex items-center gap-1.5 font-medium text-slate-900">
              <Gavel className="h-4 w-4 text-slate-400" /> How you're ranked
            </p>
            <p className="mt-1 text-slate-600">Price 50% · Trust score 30% · Lead time 20%. Only your rank is revealed to you, never other vendors' prices.</p>
          </div>
          <div className="text-right">
            <p className="text-xs text-slate-500">Your trust score</p>
            <TrustStars score={user?.trustScore || 0} />
          </div>
        </div>

        {!allowIncrease && myBid && <p className="flex items-center gap-1.5 text-xs text-slate-500"><EyeOff className="h-3.5 w-3.5" /> Reverse auction rule: re-bids can keep or lower your price, but never raise it.</p>}
        {ended && <Alert tone="danger">This auction has closed for bidding.</Alert>}
        {problems.length > 0 && numeric > 0 && (
          <ul className="list-disc space-y-0.5 pl-5 text-sm text-amber-700">
            {problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        )}
        <ErrorList error={error} />
      </form>
    </Modal>
  );
}
