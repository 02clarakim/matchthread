"use client";

import { useCallback, useState } from "react";
import { useRealtime } from "@/lib/websocket/use-realtime";
import type { RealtimeMessage } from "@/lib/redis/pubsub";
import type { ApiEvent, ApiHighlight, ApiMatch } from "@/lib/types/api";
import { ScoreHeader } from "@/components/match/score-header";
import { EventItem } from "@/components/match/event-item";
import { HighlightList } from "@/components/social/highlight-list";
import { EmptyState } from "@/components/ui/empty-state";
import { Card, CardBody, CardHeader } from "@/components/ui/card";

interface LiveMatchViewProps {
  initialMatch: ApiMatch;
  initialEvents: ApiEvent[];
  initialHighlights: ApiHighlight[];
}

export function LiveMatchView({ initialMatch, initialEvents, initialHighlights }: LiveMatchViewProps) {
  const [match, setMatch] = useState(initialMatch);
  const [events, setEvents] = useState(initialEvents);
  const [highlights, setHighlights] = useState(initialHighlights);
  const [liveEventIds, setLiveEventIds] = useState<Set<string>>(new Set());

  const onMessage = useCallback((message: RealtimeMessage) => {
    if (message.matchId !== initialMatch.id) return;

    switch (message.type) {
      case "match_update": {
        setMatch((prev) => ({
          ...prev,
          status: message.status,
          homeScore: message.homeScore,
          awayScore: message.awayScore,
          minute: message.minute,
        }));
        break;
      }
      case "match_event": {
        setEvents((prev) => {
          if (prev.some((e) => e.id === message.event.id)) return prev;
          return [...prev, message.event];
        });
        setLiveEventIds((prev) => new Set(prev).add(message.event.id));
        break;
      }
      case "commentary_update": {
        setEvents((prev) =>
          prev.map((e) => (e.id === message.eventId ? { ...e, commentary: message.commentary } : e))
        );
        break;
      }
      case "highlight_update": {
        const highlight: ApiHighlight = {
          id: `${message.eventId}-${message.highlight.socialPostId}`,
          score: message.highlight.score,
          matchingMethod: message.highlight.matchingMethod,
          socialPost: {
            id: message.highlight.socialPostId,
            title: message.highlight.title,
            url: message.highlight.url,
            mediaUrl: message.highlight.mediaUrl,
            mediaType: message.highlight.mediaType,
            author: message.highlight.author,
          },
          event: { id: message.eventId },
        };
        setHighlights((prev) => {
          const withoutDuplicate = prev.filter((h) => h.id !== highlight.id);
          return [highlight, ...withoutDuplicate].sort((a, b) => b.score - a.score);
        });
        break;
      }
    }
  }, [initialMatch.id]);

  useRealtime({ matchId: initialMatch.id, onMessage });

  const sortedEvents = [...events].sort((a, b) => b.minute - a.minute);

  return (
    <div className="space-y-6">
      <ScoreHeader match={match} />

      <div className="grid gap-6 md:grid-cols-3">
        <Card className="md:col-span-2">
          <CardHeader className="text-sm font-semibold">Match Timeline</CardHeader>
          <CardBody className="divide-y divide-border">
            {sortedEvents.length === 0 ? (
              <EmptyState icon="⚽">No events yet.</EmptyState>
            ) : (
              sortedEvents.map((event) => (
                <EventItem key={event.id} event={event} isNew={liveEventIds.has(event.id)} />
              ))
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader className="text-sm font-semibold">Community Reactions</CardHeader>
          <CardBody>
            <HighlightList highlights={highlights} />
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
