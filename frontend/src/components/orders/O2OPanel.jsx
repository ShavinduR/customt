import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, Eye, EyeOff, Flag, KeyRound, QrCode, RefreshCw, ShieldAlert } from 'lucide-react';
import { orderApi } from '../../api/client';
import { useSocketEvent } from '../../context/SocketContext';
import { useToast } from '../../context/ToastContext';
import { Alert, Button, Modal, Spinner } from '../ui';
import { formatDate, formatLKR } from '../../utils/format';

/**
 * Buyer-only Online-to-Offline verification panel.
 * The 6-digit PIN / QR is handed to the vendor only after a satisfactory physical inspection.
 */
export default function O2OPanel({ order, onCompleted, onDispute }) {
  const toast = useToast();
  const [o2o, setO2o] = useState(null);
  const [error, setError] = useState(null);
  const [revealed, setRevealed] = useState(false);
  const [showQr, setShowQr] = useState(false);
  const [busy, setBusy] = useState(null);
  const [approveOpen, setApproveOpen] = useState(false);

  const load = useCallback(() => {
    orderApi
      .o2o(order._id)
      .then((res) => {
        setO2o(res.o2o);
        setError(null);
      })
      .catch(setError);
  }, [order._id]);

  useEffect(load, [load]);

  useSocketEvent('o2o:ready', (p) => {
    if (p.orderId === order._id) setO2o((prev) => ({ ...(prev || {}), pin: p.pin, qrDataUrl: p.qrDataUrl, attemptsRemaining: 5 }));
  });
  useSocketEvent('o2o:failed-attempt', (p) => {
    if (p.orderId === order._id) setO2o((prev) => (prev ? { ...prev, attemptsRemaining: p.attemptsRemaining } : prev));
  });

  const regenerate = async () => {
    setBusy('regen');
    try {
      const res = await orderApi.regeneratePin(order._id);
      setO2o(res.o2o);
      setRevealed(false);
      toast.success('A new PIN was generated. The old PIN no longer works.');
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(null);
    }
  };

  const approve = async () => {
    setBusy('approve');
    try {
      const res = await orderApi.approveInspection(order._id);
      setApproveOpen(false);
      toast.success(res.message);
      onCompleted(res.order);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(null);
    }
  };

  if (error) return <Alert tone="danger">{error.message}</Alert>;
  if (!o2o) return <Spinner label="Loading verification PIN…" className="py-8" />;

  const lockedOut = o2o.attemptsRemaining === 0;

  return (
    <div className="space-y-4">
      <Alert tone="info" title="Inspect before you release payment">
        Meet the vendor or receive the delivery, then check print quality, colours, sizes and quantity against the locked specification. Share the PIN only when you're
        satisfied. It releases the remaining <strong>{formatLKR(order.escrowHeld)}</strong> to the vendor.
      </Alert>

      <div className="rounded-2xl border-2 border-dashed border-violet-300 bg-violet-50/50 p-5 text-center">
        <p className="flex items-center justify-center gap-1.5 text-sm font-medium text-violet-800">
          <KeyRound className="h-4 w-4" /> Your O2O verification PIN
        </p>
        <div className="mt-3 flex justify-center gap-1.5 sm:gap-2" aria-live="polite">
          {o2o.pin.split('').map((digit, i) => (
            <span key={i} className="flex h-12 w-9 items-center justify-center rounded-lg border border-violet-200 bg-white font-mono text-2xl font-bold text-slate-900 shadow-sm sm:h-14 sm:w-11 sm:text-3xl">
              {revealed ? digit : '•'}
            </span>
          ))}
        </div>
        <div className="mt-4 flex flex-wrap justify-center gap-2">
          <Button size="sm" variant="secondary" icon={revealed ? EyeOff : Eye} onClick={() => setRevealed((v) => !v)}>
            {revealed ? 'Hide PIN' : 'Reveal PIN'}
          </Button>
          <Button size="sm" variant="secondary" icon={QrCode} onClick={() => setShowQr(true)}>
            Show QR code
          </Button>
          <Button size="sm" variant="ghost" icon={RefreshCw} loading={busy === 'regen'} onClick={regenerate}>
            New PIN
          </Button>
        </div>
        <p className="mt-3 text-xs text-slate-500">
          Generated {formatDate(o2o.generatedAt)} · {o2o.attemptsRemaining} vendor attempt(s) remaining
        </p>
        {lockedOut && (
          <p className="mt-2 flex items-center justify-center gap-1 text-xs font-medium text-red-600">
            <ShieldAlert className="h-3.5 w-3.5" /> Too many wrong attempts. Generate a new PIN to continue.
          </p>
        )}
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        <Button variant="success" icon={CheckCircle2} onClick={() => setApproveOpen(true)}>
          Approve inspection
        </Button>
        <Button variant="outlineDanger" icon={Flag} onClick={onDispute}>
          Raise dispute (freeze escrow)
        </Button>
      </div>

      <Modal open={showQr} onClose={() => setShowQr(false)} title="O2O verification QR" subtitle="Let the vendor scan this after your inspection" size="sm">
        <div className="flex flex-col items-center">
          <img src={o2o.qrDataUrl} alt="O2O verification QR code" className="h-64 w-64 rounded-xl border border-slate-200" />
          <p className="mt-3 font-mono text-sm text-slate-500">{order.orderCode}</p>
        </div>
      </Modal>

      <Modal
        open={approveOpen}
        onClose={() => busy !== 'approve' && setApproveOpen(false)}
        title="Approve and release final payment?"
        footer={
          <>
            <Button variant="secondary" onClick={() => setApproveOpen(false)} disabled={busy === 'approve'}>
              Not yet
            </Button>
            <Button variant="success" loading={busy === 'approve'} onClick={approve}>
              Yes, release {formatLKR(order.escrowHeld)}
            </Button>
          </>
        }
      >
        <p className="text-sm text-slate-600">
          This confirms you have inspected the goods and they match the locked specification. The final settlement goes to the vendor immediately and cannot be reversed.
        </p>
      </Modal>
    </div>
  );
}
