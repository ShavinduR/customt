import { memo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, ChevronLeft, ChevronRight, Ruler, ShieldCheck, Store, Trash2 } from 'lucide-react';
import { Badge, Button, ButtonLink, TrustStars, cx } from '../ui';
import { formatLKR, formatNumber, formatRelative, initials } from '../../utils/format';
import { POST_TYPE_META, postCta } from '../../utils/posts';

function Gallery({ images, title }) {
  const [index, setIndex] = useState(0);
  const count = images.length;
  const go = (delta) => setIndex((i) => (i + delta + count) % count);
  return (
    <div className="relative aspect-[4/3] overflow-hidden bg-slate-100">
      <img src={images[index]} alt={`${title} (photo ${index + 1} of ${count})`} loading="lazy" decoding="async" className="h-full w-full object-cover" />
      {count > 1 && (
        <>
          <button type="button" onClick={() => go(-1)} aria-label="Previous photo" className="absolute left-2 top-1/2 -translate-y-1/2 rounded-full bg-white/85 p-1.5 text-slate-700 shadow hover:bg-white">
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button type="button" onClick={() => go(1)} aria-label="Next photo" className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full bg-white/85 p-1.5 text-slate-700 shadow hover:bg-white">
            <ChevronRight className="h-4 w-4" />
          </button>
          <div className="absolute bottom-2 left-0 right-0 flex justify-center gap-1.5">
            {images.map((src, i) => (
              <button
                key={src + i}
                type="button"
                aria-label={`Show photo ${i + 1}`}
                onClick={() => setIndex(i)}
                className={cx('h-1.5 rounded-full transition-all', i === index ? 'w-4 bg-white' : 'w-1.5 bg-white/60')}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function SizeChart({ rows }) {
  const hasSleeve = rows.some((r) => r.sleeveCm);
  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200">
      <table className="w-full text-center text-xs">
        <thead className="bg-slate-50 text-slate-500">
          <tr>
            <th className="px-2 py-1.5 text-left font-medium">Size</th>
            <th className="px-2 py-1.5 font-medium">Chest (cm)</th>
            <th className="px-2 py-1.5 font-medium">Length (cm)</th>
            {hasSleeve && <th className="px-2 py-1.5 font-medium">Sleeve (cm)</th>}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 font-mono text-slate-800">
          {rows.map((r) => (
            <tr key={r.size}>
              <td className="px-2 py-1 text-left font-sans font-semibold">{r.size}</td>
              <td className="px-2 py-1">{r.chestCm}</td>
              <td className="px-2 py-1">{r.lengthCm}</td>
              {hasSleeve && <td className="px-2 py-1">{r.sleeveCm ?? '—'}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * One vendor post. The call to action depends on the post type (see utils/posts.js) and always leads
 * into the configurator, so the deal stays on CustomT and is paid through escrow.
 */
function PostCard({ post, viewerRole, showVendor = true, onRemove }) {
  const [expanded, setExpanded] = useState(false);
  const [showChart, setShowChart] = useState(false);
  const meta = POST_TYPE_META[post.postType];
  const cta = postCta(post, viewerRole);
  const vendor = post.vendor || {};
  const longText = (post.postDescription || '').length > 180;

  return (
    <article className="flex flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      {showVendor && (
        <header className="flex items-center gap-3 px-4 py-3">
          <Link to={`/vendors/${vendor._id}`} className="flex min-w-0 flex-1 items-center gap-3 rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-600 text-sm font-bold text-white">{initials(vendor.companyName || vendor.name)}</span>
            <span className="min-w-0">
              <span className="block truncate text-sm font-semibold text-slate-900 hover:underline">{vendor.companyName || vendor.name}</span>
              <span className="flex items-center gap-2 text-xs text-slate-500">
                <TrustStars score={vendor.trustScore} />
                <span aria-hidden>·</span>
                {formatRelative(post.createdAt)}
              </span>
            </span>
          </Link>
          <Badge tone={meta.tone} icon={meta.icon}>
            {meta.short}
          </Badge>
        </header>
      )}

      <Gallery images={post.images} title={post.title} />

      <div className="flex flex-1 flex-col gap-3 p-4">
        {!showVendor && (
          <div className="flex items-center justify-between text-xs text-slate-500">
            <Badge tone={meta.tone} icon={meta.icon}>
              {meta.short}
            </Badge>
            {formatRelative(post.createdAt)}
          </div>
        )}
        <div>
          <h3 className="font-semibold text-slate-900">{post.title}</h3>
          {post.postDescription && (
            <p className={cx('mt-1 whitespace-pre-line text-sm text-slate-600', !expanded && 'line-clamp-3')}>{post.postDescription}</p>
          )}
          {longText && (
            <button type="button" onClick={() => setExpanded((v) => !v)} className="mt-1 text-xs font-medium text-brand-700 hover:underline">
              {expanded ? 'Show less' : 'Read more'}
            </button>
          )}
        </div>

        <div className="flex flex-wrap gap-1.5">
          {post.garmentType && <Badge>{post.garmentType}</Badge>}
          {post.fabricSpecs && (
            <Badge>
              {post.fabricSpecs.fabric} · {post.fabricSpecs.gsm} GSM
            </Badge>
          )}
          {post.printTypes?.map((p) => (
            <Badge key={p} tone="brand">
              {p}
            </Badge>
          ))}
        </div>
        {post.fabricSpecs?.composition && <p className="text-xs text-slate-500">{post.fabricSpecs.composition}</p>}

        {post.postType === 'CLEARANCE' && post.clearance && (
          <div className="grid grid-cols-2 gap-2 rounded-xl bg-amber-50 p-3 text-sm">
            <div>
              <p className="text-xs text-amber-800">Available</p>
              <p className="font-semibold text-slate-900">{formatNumber(post.clearance.availableQuantity)} pcs</p>
            </div>
            <div>
              <p className="text-xs text-amber-800">Guide price</p>
              <p className="font-semibold text-slate-900">{formatLKR(post.clearance.unitPrice)} / pc</p>
            </div>
          </div>
        )}

        {post.sizeChart?.length > 0 && (
          <div>
            <button type="button" onClick={() => setShowChart((v) => !v)} aria-expanded={showChart} className="flex items-center gap-1.5 text-sm font-medium text-slate-700 hover:text-slate-900">
              <Ruler className="h-4 w-4 text-slate-400" /> {showChart ? 'Hide size chart' : `Size chart (${post.sizeChart.map((r) => r.size).join(', ')})`}
            </button>
            {showChart && <div className="mt-2"><SizeChart rows={post.sizeChart} /></div>}
          </div>
        )}

        <div className="mt-auto space-y-2 pt-1">
          <div className="flex flex-wrap items-center gap-2">
            <ButtonLink to={cta.to} className="min-w-0 flex-1" variant={cta.kind === 'storefront' ? 'secondary' : 'primary'} icon={cta.kind === 'storefront' ? Store : ArrowRight}>
              {cta.label}
            </ButtonLink>
            {showVendor && cta.kind !== 'storefront' && (
              <ButtonLink to={`/vendors/${vendor._id}`} variant="secondary" icon={Store} className="shrink-0" aria-label={`Visit ${vendor.companyName || 'vendor'} storefront`}>
                <span className="hidden sm:inline">Storefront</span>
              </ButtonLink>
            )}
            {onRemove && (
              <Button variant="ghost" icon={Trash2} onClick={() => onRemove(post)} className="shrink-0 text-red-600 hover:bg-red-50" aria-label="Remove post">
                <span className="sr-only">Remove</span>
              </Button>
            )}
          </div>
          {cta.kind === 'direct' && (
            <p className="flex items-center gap-1.5 text-[11px] text-slate-500">
              <ShieldCheck className="h-3.5 w-3.5 text-emerald-600" /> Quoted, paid and released through CustomT escrow
            </p>
          )}
          {post.contactFlags?.length > 0 && (
            <p className="text-[11px] text-amber-700">Contact details were removed from this post ({post.contactFlags.join(', ')}).</p>
          )}
        </div>
      </div>
    </article>
  );
}

export default memo(PostCard);
