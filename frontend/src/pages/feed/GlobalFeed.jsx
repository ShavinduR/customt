import { useState } from 'react';
import { Compass, PencilRuler, RefreshCw, ShieldCheck } from 'lucide-react';
import { postApi } from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import useCursorFeed from '../../hooks/useCursorFeed';
import PostCard from '../../components/feed/PostCard';
import { Alert, Button, ButtonLink, EmptyState, PageHeader, Spinner, cx } from '../../components/ui';
import { POST_TYPES, POST_TYPE_META } from '../../utils/posts';

const FILTERS = [{ value: '', label: 'All posts' }, ...POST_TYPES.map((t) => ({ value: t, label: POST_TYPE_META[t].label, icon: POST_TYPE_META[t].icon }))];

function PostSkeleton() {
  return (
    <div className="animate-pulse overflow-hidden rounded-2xl border border-slate-200 bg-white" aria-hidden>
      <div className="flex items-center gap-3 p-4">
        <div className="h-10 w-10 rounded-full bg-slate-200" />
        <div className="flex-1 space-y-2">
          <div className="h-3 w-1/2 rounded bg-slate-200" />
          <div className="h-3 w-1/3 rounded bg-slate-100" />
        </div>
      </div>
      <div className="aspect-[4/3] bg-slate-100" />
      <div className="space-y-2 p-4">
        <div className="h-4 w-2/3 rounded bg-slate-200" />
        <div className="h-3 w-full rounded bg-slate-100" />
        <div className="h-10 w-full rounded-lg bg-slate-100" />
      </div>
    </div>
  );
}

/**
 * Buyer home: an infinite-scroll feed of posts from every verified vendor.
 * Each card's call to action leads into the configurator (Direct Quote or open auction), so every deal
 * that starts here is still quoted, paid and released through CustomT escrow.
 */
export default function GlobalFeed() {
  const { user } = useAuth();
  const [type, setType] = useState('');
  const feed = useCursorFeed((cursor) => postApi.feed({ type, cursor, limit: 12 }), [type]);
  const firstLoad = feed.loading && feed.items.length === 0;

  return (
    <div>
      <PageHeader
        title="Discover"
        subtitle="Fresh work, catalog styles and clearance stock from verified CustomT printers."
        actions={
          user?.role === 'buyer' ? (
            <ButtonLink to="/buyer/rfqs/new" icon={PencilRuler}>
              Design & launch
            </ButtonLink>
          ) : null
        }
      />

      <div className="sticky top-16 z-10 -mx-4 mb-5 bg-slate-50/90 px-4 py-2 backdrop-blur sm:mx-0 sm:px-0">
        <div className="flex gap-2 overflow-x-auto" role="tablist" aria-label="Filter posts">
          {FILTERS.map((f) => (
            <button
              key={f.value || 'all'}
              type="button"
              role="tab"
              aria-selected={type === f.value}
              onClick={() => setType(f.value)}
              className={cx(
                'flex shrink-0 items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-sm font-medium transition',
                type === f.value ? 'border-brand-600 bg-brand-600 text-white' : 'border-slate-300 bg-white text-slate-600 hover:bg-slate-100'
              )}
            >
              {f.icon && <f.icon className="h-4 w-4" />}
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {user?.role === 'buyer' && (
        <p className="mb-4 flex items-center gap-2 text-xs text-slate-500">
          <ShieldCheck className="h-4 w-4 shrink-0 text-emerald-600" />
          Contact details are hidden on CustomT. Request a quote here so your payment is protected by escrow until you approve the goods.
        </p>
      )}

      {firstLoad ? (
        <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }, (_, i) => (
            <PostSkeleton key={i} />
          ))}
        </div>
      ) : feed.items.length === 0 && !feed.error ? (
        <EmptyState
          icon={Compass}
          title={type ? `No ${POST_TYPE_META[type].label.toLowerCase()} posts yet` : 'No posts yet'}
          description="Verified printers' posts will appear here. Check back soon."
          action={type ? <Button variant="secondary" onClick={() => setType('')}>Show all posts</Button> : null}
        />
      ) : (
        <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
          {feed.items.map((post) => (
            <PostCard key={post._id} post={post} viewerRole={user?.role} />
          ))}
        </div>
      )}

      <div ref={feed.sentinelRef} className="h-px" aria-hidden />
      <div className="py-8 text-center" aria-live="polite">
        {feed.error ? (
          <Alert tone="danger" title="Could not load more posts" className="mx-auto max-w-md text-left">
            {feed.error.message}{' '}
            <button type="button" onClick={feed.retry} className="inline-flex items-center gap-1 font-semibold underline">
              <RefreshCw className="h-3.5 w-3.5" /> Try again
            </button>
          </Alert>
        ) : feed.loading && feed.items.length > 0 ? (
          <Spinner label="Loading more posts…" />
        ) : !feed.hasMore && feed.items.length > 0 ? (
          <p className="text-sm text-slate-400">You're all caught up.</p>
        ) : null}
      </div>
    </div>
  );
}
