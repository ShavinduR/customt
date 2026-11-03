import { ArrowDownToLine, ArrowUpFromLine, Lock, RotateCcw, ShieldCheck, Snowflake } from 'lucide-react';
import { StatusBadge, cx } from '../ui';
import { formatDate, formatLKR } from '../../utils/format';

const LEDGER_LABEL = {
  ESCROW_DEPOSIT: { label: 'Escrow deposit', icon: ArrowDownToLine, tone: 'text-sky-600' },
  ADVANCE_RELEASE: { label: '30% advance released to vendor', icon: ArrowUpFromLine, tone: 'text-emerald-600' },
  FINAL_RELEASE: { label: '70% final settlement released', icon: ArrowUpFromLine, tone: 'text-emerald-600' },
  DISPUTE_RELEASE: { label: 'Released by mediation', icon: ArrowUpFromLine, tone: 'text-emerald-600' },
  REFUND: { label: 'Refund to your wallet', icon: RotateCcw, tone: 'text-violet-600' },
};

const ADMIN_LABEL = {
  ADVANCE_RELEASE: '30% advance released to vendor',
  FINAL_RELEASE: '70% final settlement released to vendor',
  DISPUTE_RELEASE: 'Released to vendor by mediation',
  REFUND: 'Refunded to buyer wallet',
};

const VENDOR_LABEL = {
  ADVANCE_RELEASE: '30% advance credited to your wallet',
  FINAL_RELEASE: '70% final settlement credited',
  DISPUTE_RELEASE: 'Credited after mediation',
  REFUND: 'Refunded to buyer',
};

function Milestone({ label, amount, state }) {
  const styles = {
    released: 'border-emerald-200 bg-emerald-50 text-emerald-800',
    held: 'border-sky-200 bg-sky-50 text-sky-800',
    frozen: 'border-red-200 bg-red-50 text-red-800',
    pending: 'border-slate-200 bg-slate-50 text-slate-600',
  };
  const text = { released: 'Released', held: 'Held in escrow', frozen: 'Frozen', pending: 'Not yet funded' };
  return (
    <div className={cx('rounded-xl border p-3', styles[state])}>
      <p className="text-xs font-medium opacity-80">{label}</p>
      <p className="mt-0.5 font-mono text-lg font-bold">{formatLKR(amount)}</p>
      <p className="mt-0.5 flex items-center gap-1 text-xs font-medium">
        {state === 'frozen' ? <Snowflake className="h-3 w-3" /> : state === 'held' ? <Lock className="h-3 w-3" /> : null}
        {text[state]}
      </p>
    </div>
  );
}

export default function EscrowBreakdown({ order, viewer = 'buyer' }) {
  const funded = order.escrowStatus !== 'AWAITING_PAYMENT';
  const frozen = order.escrowStatus === 'FROZEN';
  const advanceState = order.advanceReleased ? 'released' : !funded ? 'pending' : frozen ? 'frozen' : 'held';
  const finalState = order.finalReleased ? 'released' : !funded ? 'pending' : frozen ? 'frozen' : order.escrowHeld === 0 ? 'released' : 'held';

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs text-slate-500">Agreed price</p>
          <p className="font-mono text-2xl font-bold text-slate-900">{formatLKR(order.agreedPrice)}</p>
          <p className="text-xs text-slate-500">
            {formatLKR(order.unitPrice)} / pc × {order.specSnapshot?.totalQuantity} pcs
          </p>
        </div>
        <StatusBadge status={order.escrowStatus} />
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3">
        <Milestone label="Milestone 1 · 30% advance" amount={order.advanceAmount} state={advanceState} />
        <Milestone label="Milestone 2 · 70% on O2O" amount={order.finalAmount} state={order.refundedAmount > 0 && !order.finalReleased ? 'released' : finalState} />
      </div>
      {funded && (
        <p className="mt-3 flex items-center gap-1.5 text-sm text-slate-600">
          <ShieldCheck className="h-4 w-4 text-emerald-500" /> Currently held in escrow: <span className="font-mono font-semibold">{formatLKR(order.escrowHeld)}</span>
        </p>
      )}
      {order.escrowLedger?.length > 0 && (
        <ul className="mt-4 divide-y divide-slate-100 border-t border-slate-100">
          {order.escrowLedger.map((entry, i) => {
            const base = LEDGER_LABEL[entry.type] || { label: entry.type, icon: ArrowDownToLine, tone: 'text-slate-500' };
            const override = viewer === 'vendor' ? VENDOR_LABEL[entry.type] : viewer === 'admin' ? ADMIN_LABEL[entry.type] : null;
            const meta = override ? { ...base, label: override } : base;
            const Icon = meta.icon;
            return (
              <li key={`${entry.type}-${i}`} className="flex items-center gap-3 py-2.5 text-sm">
                <Icon className={cx('h-4 w-4 shrink-0', meta.tone)} />
                <div className="min-w-0 flex-1">
                  <p className="text-slate-800">{meta.label}</p>
                  <p className="text-xs text-slate-400">
                    {formatDate(entry.at)}
                    {entry.reference ? ` · ${entry.reference}` : ''}
                  </p>
                </div>
                <span className="font-mono font-semibold text-slate-900">{formatLKR(entry.amount)}</span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
