"use client";

import { useLayoutEffect, useRef, useState, type ReactNode } from "react";

/**
 * Landing-page preview only: caps the right column to the left column's
 * own natural height, then lets the right column scroll internally past
 * that. Plain CSS can't express "match a sibling's intrinsic height"
 * without a fixed row height (grid/flex stretch would instead grow the
 * *row* to fit whichever side is taller, which is the opposite of what's
 * wanted here — the clip list can be much longer than the event list) — a
 * ResizeObserver on the left column is the straightforward way to do it.
 */
export function MatchedHeightPanels({ left, right }: { left: ReactNode; right: ReactNode }) {
  const leftRef = useRef<HTMLDivElement>(null);
  const [maxHeight, setMaxHeight] = useState<number | null>(null);

  useLayoutEffect(() => {
    const el = leftRef.current;
    if (!el) return;
    const update = () => setMaxHeight(el.offsetHeight);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div className="grid gap-4 sm:grid-cols-2 items-start">
      <div ref={leftRef}>{left}</div>
      <div className="overflow-y-auto" style={maxHeight ? { maxHeight } : undefined}>
        {right}
      </div>
    </div>
  );
}
