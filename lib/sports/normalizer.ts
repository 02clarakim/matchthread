import type { MatchEventType, MatchStatus } from "@prisma/client";
import type { NormalizedEvent, NormalizedMatch } from "./types";

/**
 * Minimal shape we actually read from football-data.org v4's match
 * resource (see https://docs.football-data.org/general/v4/match.html).
 * Only free-tier-guaranteed fields (id, competition, teams, score, status,
 * utcDate) are treated as always present; per-event detail (goals/
 * bookings/substitutions) is optional because it is not available for
 * every competition/tier — see getMatchDetail in football-data.ts, which
 * degrades gracefully when it's absent.
 */
export interface RawFootballDataMatch {
  id: number;
  utcDate: string;
  status: string;
  venue?: string | null;
  minute?: number | null;
  competition: { id: number; name: string; area?: { name?: string } };
  homeTeam: { id: number; name: string; shortName?: string | null; crest?: string | null };
  awayTeam: { id: number; name: string; shortName?: string | null; crest?: string | null };
  score?: {
    fullTime?: { home: number | null; away: number | null };
  };
  goals?: Array<{
    minute: number;
    injuryTime?: number | null;
    type?: string;
    team: { id: number };
    scorer?: { id?: number; name?: string };
    assist?: { id?: number; name?: string } | null;
  }>;
  bookings?: Array<{
    minute: number;
    card: string;
    team: { id: number };
    player?: { id?: number; name?: string };
  }>;
  substitutions?: Array<{
    minute: number;
    team: { id: number };
    playerOut?: { id?: number; name?: string };
    playerIn?: { id?: number; name?: string };
  }>;
}

const STATUS_MAP: Record<string, MatchStatus> = {
  SCHEDULED: "SCHEDULED",
  TIMED: "SCHEDULED",
  IN_PLAY: "LIVE",
  EXTRA_TIME: "LIVE",
  PENALTY_SHOOTOUT: "LIVE",
  PAUSED: "PAUSED",
  SUSPENDED: "PAUSED",
  FINISHED: "FINISHED",
  AWARDED: "FINISHED",
  POSTPONED: "POSTPONED",
  CANCELLED: "CANCELLED",
};

export function normalizeMatch(raw: RawFootballDataMatch): NormalizedMatch {
  return {
    externalId: String(raw.id),
    league: {
      externalId: String(raw.competition.id),
      name: raw.competition.name,
      country: raw.competition.area?.name ?? null,
      logoUrl: null,
    },
    homeTeam: {
      externalId: String(raw.homeTeam.id),
      name: raw.homeTeam.name,
      shortName: raw.homeTeam.shortName ?? null,
      logoUrl: raw.homeTeam.crest ?? null,
    },
    awayTeam: {
      externalId: String(raw.awayTeam.id),
      name: raw.awayTeam.name,
      shortName: raw.awayTeam.shortName ?? null,
      logoUrl: raw.awayTeam.crest ?? null,
    },
    status: STATUS_MAP[raw.status] ?? "SCHEDULED",
    homeScore: raw.score?.fullTime?.home ?? null,
    awayScore: raw.score?.fullTime?.away ?? null,
    minute: raw.minute ?? null,
    kickoffAt: new Date(raw.utcDate),
    venue: raw.venue ?? null,
  };
}

const GOAL_TYPE_MAP: Record<string, MatchEventType> = {
  REGULAR: "GOAL",
  OWN: "OWN_GOAL",
  PENALTY: "PENALTY_GOAL",
};

const CARD_TYPE_MAP: Record<string, MatchEventType> = {
  YELLOW_CARD: "YELLOW_CARD",
  RED_CARD: "RED_CARD",
  YELLOW_RED_CARD: "SECOND_YELLOW_CARD",
};

/**
 * Extracts structured events from a match detail response, if the provider
 * included them. Free-tier football-data.org responses typically do not —
 * this returns [] in that case, and the poller falls back to synthesizing
 * a goal event from a score change instead (see ingest.ts).
 */
export function normalizeEvents(raw: RawFootballDataMatch): NormalizedEvent[] {
  const events: NormalizedEvent[] = [];
  const matchId = raw.id;

  for (const goal of raw.goals ?? []) {
    events.push({
      externalId: `${matchId}-goal-${goal.team.id}-${goal.minute}-${goal.scorer?.id ?? "unknown"}`,
      type: GOAL_TYPE_MAP[goal.type ?? "REGULAR"] ?? "GOAL",
      detail: null,
      minute: goal.minute,
      extraMinute: goal.injuryTime ?? null,
      teamExternalId: String(goal.team.id),
      playerId: goal.scorer?.id ? String(goal.scorer.id) : null,
      playerName: goal.scorer?.name ?? null,
      assistName: goal.assist?.name ?? null,
      timestamp: new Date(),
    });
  }

  for (const booking of raw.bookings ?? []) {
    const type = CARD_TYPE_MAP[booking.card];
    if (!type) continue;
    events.push({
      externalId: `${matchId}-card-${booking.team.id}-${booking.minute}-${booking.player?.id ?? "unknown"}`,
      type,
      detail: null,
      minute: booking.minute,
      extraMinute: null,
      teamExternalId: String(booking.team.id),
      playerId: booking.player?.id ? String(booking.player.id) : null,
      playerName: booking.player?.name ?? null,
      assistName: null,
      timestamp: new Date(),
    });
  }

  for (const sub of raw.substitutions ?? []) {
    events.push({
      externalId: `${matchId}-sub-${sub.team.id}-${sub.minute}-${sub.playerIn?.id ?? "unknown"}`,
      type: "SUBSTITUTION",
      detail: null,
      minute: sub.minute,
      extraMinute: null,
      teamExternalId: String(sub.team.id),
      playerId: sub.playerIn?.id ? String(sub.playerIn.id) : null,
      playerName: sub.playerIn?.name ?? null,
      // reused as "player replaced" for the generated commentary template
      assistName: sub.playerOut?.name ?? null,
      timestamp: new Date(),
    });
  }

  return events;
}
