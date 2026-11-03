import { Activity, AlertTriangle } from 'lucide-react';
import { formatLKR } from '../../utils/format';

/** Price-Signal Diagnostic: Coefficient of Variation of bid prices. */
export default function PriceDiagnosticAlert({ diagnostic, threshold = 0.35 }) {
  if (!diagnostic || !diagnostic.bidCount) return null;
  const cv = diagnostic.coefficientOfVariation;

  if (diagnostic.highVariance) {
    return (
      <div role="alert" className="flex gap-3 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-500" />
        <div>
          <p className="font-semibold">High price variance detected — specification ambiguity possible.</p>
          <p className="mt-1 text-amber-800">
            Bid prices vary by {(cv * 100).toFixed(1)}% (CV &gt; {threshold}). Vendors may be reading your design differently, for example the print size, number of
            ink colours or fabric quality. Check the bid notes before accepting.
          </p>
          <p className="mt-2 font-mono text-xs text-amber-700">
            mean {formatLKR(diagnostic.mean)} · σ {formatLKR(diagnostic.stdDev)} · CV {cv.toFixed(4)}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-xs text-slate-600">
      <Activity className="h-4 w-4 text-emerald-500" />
      Price signal healthy
      {cv !== null && cv !== undefined && <span className="font-mono">· CV {cv.toFixed(4)}</span>}
      {diagnostic.bidCount < 3 && <span>· variance is checked once there are 3 or more bids</span>}
    </div>
  );
}
