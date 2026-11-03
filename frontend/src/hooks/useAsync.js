import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Runs an async loader on mount / when deps change and exposes { data, error, loading, reload, setData }.
 * Stale responses from earlier calls are ignored.
 */
export default function useAsync(loader, deps = []) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const callId = useRef(0);

  const run = useCallback(
    async ({ silent = false } = {}) => {
      callId.current += 1;
      const id = callId.current;
      if (!silent) setLoading(true);
      setError(null);
      try {
        const result = await loader();
        if (id === callId.current) setData(result);
        return result;
      } catch (err) {
        if (id === callId.current) setError(err);
        return null;
      } finally {
        if (id === callId.current) setLoading(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    deps
  );

  useEffect(() => {
    run();
  }, [run]);

  return { data, error, loading, reload: run, setData };
}
