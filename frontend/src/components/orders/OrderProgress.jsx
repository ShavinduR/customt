import { Check, CircleDollarSign, Factory, Gavel, PackageCheck, ScanSearch, Truck } from 'lucide-react';
import { cx } from '../ui';

const STEPS = [
  { key: 'AWARDED', label: 'Bid accepted', icon: Gavel },
  { key: 'ESCROW', label: 'Escrow funded', icon: CircleDollarSign },
  { key: 'MATERIAL_SOURCED', label: 'Material sourced', icon: Truck },
  { key: 'IN_PRODUCTION', label: 'In production', icon: Factory },
  { key: 'READY_FOR_INSPECTION', label: 'Inspection (O2O)', icon: ScanSearch },
  { key: 'COMPLETED', label: 'Completed', icon: PackageCheck },
];

const PRODUCTION_INDEX = { NOT_STARTED: 1, MATERIAL_SOURCED: 2, IN_PRODUCTION: 3, READY_FOR_INSPECTION: 4, DELIVERED: 5 };

function currentIndex(order) {
  if (order.orderStatus === 'COMPLETED') return 6;
  if (order.orderStatus === 'PENDING_ESCROW' || order.orderStatus === 'CANCELLED') return 0;
  return PRODUCTION_INDEX[order.productionStatus] ?? 1;
}

export default function OrderProgress({ order }) {
  const index = currentIndex(order);
  const halted = ['DISPUTED', 'REFUNDED', 'CANCELLED'].includes(order.orderStatus);

  return (
    <ol className="grid grid-cols-3 gap-y-4 sm:grid-cols-6">
      {STEPS.map((step, i) => {
        const done = i < index;
        const active = i === index && !halted;
        const Icon = step.icon;
        return (
          <li key={step.key} className="relative flex flex-col items-center text-center">
            {i > 0 && <span className={cx('absolute right-1/2 top-4 hidden h-0.5 w-full sm:block', i <= index ? 'bg-brand-500' : 'bg-slate-200')} aria-hidden="true" />}
            <span
              className={cx(
                'relative z-10 flex h-8 w-8 items-center justify-center rounded-full border-2',
                done && 'border-brand-600 bg-brand-600 text-white',
                active && 'border-brand-600 bg-white text-brand-600 ring-4 ring-brand-100',
                !done && !active && (halted && i === index ? 'border-red-400 bg-red-50 text-red-500' : 'border-slate-200 bg-white text-slate-400')
              )}
            >
              {done ? <Check className="h-4 w-4" /> : <Icon className="h-4 w-4" />}
            </span>
            <span className={cx('mt-2 text-xs font-medium', done || active ? 'text-slate-900' : 'text-slate-400')}>{step.label}</span>
          </li>
        );
      })}
    </ol>
  );
}
