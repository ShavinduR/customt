import { useState } from 'react';
import { Star, TrendingDown, TrendingUp } from 'lucide-react';
import { orderApi } from '../../api/client';
import { Button, ErrorList, Field, Modal, Textarea, cx } from '../ui';

const LABELS = ['', 'Poor', 'Below expectations', 'Satisfactory', 'Very good', 'Outstanding'];

/** 1-5 star rating that updates the vendor trust score (EWMA: 0.7 × old + 0.3 × rating). */
export default function RatingModal({ order, vendorName, open, onClose, onRated }) {
  const [rating, setRating] = useState(0);
  const [hover, setHover] = useState(0);
  const [review, setReview] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await orderApi.rate(order._id, { rating, review });
      setResult({ before: res.trustBefore, after: res.trustAfter });
      onRated(res.order);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  const close = () => {
    if (busy) return;
    setResult(null);
    onClose();
  };

  if (result) {
    const up = result.after >= result.before;
    return (
      <Modal open={open} onClose={close} title="Thank you for your feedback!" footer={<Button onClick={close}>Done</Button>} size="sm">
        <div className="text-center">
          <p className="text-sm text-slate-600">{vendorName}'s trust score was updated:</p>
          <p className="mt-3 flex items-center justify-center gap-3 font-mono text-2xl font-bold">
            <span className="text-slate-400">{result.before.toFixed(2)}</span>
            {up ? <TrendingUp className="h-6 w-6 text-emerald-500" /> : <TrendingDown className="h-6 w-6 text-red-500" />}
            <span className={up ? 'text-emerald-600' : 'text-red-600'}>{result.after.toFixed(2)}</span>
          </p>
          <p className="mt-3 text-xs text-slate-500">Trust scores carry 30% of the weight in future auction rankings.</p>
        </div>
      </Modal>
    );
  }

  const shown = hover || rating;
  return (
    <Modal
      open={open}
      onClose={close}
      dismissible={!busy}
      size="sm"
      title={`Rate ${vendorName}`}
      subtitle="Your rating helps other buyers choose reliable printers."
      footer={
        <>
          <Button variant="secondary" onClick={close} disabled={busy}>
            Later
          </Button>
          <Button onClick={submit} loading={busy} disabled={!rating}>
            Submit rating
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="flex flex-col items-center">
          <div className="flex gap-1" onMouseLeave={() => setHover(0)}>
            {[1, 2, 3, 4, 5].map((i) => (
              <button key={i} type="button" onMouseEnter={() => setHover(i)} onClick={() => setRating(i)} aria-label={`${i} star${i > 1 ? 's' : ''}`} className="p-0.5">
                <Star className={cx('h-9 w-9 transition', i <= shown ? 'fill-amber-400 text-amber-400' : 'text-slate-300')} />
              </button>
            ))}
          </div>
          <p className="mt-2 h-5 text-sm font-medium text-slate-700">{LABELS[shown]}</p>
        </div>
        <Field label="Review (optional)">
          <Textarea rows={3} maxLength={1000} value={review} onChange={(e) => setReview(e.target.value)} placeholder="Print quality, communication, punctuality…" />
        </Field>
        <ErrorList error={error} />
      </div>
    </Modal>
  );
}
