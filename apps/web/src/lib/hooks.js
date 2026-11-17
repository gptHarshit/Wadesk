'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api';

/**
 * Load data from the API. Re-runs when `path` or the query changes.
 * Returns { data, error, loading, reload, setData }.
 * Pass `path = null` to skip loading.
 */
export function useApi(path, query) {
  const queryKey = JSON.stringify(query ?? {});
  const [state, setState] = useState({ data: null, error: null, loading: Boolean(path) });
  const request = useRef(0);

  const load = useCallback(
    async ({ quiet = false } = {}) => {
      if (!path) return;
      const id = ++request.current;
      if (!quiet) setState((s) => ({ ...s, loading: true, error: null }));
      try {
        const data = await api(path, { query: JSON.parse(queryKey) });
        // Ignore the answer if a newer request has started since.
        if (id === request.current) setState({ data, error: null, loading: false });
      } catch (error) {
        if (id === request.current) setState((s) => ({ ...s, error, loading: false }));
      }
    },
    [path, queryKey],
  );

  useEffect(() => {
    load();
  }, [load]);

  const setData = useCallback((updater) => {
    setState((s) => ({ ...s, data: typeof updater === 'function' ? updater(s.data) : updater }));
  }, []);

  return { ...state, reload: load, setData };
}

/** A value that only updates after the user stops typing. */
export function useDebounced(value, delay = 300) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

/** Re-render on an interval (for countdowns). */
export function useTick(ms = 30_000) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setTick((n) => n + 1), ms);
    return () => clearInterval(timer);
  }, [ms]);
}
