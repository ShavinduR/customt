import { Link } from 'react-router-dom';
import { CheckCircle2, Circle, Lock, ShieldCheck } from 'lucide-react';
import { Card } from '../ui';

const CHECKS = [
  { key: 'verified', label: 'Business verified by a CustomT administrator', match: /verified/i },
  { key: 'license', label: 'Business license on record and not expired', match: /license/i },
  { key: 'active', label: 'Account in good standing', match: /suspended/i },
];

/** Shown instead of auction pages while the PERA qualification-level lock applies. */
export default function PeraLockScreen({ issues = [], compact = false }) {
  return (
    <Card className={compact ? 'p-5' : 'mx-auto max-w-2xl p-8 text-center'}>
      <div className={compact ? 'flex items-start gap-4' : ''}>
        <span className={`inline-flex rounded-2xl bg-amber-100 p-3 text-amber-700 ${compact ? '' : 'mx-auto'}`}>
          <Lock className="h-6 w-6" />
        </span>
        <div className={compact ? 'min-w-0 flex-1' : 'mt-4'}>
          <h2 className="text-lg font-semibold text-slate-900">Auction rooms are locked for now</h2>
          <p className="mt-1 text-sm text-slate-600">
            CustomT runs a Prequalification-Enforced Reverse Auction (PERA). Only verified printers with a valid business license can see live RFQs and bid. This
            protects buyers, and keeps competition fair for you.
          </p>
          <ul className={`mt-5 space-y-2 text-left text-sm ${compact ? '' : 'mx-auto max-w-md'}`}>
            {CHECKS.map((check) => {
              const failing = issues.some((i) => check.match.test(i));
              return (
                <li key={check.key} className="flex items-center gap-2">
                  {failing ? <Circle className="h-4 w-4 text-amber-500" /> : <CheckCircle2 className="h-4 w-4 text-emerald-500" />}
                  <span className={failing ? 'text-slate-900' : 'text-slate-500'}>{check.label}</span>
                </li>
              );
            })}
          </ul>
          {issues.length > 0 && (
            <div className="mt-5 rounded-xl bg-amber-50 p-4 text-left text-sm text-amber-900">
              <p className="font-medium">What's outstanding</p>
              <ul className="mt-1 list-disc space-y-0.5 pl-4">
                {issues.map((i) => (
                  <li key={i}>{i}</li>
                ))}
              </ul>
            </div>
          )}
          <p className={`mt-5 flex items-center gap-1.5 text-xs text-slate-500 ${compact ? '' : 'justify-center'}`}>
            <ShieldCheck className="h-4 w-4" /> This page unlocks automatically once you're verified. No refresh needed.
          </p>
          <Link to="/account" className="mt-4 inline-block text-sm font-semibold text-brand-700 hover:underline">
            Review your business profile →
          </Link>
        </div>
      </div>
    </Card>
  );
}
