"use client";

import { useSyncExternalStore } from "react";

/**
 * A boolean preference remembered in the viewer's browser (not the account —
 * this is a per-device UI convenience, not identity data, so it applies to
 * logged-out visitors too and needs no backend).
 *
 * Built on useSyncExternalStore rather than useState+useEffect specifically
 * to avoid a hydration mismatch: the server (and the client's first paint)
 * always render `defaultValue` since localStorage doesn't exist there, and
 * the real stored value takes over as soon as React reconciles against the
 * external store — no extra render pass, and every hook instance for the
 * same key stays in sync within the tab.
 */

const listeners = new Map<string, Set<() => void>>();

function getListeners(key: string): Set<() => void> {
  let set = listeners.get(key);
  if (!set) {
    set = new Set();
    listeners.set(key, set);
  }
  return set;
}

function readStorage(key: string, defaultValue: boolean): boolean {
  try {
    const stored = window.localStorage.getItem(key);
    return stored === null ? defaultValue : stored === "true";
  } catch {
    return defaultValue; // private mode, blocked storage, etc.
  }
}

export function usePersistedToggle(key: string, defaultValue: boolean): [boolean, (next: boolean) => void] {
  const value = useSyncExternalStore(
    (onStoreChange) => {
      const set = getListeners(key);
      set.add(onStoreChange);
      return () => set.delete(onStoreChange);
    },
    () => readStorage(key, defaultValue),
    () => defaultValue
  );

  function update(next: boolean) {
    try {
      window.localStorage.setItem(key, String(next));
    } catch {
      // best-effort persistence only
    }
    getListeners(key).forEach((listener) => listener());
  }

  return [value, update];
}
