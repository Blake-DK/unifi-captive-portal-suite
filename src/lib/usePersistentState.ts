"use client";

import { useEffect, useRef, useState } from "react";

/**
 * useState that persists to localStorage under `key`, so a table's filters
 * survive navigation and reloads. SSR-safe: the first render uses `initial`,
 * then the stored value (if any) is applied on mount. Values must be
 * JSON-serialisable.
 */
export function usePersistentState<T>(key: string, initial: T): [T, (v: T) => void] {
  const [value, setValue] = useState<T>(initial);
  const hydrated = useRef(false);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(key);
      if (raw != null) setValue(JSON.parse(raw) as T);
    } catch {
      /* ignore malformed/blocked storage */
    }
    hydrated.current = true;
  }, [key]);

  useEffect(() => {
    if (!hydrated.current) return;
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* ignore quota/blocked storage */
    }
  }, [key, value]);

  return [value, setValue];
}
