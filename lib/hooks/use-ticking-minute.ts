"use client";

import { useEffect, useState } from "react";

const TICK_INTERVAL_MS = 60_000;
/** Never extrapolate more than this far past the last real server value — a stuck/delayed poller shouldn't drift the clock into fiction. */
const MAX_DRIFT_MINUTES = 10;

/**
 * Ticks a match's displayed minute up by one every real minute while it's
 * live, purely as a visual approximation between server updates (the same
 * trick FotMob/SofaScore use) — resyncing to the true value instantly
 * whenever a real `match_update` arrives. The server-polled/simulated
 * minute is always the source of truth; this never overwrites it, only
 * fills the gap on-screen.
 */
export function useTickingMinute(isLive: boolean, serverMinute: number | null): number | null {
  // Adjusting state in response to a prop change, done during render (not
  // in an effect) — the documented React pattern for this exact case.
  const [prevServerMinute, setPrevServerMinute] = useState(serverMinute);
  const [displayMinute, setDisplayMinute] = useState(serverMinute);

  if (serverMinute !== prevServerMinute) {
    setPrevServerMinute(serverMinute);
    setDisplayMinute(serverMinute);
  }

  useEffect(() => {
    if (!isLive || serverMinute === null) return;

    const interval = setInterval(() => {
      setDisplayMinute((prev) => {
        if (prev === null) return prev;
        const next = prev + 1;
        return next > serverMinute + MAX_DRIFT_MINUTES ? prev : next;
      });
    }, TICK_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [isLive, serverMinute]);

  return displayMinute;
}
