import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Cursor-paginated list with infinite scroll.
 *
 *   const feed = useCursorFeed((cursor) => postApi.feed({ type, cursor }), [type]);
 *   <div ref={feed.sentinelRef} />   // loads the next page when this scrolls into view
 *
 * `fetchPage(cursor)` must resolve to `{ items, nextCursor }` (nextCursor null at the end).
 * Changing `deps` resets the list. Responses that arrive after a reset are ignored, duplicate ids are
 * dropped, and a failed page can be retried without losing what was already loaded.
 */
export default function useCursorFeed(fetchPage, deps = [], { rootMargin = '800px' } = {}) {
  const [items, setItems] = useState([]);
  const [extra, setExtra] = useState(null); // everything else the first page returned (e.g. storefront profile)
  const [cursor, setCursor] = useState(null);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const generation = useRef(0);
  const inFlight = useRef(false);
  const fetchRef = useRef(fetchPage);
  fetchRef.current = fetchPage;

  const load = useCallback(async (fromCursor, gen) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setLoading(true);
    setError(null);
    try {
      const { items: page = [], nextCursor = null, ...rest } = await fetchRef.current(fromCursor);
      if (gen !== generation.current) return;
      setItems((prev) => {
        if (!fromCursor) return page;
        const seen = new Set(prev.map((p) => p._id));
        return [...prev, ...page.filter((p) => !seen.has(p._id))];
      });
      if (!fromCursor) setExtra(rest);
      setCursor(nextCursor);
      setHasMore(Boolean(nextCursor));
    } catch (err) {
      if (gen === generation.current) setError(err);
    } finally {
      if (gen === generation.current) setLoading(false);
      inFlight.current = false;
    }
  }, []);

  const reset = useCallback(() => {
    generation.current += 1;
    inFlight.current = false;
    setItems([]);
    setExtra(null);
    setCursor(null);
    setHasMore(true);
    load(null, generation.current);
  }, [load]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(reset, deps);

  const loadMore = useCallback(() => {
    if (!hasMore || loading || error) return;
    load(cursor, generation.current);
  }, [cursor, hasMore, loading, error, load]);

  const retry = useCallback(() => {
    setError(null);
    load(items.length ? cursor : null, generation.current);
  }, [cursor, items.length, load]);

  // Sentinel element: when it comes within `rootMargin` of the viewport, fetch the next page.
  const observer = useRef(null);
  const loadMoreRef = useRef(loadMore);
  loadMoreRef.current = loadMore;
  const sentinelNode = useRef(null);
  const sentinelRef = useCallback(
    (node) => {
      sentinelNode.current = node;
      if (observer.current) observer.current.disconnect();
      if (!node || typeof IntersectionObserver === 'undefined') return;
      observer.current = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && loadMoreRef.current(), { rootMargin });
      observer.current.observe(node);
    },
    [rootMargin]
  );
  useEffect(() => () => observer.current?.disconnect(), []);

  // The observer only fires on changes: if a short page leaves the sentinel on screen, keep loading.
  useEffect(() => {
    const node = sentinelNode.current;
    if (!node || loading || error || !hasMore || items.length === 0) return;
    const margin = Number.parseInt(rootMargin, 10) || 0;
    if (node.getBoundingClientRect().top < window.innerHeight + margin) loadMore();
  }, [items.length, loading, error, hasMore, loadMore, rootMargin]);

  return { items, setItems, extra, setExtra, hasMore, loading, error, loadMore, retry, reset, sentinelRef };
}
