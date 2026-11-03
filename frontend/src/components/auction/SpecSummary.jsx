import { Lock } from 'lucide-react';
import TShirtPreview from '../configurator/TShirtPreview';
import { Badge } from '../ui';

const PLACEMENT_LABEL = { FRONT: 'Front only', BACK: 'Back only', FRONT_AND_BACK: 'Front & back' };

/** Read-only locked specification card (RFQ detail & order pages). */
export default function SpecSummary({ specs, expectedDeliveryDays, isLocked = true, compact = false }) {
  if (!specs) return null;
  const rows = [
    ['Garment', specs.garmentType],
    ['Fabric', `${specs.fabric} · ${specs.gsm} GSM`],
    ['Print', `${specs.printType} · ${PLACEMENT_LABEL[specs.printPlacement] || 'Front only'}`],
    ['Quantity', `${specs.totalQuantity} pcs`],
  ];
  if (expectedDeliveryDays) rows.push(['Delivery', `${expectedDeliveryDays} days`]);
  if (specs.customText) rows.push(['Text', specs.customText]);
  if (specs.backText) rows.push(['Back text', specs.backText]);

  return (
    <div>
      <div className={compact ? 'grid grid-cols-[6rem_1fr] gap-4' : 'grid grid-cols-2 gap-2'}>
        {(compact ? ['front'] : ['front', 'back']).map((view) => (
          <div key={view} className="rounded-xl bg-slate-50 p-2">
            <TShirtPreview specs={specs} view={view} />
          </div>
        ))}
        {compact && (
          <dl className="space-y-1 text-sm">
            {rows.slice(0, 4).map(([k, v]) => (
              <div key={k}>
                <dt className="inline text-slate-500">{k}: </dt>
                <dd className="inline font-medium text-slate-900">{v}</dd>
              </div>
            ))}
          </dl>
        )}
      </div>
      {!compact && (
        <>
          <dl className="mt-4 space-y-2 text-sm">
            {rows.map(([k, v]) => (
              <div key={k} className="flex justify-between gap-4">
                <dt className="text-slate-500">{k}</dt>
                <dd className="text-right font-medium text-slate-900">{v}</dd>
              </div>
            ))}
            <div className="flex items-center justify-between gap-4">
              <dt className="text-slate-500">Base colour</dt>
              <dd className="flex items-center gap-2 font-mono text-xs">
                <span className="h-4 w-4 rounded-full border border-slate-300" style={{ backgroundColor: specs.color }} />
                {specs.color}
              </dd>
            </div>
          </dl>
          <div className="mt-4">
            <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-slate-500">Size breakdown</p>
            <div className="grid grid-cols-5 gap-1.5 text-center">
              {Object.entries(specs.sizeBreakdown || {}).map(([size, qty]) => (
                <div key={size} className="rounded-lg bg-slate-50 py-1.5">
                  <p className="text-[10px] font-bold text-slate-500">{size}</p>
                  <p className="font-mono text-sm font-semibold text-slate-900">{qty}</p>
                </div>
              ))}
            </div>
          </div>
          {isLocked && (
            <Badge tone="slate" icon={Lock} className="mt-4">
              Specification locked (CPAPO protection)
            </Badge>
          )}
        </>
      )}
    </div>
  );
}
