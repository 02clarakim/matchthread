import type { MatchEventType } from "@prisma/client";
import { ingestNormalizedEvent, upsertMatch } from "./ingest";
import { EspnResolver } from "./espn-resolve";
import type { EspnCard, EspnGoal, EspnMatch, EspnScoreboardMatch } from "./espn";
import type { NormalizedMatch } from "./types";

/**
 * Shared write path for both the on-demand backfill (scripts/backfill.ts)
 * and the live poller (workers/espn-live-poller.ts): turn an ESPN
 * scoreboard row + optional summary into our Match + MatchEvent rows,
 * idempotently. Event externalIds are derived from the *facts*
 * (kind/minute/player), not array position, so re-running after the poller
 * has already ingested a goal is a no-op rather than a duplicate.
 */

function slug(s: string | null): string {
  return (s ?? "unknown")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 32) || "unknown";
}

function clockKey(minute: number, extra: number | null): string {
  return extra ? `${minute}+${extra}` : `${minute}`;
}

export function goalExternalId(espnEventId: string, g: EspnGoal): string {
  return `espn-${espnEventId}-goal-${clockKey(g.minute, g.extraMinute)}-${slug(g.scorer)}`;
}

export function cardExternalId(espnEventId: string, c: EspnCard): string {
  return `espn-${espnEventId}-card-${clockKey(c.minute, c.extraMinute)}-${slug(c.player)}`;
}

export interface UpsertMatchResult {
  matchId: string;
  externalId: string;
  homeTeamName: string;
  awayTeamName: string;
}

/** Upserts the Match row (teams/league resolved onto existing seeded rows where possible). No events. */
export async function upsertEspnMatch(
  resolver: EspnResolver,
  sb: EspnScoreboardMatch
): Promise<UpsertMatchResult & { teamExternalIdByEspnId: Map<string, string> }> {
  const league = await resolver.league(sb.league);
  const home = await resolver.team(sb.home);
  const away = await resolver.team(sb.away);

  const normalized: NormalizedMatch = {
    externalId: `espn-${sb.espnEventId}`,
    league,
    homeTeam: home,
    awayTeam: away,
    status: sb.status,
    homeScore: sb.home.score,
    awayScore: sb.away.score,
    minute: sb.minute ?? (sb.status === "FINISHED" ? 90 : sb.status === "SCHEDULED" ? null : sb.minute),
    kickoffAt: sb.kickoffAt,
    venue: sb.venue,
  };

  const match = await upsertMatch(normalized);
  return {
    matchId: match.id,
    externalId: match.externalId,
    homeTeamName: home.name,
    awayTeamName: away.name,
    teamExternalIdByEspnId: new Map([
      [sb.home.espnId, home.externalId],
      [sb.away.espnId, away.externalId],
    ]),
  };
}

/**
 * Ingests every goal + card from an ESPN summary into an already-upserted
 * match. Returns a map from each goal's externalId to the created/existing
 * MatchEvent id, so a caller (the backfill) can attach a clip to it.
 */
export async function ingestEspnMatchDetail(
  matchId: string,
  espnEventId: string,
  summary: Pick<EspnMatch, "goals" | "cards" | "kickoffAt">,
  teamExternalIdByEspnId: Map<string, string>
): Promise<{ goalEventIdByExternalId: Map<string, string>; goalCount: number; cardCount: number }> {
  const goalEventIdByExternalId = new Map<string, string>();

  for (const g of summary.goals) {
    const externalId = goalExternalId(espnEventId, g);
    const { event } = await ingestNormalizedEvent(matchId, {
      externalId,
      type: g.type as MatchEventType,
      detail: g.assist ? `Assist: ${g.assist}` : null,
      minute: g.minute,
      extraMinute: g.extraMinute,
      teamExternalId: teamExternalIdByEspnId.get(g.teamEspnId) ?? null,
      playerId: null,
      playerName: g.scorer,
      assistName: g.assist,
      timestamp: new Date(summary.kickoffAt.getTime() + g.minute * 60_000),
    });
    goalEventIdByExternalId.set(externalId, event.id);
  }

  for (const c of summary.cards) {
    await ingestNormalizedEvent(matchId, {
      externalId: cardExternalId(espnEventId, c),
      type: c.type as MatchEventType,
      detail: null,
      minute: c.minute,
      extraMinute: c.extraMinute,
      teamExternalId: teamExternalIdByEspnId.get(c.teamEspnId) ?? null,
      playerId: null,
      playerName: c.player,
      assistName: null,
      timestamp: new Date(summary.kickoffAt.getTime() + c.minute * 60_000),
    });
  }

  return { goalEventIdByExternalId, goalCount: summary.goals.length, cardCount: summary.cards.length };
}
