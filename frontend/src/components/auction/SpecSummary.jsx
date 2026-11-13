import { Suspense, lazy, useState } from 'react';
import { Box, Image as ImageIcon, Lock, Type } from 'lucide-react';
import TShirtPreview from '../configurator/TShirtPreview';
import { Badge, Button, Modal, Spinner } from '../ui';
import { SIDE_LABEL } from '../../utils/garmentGeometry';
import { fontFamily, fontWeight, layersOf, printedSides } from '../../utils/design';

const Shirt3DViewer = lazy(() => import('../configurator/Shirt3DViewer'));

/** Read-only locked specification card (RFQ detail & order pages). */
export default function SpecSummary({ specs, expectedDeliveryDays, isLocked = true, compact = false }) {
  const [open3d, setOpen3d] = useState(false);
  if (!specs) return null;
  const sides = printedSides(specs);
  const { textLayers, imageLayers } = layersOf(specs);
  const rows = [
    ['Garment', specs.garmentType],
    ['Fabric', `${specs.fabric} · ${specs.gsm} GSM`],
    ['Print', specs.printType],
    ['Printed sides', sides.map((s) => SIDE_LABEL[s]).join(', ') || '—'],
    ['Quantity', `${specs.totalQuantity} pcs`],
  ];
  if (expectedDeliveryDays) rows.push(['Delivery', `${expectedDeliveryDays} days`]);

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
          {sides.length > 0 && (
            <div className="mt-4">
              <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-slate-500">Artwork</p>
              <ul className="space-y-1.5 text-sm">
                {sides.map((side) => (
                  <li key={side} className="rounded-lg bg-slate-50 px-3 py-2">
                    <p className="text-xs font-semibold text-slate-500">{SIDE_LABEL[side]}</p>
                    {textLayers
                      .filter((l) => l.side === side)
                      .map((l) => (
                        <p key={l.id} className="flex items-center gap-2 text-slate-900">
                          <Type className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                          <span className="truncate" style={{ fontFamily: fontFamily(l.font), fontWeight: fontWeight(l.font) }}>
                            {l.text}
                          </span>
                          <span className="ml-auto shrink-0 text-xs text-slate-500">
                            {l.font} · {l.size}px
                          </span>
                          <span className="h-3 w-3 shrink-0 rounded-full border border-slate-300" style={{ backgroundColor: l.color }} title={l.color} />
                        </p>
                      ))}
                    {imageLayers
                      .filter((l) => l.side === side)
                      .map((l, i) => (
                        <p key={l.id} className="flex items-center gap-2 text-slate-900">
                          <ImageIcon className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                          <a href={l.url} target="_blank" rel="noreferrer" className="truncate text-brand-700 hover:underline">
                            Image {i + 1}
                          </a>
                          <span className="ml-auto shrink-0 text-xs text-slate-500">{Math.round(l.scale * 100)}% of print width</span>
                        </p>
                      ))}
                  </li>
                ))}
              </ul>
            </div>
          )}
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
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Button variant="secondary" size="sm" icon={Box} onClick={() => setOpen3d(true)}>
              View in 3D
            </Button>
            {isLocked && (
              <Badge tone="slate" icon={Lock}>
                Specification locked (CPAPO protection)
              </Badge>
            )}
          </div>
          <Modal open={open3d} onClose={() => setOpen3d(false)} title="3D preview" subtitle={`${specs.garmentType} · ${specs.color}`} size="lg">
            {open3d && (
              <Suspense fallback={<Spinner label="Loading 3D viewer…" className="h-[26rem]" />}>
                <Shirt3DViewer specs={specs} className="overflow-hidden rounded-xl bg-gradient-to-b from-slate-50 to-slate-200" />
              </Suspense>
            )}
          </Modal>
        </>
      )}
    </div>
  );
}
