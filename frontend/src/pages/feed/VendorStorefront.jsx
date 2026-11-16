import { useEffect, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { BadgeCheck, CalendarDays, Factory, ImagePlus, Loader2, PackageCheck, Pencil, Plus, RefreshCw, ShieldCheck, Store } from 'lucide-react';
import { postApi, storefrontApi, uploadApi, vendorApi } from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import useCursorFeed from '../../hooks/useCursorFeed';
import PostCard from '../../components/feed/PostCard';
import PostComposer from '../../components/feed/PostComposer';
import { Alert, Badge, Button, ButtonLink, Card, EmptyState, ErrorList, Field, Modal, PageLoader, Spinner, Tabs, Textarea, TrustStars } from '../../components/ui';
import { formatDate, formatNumber, initials } from '../../utils/format';
import { POST_TYPES, POST_TYPE_META, configuratorLink } from '../../utils/posts';

/** Vendor-only: edit the storefront cover photo and bio. */
function StorefrontEditor({ open, onClose, vendor, onSaved }) {
  const toast = useToast();
  const fileRef = useRef(null);
  const [coverUrl, setCoverUrl] = useState(vendor.coverUrl || '');
  const [bio, setBio] = useState(vendor.bio || '');
  const [uploading, setUploading] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (open) {
      setCoverUrl(vendor.coverUrl || '');
      setBio(vendor.bio || '');
      setError(null);
    }
  }, [open, vendor.coverUrl, vendor.bio]);

  const upload = async (file) => {
    if (fileRef.current) fileRef.current.value = '';
    if (!file) return;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 2 * 1024 * 1024) {
      toast.error('Use a PNG, JPG or WEBP photo under 2 MB.');
      return;
    }
    setUploading(0);
    try {
      const res = await uploadApi.logo(file, setUploading);
      setCoverUrl(res.url);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setUploading(null);
    }
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await vendorApi.updateStorefront({ coverUrl, bio });
      if (res.blocked?.length) toast.warning(res.message);
      else toast.success(res.message);
      onSaved(res.storefront);
      onClose();
    } catch (err) {
      setError(err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={() => !saving && onClose()}
      title="Edit storefront"
      dismissible={!saving}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={save} loading={saving} disabled={uploading !== null}>
            Save
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div>
          <p className="mb-2 text-sm font-medium text-slate-700">Cover photo</p>
          <div className="relative h-32 overflow-hidden rounded-xl bg-gradient-to-r from-brand-600 to-violet-500">
            {coverUrl && <img src={coverUrl} alt="" className="h-full w-full object-cover" />}
            <div className="absolute bottom-2 right-2 flex gap-2">
              {coverUrl && (
                <Button size="sm" variant="secondary" onClick={() => setCoverUrl('')}>
                  Remove
                </Button>
              )}
              <Button size="sm" variant="secondary" icon={uploading !== null ? Loader2 : ImagePlus} onClick={() => fileRef.current?.click()} disabled={uploading !== null}>
                {uploading !== null ? `${uploading}%` : 'Upload'}
              </Button>
            </div>
          </div>
          <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => upload(e.target.files?.[0])} />
        </div>
        <Field label="About your business" hint={`${bio.length}/500 · contact details are removed automatically`}>
          <Textarea rows={4} maxLength={500} value={bio} onChange={(e) => setBio(e.target.value)} placeholder="What you print best, your equipment, typical turnaround…" />
        </Field>
        <ErrorList error={error} />
      </div>
    </Modal>
  );
}

/**
 * A vendor's micro-storefront: cover photo, trust score, badges, and posts in three tabs.
 * Buyers get a "Request Direct Quote" button that opens the configurator with this vendor as the only
 * bidder; the order still goes through escrow and O2O verification.
 */
