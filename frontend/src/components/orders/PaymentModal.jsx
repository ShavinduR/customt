import { useState } from 'react';
import { CheckCircle2, CreditCard, Lock, ShieldCheck } from 'lucide-react';
import { orderApi } from '../../api/client';
import { useCatalog } from '../../context/CatalogContext';
import { Alert, Button, ErrorList, Field, Input, Modal } from '../ui';
import { formatLKR } from '../../utils/format';

const formatCardNumber = (v) =>
  v
    .replace(/\D/g, '')
    .slice(0, 19)
    .replace(/(.{4})/g, '$1 ')
    .trim();

const formatExpiry = (v) => {
  const digits = v.replace(/\D/g, '').slice(0, 4);
  return digits.length > 2 ? `${digits.slice(0, 2)}/${digits.slice(2)}` : digits;
};

function brandOf(number) {
  const n = number.replace(/\s/g, '');
  if (/^4/.test(n)) return 'VISA';
  if (/^(5[1-5]|2[2-7])/.test(n)) return 'MASTERCARD';
  if (/^3[47]/.test(n)) return 'AMEX';
  return null;
}

/** Mock payment gateway checkout that funds the order's escrow. */
export default function PaymentModal({ order, open, onClose, onPaid }) {
  const { catalog } = useCatalog();
  const [card, setCard] = useState({ cardNumber: '', cardHolder: '', expiry: '', cvv: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [receipt, setReceipt] = useState(null);

  const set = (patch) => setCard((c) => ({ ...c, ...patch }));
  const brand = brandOf(card.cardNumber);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await orderApi.pay(order._id, card);
      setReceipt(res.receipt);
      onPaid(res.order);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  const close = () => {
    if (busy) return;
    setReceipt(null);
    setError(null);
    onClose();
  };

  if (receipt) {
    return (
      <Modal open={open} onClose={close} title="Payment successful" footer={<Button onClick={close}>Done</Button>}>
        <div className="flex flex-col items-center text-center">
          <CheckCircle2 className="h-14 w-14 text-emerald-500" />
          <p className="mt-3 font-mono text-2xl font-bold text-slate-900">{formatLKR(receipt.amount)}</p>
          <p className="mt-1 text-sm text-slate-600">is now held securely in CustomT escrow.</p>
          <dl className="mt-5 w-full space-y-1.5 rounded-xl bg-slate-50 p-4 text-left text-sm">
            <div className="flex justify-between">
              <dt className="text-slate-500">Transaction</dt>
              <dd className="font-mono text-xs">{receipt.transactionRef}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-500">Auth code</dt>
              <dd className="font-mono text-xs">{receipt.authCode}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-500">Card</dt>
              <dd>
                {receipt.brand} •••• {receipt.last4}
              </dd>
            </div>
          </dl>
        </div>
      </Modal>
    );
  }

  return (
    <Modal
      open={open}
      onClose={close}
      dismissible={!busy}
      title="Fund escrow"
      subtitle={`Order ${order.orderCode}`}
      footer={
        <>
          <Button variant="secondary" onClick={close} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" form="payment-form" icon={Lock} loading={busy}>
            Pay {formatLKR(order.agreedPrice)}
          </Button>
        </>
      }
    >
      <form id="payment-form" onSubmit={submit} className="space-y-4">
        <div className="rounded-xl bg-gradient-to-br from-brand-600 to-violet-600 p-4 text-white">
          <p className="text-xs opacity-80">Amount to lock in escrow</p>
          <p className="font-mono text-2xl font-bold">{formatLKR(order.agreedPrice)}</p>
          <p className="mt-2 flex items-center gap-1.5 text-xs opacity-90">
            <ShieldCheck className="h-3.5 w-3.5" /> 30% released at production start · 70% after your O2O inspection
          </p>
        </div>

        <Field label="Card number" required>
          <div className="relative">
            <Input
              icon={CreditCard}
              inputMode="numeric"
              autoComplete="cc-number"
              placeholder="4242 4242 4242 4242"
              value={card.cardNumber}
              onChange={(e) => set({ cardNumber: formatCardNumber(e.target.value) })}
              className="font-mono"
              required
            />
            {brand && <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-bold text-slate-500">{brand}</span>}
          </div>
        </Field>
        <Field label="Name on card" required>
          <Input autoComplete="cc-name" value={card.cardHolder} onChange={(e) => set({ cardHolder: e.target.value })} placeholder="N PERERA" required />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Expiry" required>
            <Input inputMode="numeric" autoComplete="cc-exp" placeholder="MM/YY" value={card.expiry} onChange={(e) => set({ expiry: formatExpiry(e.target.value) })} className="font-mono" required />
          </Field>
          <Field label="CVV" required>
            <Input
              inputMode="numeric"
              autoComplete="cc-csc"
              type="password"
              placeholder="•••"
              maxLength={4}
              value={card.cvv}
              onChange={(e) => set({ cvv: e.target.value.replace(/\D/g, '').slice(0, 4) })}
              className="font-mono"
              required
            />
          </Field>
        </div>

        {catalog?.testCards && (
          <Alert tone="info" title="Demo gateway: use a test card">
            <div className="mt-1 flex flex-wrap gap-1.5">
              {catalog.testCards.map((t) => (
                <button
                  key={t.number}
                  type="button"
                  onClick={() => set({ cardNumber: t.number, cardHolder: card.cardHolder || 'Demo Buyer', expiry: card.expiry || '12/30', cvv: card.cvv || '123' })}
                  className="rounded-md bg-white px-2 py-1 font-mono text-xs text-sky-900 ring-1 ring-sky-200 hover:bg-sky-100"
                  title={t.outcome}
                >
                  {t.number.slice(-4)} · {t.outcome}
                </button>
              ))}
            </div>
          </Alert>
        )}
        <ErrorList error={error} />
      </form>
    </Modal>
  );
}
