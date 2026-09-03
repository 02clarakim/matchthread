"use client";

import { useEffect, useState } from "react";
import type { ApiMatch } from "@/lib/types/api";
import { MatchCard } from "@/components/match/match-card";

/**
 * Homepage "Live now" board. The WebSocket gateway only fans out per
 * subscribed matchId / favourite team, so there's no "all live" push to
 * hang off — this simply re-polls the (Redis-cached) /api/matches/live
 * every 30s. Server-rendered initial list means it's populated on first
 * paint with no flash.
 */
export function LiveNowBoard({ initial }: { initial: ApiMatch[] }) {
  const [matches, setMatches] = useState(initial);

  useEffect(() => {
    let cancelled = false;
    async function refresh() {
      try {
        const res = await fetch("/api/matches/live");
        if (!res.ok) return;
        const data = (await res.json()) as { matches: ApiMatch[] };
        if (!cancelled) setMatches(data.matches);
      } catch {
        // transient — keep showing what we have
      }
    }
    const id = setInterval(refresh, 30_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  if (matches.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-surface p-5 text-center text-sm text-muted">
        No live matches right now. Check back around kick-off.
      </div>
    );
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {matches.map((m) => (
        <MatchCard key={m.id} match={m} />
      ))}
    </div>
  );
}