export default function VendorStorefront() {
  const { id } = useParams();
  const { user } = useAuth();
  const toast = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get('tab');
  const tab = POST_TYPES.includes(tabParam) ? tabParam : 'PREMIUM_CATALOG';
  const [profile, setProfile] = useState(null);
  const [composerOpen, setComposerOpen] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);

  const feed = useCursorFeed((cursor) => storefrontApi.get(id, { type: tab, cursor, limit: 9 }), [id, tab]);

  // The profile arrives with the first page of each tab; keep the latest copy.
  useEffect(() => {
    if (feed.extra?.vendor) setProfile(feed.extra);
  }, [feed.extra]);
  useEffect(() => setProfile(null), [id]);

  const isOwner = user?.role === 'vendor' && profile?.vendor?._id === user._id;
  const canModerate = isOwner || user?.role === 'admin';

  const removePost = async (post) => {
    if (!window.confirm(`Remove "${post.title}" from the feed and your storefront?`)) return;
    try {
      await postApi.remove(post._id);
      feed.setItems((items) => items.filter((p) => p._id !== post._id));
      setProfile((p) => (p ? { ...p, tabs: { ...p.tabs, [post.postType]: Math.max(0, (p.tabs[post.postType] || 1) - 1) } } : p));
      toast.success('Post removed.');
    } catch (err) {
      toast.error(err.message);
    }
  };

  const onCreated = (post) => {
    setProfile((p) => (p ? { ...p, tabs: { ...p.tabs, [post.postType]: (p.tabs[post.postType] || 0) + 1 } } : p));
    if (post.postType === tab) feed.setItems((items) => [post, ...items]);
    else setSearchParams({ tab: post.postType }, { replace: true });
  };

  if (!profile) {
    if (feed.error) return <ErrorList error={feed.error} />;
    return <PageLoader label="Opening storefront…" />;
  }

  const { vendor, tabs, canRequestDirectQuote } = profile;
  const name = vendor.companyName || vendor.name;

  return (
    <div>
      <Card className="overflow-hidden">
        <div className="relative h-40 bg-gradient-to-r from-brand-600 via-brand-500 to-violet-500 sm:h-56">
          {vendor.coverUrl && <img src={vendor.coverUrl} alt={`${name} cover`} className="h-full w-full object-cover" />}
          {isOwner && (
            <Button size="sm" variant="secondary" icon={Pencil} className="absolute right-3 top-3" onClick={() => setEditorOpen(true)}>
              Edit storefront
            </Button>
          )}
        </div>
        <div className="relative px-5 pb-5">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div className="flex min-w-0 items-end gap-4">
              {/* Only the avatar overlaps the cover; the name sits below it. */}
              <span className="relative -mt-10 flex h-20 w-20 shrink-0 items-center justify-center rounded-2xl bg-brand-700 text-2xl font-bold text-white shadow-md ring-4 ring-white">
                {initials(name)}
              </span>
              <div className="min-w-0 pb-1 pt-3">
                <h1 className="flex items-center gap-2 text-xl font-bold text-slate-900">
                  {name}
                  {vendor.isPrequalified && <BadgeCheck className="h-5 w-5 text-brand-600" aria-label="Verified business" />}
                </h1>
                <div className="flex items-center gap-2 text-sm text-slate-500">
                  <TrustStars score={vendor.trustScore} />
                  <span>({formatNumber(vendor.ratingCount)} rating{vendor.ratingCount === 1 ? '' : 's'})</span>
                </div>
              </div>
            </div>
            <div className="flex flex-wrap gap-2 pt-3">
              {canRequestDirectQuote && (
                <ButtonLink to={configuratorLink({ vendorId: vendor._id })} size="lg" icon={Store}>
                  Request Direct Quote
                </ButtonLink>
              )}
              {isOwner && (
                <Button size="lg" icon={Plus} onClick={() => setComposerOpen(true)} disabled={!vendor.isPrequalified}>
                  New post
                </Button>
              )}
            </div>
          </div>

          {canRequestDirectQuote && (
            <p className="mt-3 flex items-start gap-1.5 text-xs text-slate-500 sm:justify-end">
              <ShieldCheck className="mt-px h-3.5 w-3.5 shrink-0 text-emerald-600" />
              Only {name} sees a Direct Quote request. You pay into CustomT escrow, and the final payment is released only after you inspect the goods (O2O PIN).
            </p>
          )}
          {isOwner && !vendor.isPrequalified && (
            <Alert tone="warning" className="mt-3">
              Your storefront is hidden from buyers until your business is verified and your licence is valid.
            </Alert>
          )}

          {vendor.bio && <p className="mt-4 max-w-3xl whitespace-pre-line text-sm text-slate-700">{vendor.bio}</p>}

          <div className="mt-4 flex flex-wrap gap-1.5">
            {vendor.skillBadges.map((b) => (
              <Badge key={b} tone="violet" icon={BadgeCheck}>
                {b}
              </Badge>
            ))}
            {vendor.capabilities.map((c) => (
              <Badge key={c} tone="brand">
                {c}
              </Badge>
            ))}
          </div>

          <dl className="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
            {[
              [PackageCheck, 'Completed orders', formatNumber(vendor.completedOrders)],
              [Factory, 'Capacity per order', `${formatNumber(vendor.maxCapacity)} pcs`],
              [CalendarDays, 'On CustomT since', formatDate(vendor.memberSince, false)],
              [ShieldCheck, 'Trust score', `${Number(vendor.trustScore).toFixed(2)} / 5`],
            ].map(([Icon, label, value]) => (
              <div key={label} className="rounded-xl bg-slate-50 px-3 py-2">
                <dt className="flex items-center gap-1.5 text-xs text-slate-500">
                  <Icon className="h-3.5 w-3.5" /> {label}
                </dt>
                <dd className="mt-0.5 font-semibold text-slate-900">{value}</dd>
              </div>
            ))}
          </dl>
        </div>
      </Card>

      <div className="mt-6">
        <Tabs
          value={tab}
          onChange={(value) => setSearchParams({ tab: value }, { replace: true })}
          tabs={POST_TYPES.map((t) => ({ value: t, label: POST_TYPE_META[t].label, count: tabs[t] || 0 }))}
        />
        <p className="mt-2 text-sm text-slate-500">{POST_TYPE_META[tab].blurb}</p>
      </div>

      <div className="mt-4">
        {feed.loading && feed.items.length === 0 ? (
          <div className="py-12">
            <Spinner label="Loading posts…" />
          </div>
        ) : feed.items.length === 0 && !feed.error ? (
          <EmptyState
            icon={POST_TYPE_META[tab].icon}
            title={`No ${POST_TYPE_META[tab].label.toLowerCase()} posts yet`}
            description={isOwner ? 'Publish your first post to appear in the buyers’ Global Feed.' : `${name} hasn't posted here yet.`}
            action={isOwner && vendor.isPrequalified ? <Button icon={Plus} onClick={() => setComposerOpen(true)}>New post</Button> : null}
          />
        ) : (
          <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
            {feed.items.map((post) => (
              <PostCard key={post._id} post={post} viewerRole={user?.role} showVendor={false} onRemove={canModerate ? removePost : undefined} />
            ))}
          </div>
        )}
        <div ref={feed.sentinelRef} className="h-px" aria-hidden />
        <div className="py-6 text-center" aria-live="polite">
          {feed.error && profile ? (
            <button type="button" onClick={feed.retry} className="inline-flex items-center gap-1 text-sm font-semibold text-red-700 underline">
              <RefreshCw className="h-3.5 w-3.5" /> Could not load more posts. Try again
            </button>
          ) : feed.loading && feed.items.length > 0 ? (
            <Spinner label="Loading more…" />
          ) : null}
        </div>
      </div>

      {isOwner && (
        <>
          <PostComposer open={composerOpen} onClose={() => setComposerOpen(false)} onCreated={onCreated} defaultType={tab} />
          <StorefrontEditor
            open={editorOpen}
            onClose={() => setEditorOpen(false)}
            vendor={vendor}
            onSaved={(storefront) => setProfile((p) => ({ ...p, vendor: { ...p.vendor, coverUrl: storefront.coverUrl, bio: storefront.bio } }))}
          />
        </>
      )}
    </div>
  );
}
