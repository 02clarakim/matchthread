"use client";

import { useCallback, useState } from "react";
import { useRealtime } from "@/lib/websocket/use-realtime";
import type { RealtimeMessage } from "@/lib/redis/pubsub";
import type { ApiEvent, ApiHighlight, ApiMatch } from "@/lib/types/api";
import { ScoreHeader } from "@/components/match/score-header";
import { EventItem } from "@/components/match/event-item";
import { HighlightList } from "@/components/social/highlight-list";
import { byClipThenScore } from "@/lib/social/clip-rank";
import { GOAL_EVENT_TYPES } from "@/lib/match-format";
import { EmptyState } from "@/components/ui/empty-state";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { ToggleSwitch } from "@/components/ui/toggle-switch";
import { usePersistedToggle } from "@/lib/use-persisted-toggle";

const SHOW_SUBSTITUTIONS_KEY = "matchpulse:show-substitutions";

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
          return [highlight, ...withoutDuplicate].sort(byClipThenScore);
        });
        break;
      }
    }
  }, [initialMatch.id]);

  useRealtime({ matchId: initialMatch.id, onMessage });

  const [showSubstitutions, setShowSubstitutions] = usePersistedToggle(SHOW_SUBSTITUTIONS_KEY, false);

  const sortedEvents = [...events]
    .filter((e) => showSubstitutions || e.type !== "SUBSTITUTION")
    .sort((a, b) => b.minute - a.minute);

  function teamAndSideFor(event: ApiEvent) {
    if (event.teamId === match.homeTeam.id) return { team: match.homeTeam, side: "home" as const };
    if (event.teamId === match.awayTeam.id) return { team: match.awayTeam, side: "away" as const };
    return { team: null, side: null };
  }

  const goals = events.filter((e) => GOAL_EVENT_TYPES.includes(e.type)).sort((a, b) => a.minute - b.minute);
  const homeGoals = goals.filter((e) => e.teamId === match.homeTeam.id);
  const awayGoals = goals.filter((e) => e.teamId === match.awayTeam.id);

  return (
    <div className="space-y-6">
      <ScoreHeader match={match} homeGoals={homeGoals} awayGoals={awayGoals} />

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader className="flex items-center justify-between gap-2">
            <span className="text-sm font-semibold">Match Timeline</span>
            <ToggleSwitch checked={showSubstitutions} onChange={setShowSubstitutions} label="Show substitutions" />
          </CardHeader>
          <CardBody className="divide-y divide-border">
            {sortedEvents.length === 0 ? (
              <EmptyState icon="⚽">
                {events.length > 0
                  ? "No goals or cards yet — this match's activity so far is substitutions, hidden above."
                  : "No events yet."}
              </EmptyState>
            ) : (
              sortedEvents.map((event) => {
                const { team, side } = teamAndSideFor(event);
                return (
                  <EventItem key={event.id} event={event} isNew={liveEventIds.has(event.id)} team={team} side={side} />
                );
              })
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
