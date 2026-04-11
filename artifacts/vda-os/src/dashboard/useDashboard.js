import { useState, useEffect, useCallback, useRef } from "react";

/**
 * usePoll — independent polling hook with cleanup.
 * Supports multiple independent calls per component (each has its own interval).
 *
 * @param {() => Promise<any>} fetchFn  — async fetch function
 * @param {number} intervalMs           — polling interval in milliseconds
 * @returns {{ data, loading, error, refresh }}
 */
export function usePoll(fetchFn, intervalMs) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);
  const fetchFnRef = useRef(fetchFn);
  fetchFnRef.current = fetchFn;

  const run = useCallback(async () => {
    try {
      const result = await fetchFnRef.current();
      setData(result);
      setError(null);
      setLastUpdated(new Date());
    } catch (err) {
      setError(err?.message ?? "Fetch failed");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    run();
    const id = setInterval(run, intervalMs);
    return () => clearInterval(id);
  }, [run, intervalMs]);

  return { data, loading, error, refresh: run, lastUpdated };
}

/**
 * useSecondsAgo — returns a human-readable "X seconds ago" / "X minutes ago" string.
 */
export function useSecondsAgo(timestamp) {
  const [label, setLabel] = useState("");

  useEffect(() => {
    if (!timestamp) return;
    const tick = () => {
      const diff = Math.floor((Date.now() - new Date(timestamp).getTime()) / 1000);
      if (diff < 60) setLabel(`${diff}s ago`);
      else setLabel(`${Math.floor(diff / 60)}m ago`);
    };
    tick();
    const id = setInterval(tick, 5000);
    return () => clearInterval(id);
  }, [timestamp]);

  return label;
}
