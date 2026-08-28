"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import { useRealtime } from "@/lib/websocket/use-realtime";
import type { RealtimeMessage } from "@/lib/redis/pubsub";
import type { ApiMatch } from "@/lib/types/api";
import { MatchCard } from "@/components/match/match-card";
import { EmptyState } from "@/components/ui/empty-state";
import { EVENT_TYPE_META, minuteLabel } from "@/lib/match-format";

interface TickerEntry {
  key: string;
  matchId: string;
  icon: string;
  text: string;
}

export function LiveFavoritesFeed({ initialLiveMatches }: { initialLiveMatches: ApiMatch[] }) {
  const [matches, setMatches] = useState(initialLiveMatches);
  const [ticker, setTicker] = useState<TickerEntry[]>([]);

  const onMessage = useCallback((message: RealtimeMessage) => {
    if (message.type === "match_update") {
      setMatches((prev) =>
        prev.map((m) =>
          m.id === message.matchId
            ? { ...m, status: message.status, homeScore: message.homeScore, awayScore: message.awayScore, minute: message.minute }
            : m
        )
      );
    }

    if (message.type === "match_event") {
      const meta = EVENT_TYPE_META[message.event.type];
      setTicker((prev) => [
        {
          key: message.event.id,
          matchId: message.matchId,
          icon: meta.icon,
          text: `${meta.label}${message.event.playerName ? ` — ${message.event.playerName}` : ""}, ${minuteLabel(message.event.minute, message.event.extraMinute)}`,
        },
        ...prev,
      ].slice(0, 6));
    }
  }, []);

  useRealtime({ favorites: true, onMessage });

  return (
    <div className="space-y-3">
      {ticker.length > 0 && (
        <div className="space-y-1.5">
          {ticker.map((entry) => (
            <Link
              key={entry.key}
              href={`/matches/${entry.matchId}`}
              className="flex items-center gap-2 rounded-lg border border-accent/30 bg-accent/5 px-3 py-2 text-sm animate-slide-in hover:border-accent/60"
            >
              <span>{entry.icon}</span>
              <span>{entry.text}</span>
            </Link>
          ))}
        </div>
      )}

      {matches.length === 0 ? (
        <EmptyState icon="⚽">No live matches right now.</EmptyState>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {matches.map((match) => (
            <MatchCard key={match.id} match={match} />
          ))}
        </div>
      )}
    </div>
  );
}
