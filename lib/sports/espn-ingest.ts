import type { MatchEventType } from "@prisma/client";
import { prisma } from "../db/prisma";
import { invalidateCache } from "../redis/cache";
import { cacheKeys } from "../redis/keys";
import { publishRealtimeMessage } from "../redis/pubsub";
import { logger } from "../logger";
import { ingestNormalizedEvent, upsertMatch } from "./ingest";
import { EspnResolver } from "./espn-resolve";
import type { EspnCard, EspnGoal, EspnMatch, EspnScoreboardMatch, EspnSubstitution, EspnVarEvent } from "./espn";
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

export function subExternalId(espnEventId: string, s: EspnSubstitution): string {
  return `espn-${espnEventId}-sub-${clockKey(s.minute, s.extraMinute)}-${slug(s.playerOn)}`;
}

export function varExternalId(espnEventId: string, v: EspnVarEvent): string {
  return `espn-${espnEventId}-var-${clockKey(v.minute, v.extraMinute)}-${slug(v.player)}`;
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
 * ESPN's *scoreboard* endpoint (fetchEspnScoreboard, used by upsertEspnMatch)
 * can return a stale per-match score when queried as part of a wide
 * multi-week date range — observed live: a match's status correctly flips
 * to FINISHED while its score field still reflects an earlier, cached
 * snapshot from before the match kicked off. The single-event *summary*
 * endpoint (fetchEspnMatch) doesn't share that cache, so whenever we fetch
 * it anyway — for goals/cards/subs — reconcile the match's score against
 * it too, rather than trusting the scoreboard's score alone.
 */
export async function reconcileMatchScore(matchId: string, summary: Pick<EspnMatch, "home" | "away">): Promise<void> {
  const match = await prisma.match.findUnique({ where: { id: matchId } });
  if (!match) return;
  if (match.homeScore === summary.home.score && match.awayScore === summary.away.score) return;

  const updated = await prisma.match.update({
    where: { id: matchId },
    data: { homeScore: summary.home.score, awayScore: summary.away.score },
  });
  await invalidateCache(cacheKeys.matchDetail(matchId));
  await publishRealtimeMessage({
    type: "match_update",
    matchId,
    teamIds: [updated.homeTeamId, updated.awayTeamId],
    status: updated.status,
    homeScore: updated.homeScore,
    awayScore: updated.awayScore,
    minute: updated.minute,
  });
  logger.info("espn_match_score_reconciled", {
    matchId,
    from: `${match.homeScore}-${match.awayScore}`,
    to: `${updated.homeScore}-${updated.awayScore}`,
  });
}

/**
 * Ingests every goal, card, substitution, and VAR incident from an ESPN
 * summary into an already-upserted match. Returns a map from each goal's
 * externalId to the created/existing MatchEvent id, so a caller (the
 * backfill) can attach a clip to it. Each event's `sourceText` carries
 * ESPN's own play-by-play sentence as grounding for the LLM commentary
 * provider (lib/commentary/llm-provider.ts) — never shown verbatim.
 */
export async function ingestEspnMatchDetail(
  matchId: string,
  espnEventId: string,
  summary: Pick<EspnMatch, "home" | "away" | "goals" | "cards" | "substitutions" | "varEvents" | "kickoffAt">,
  teamExternalIdByEspnId: Map<string, string>
): Promise<{
  goalEventIdByExternalId: Map<string, string>;
  goalCount: number;
  cardCount: number;
  subCount: number;
  varCount: number;
}> {
  await reconcileMatchScore(matchId, summary);

  const goalEventIdByExternalId = new Map<string, string>();
  const at = (minute: number) => new Date(summary.kickoffAt.getTime() + minute * 60_000);

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
      timestamp: at(g.minute),
      sourceText: g.sourceText,
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
      timestamp: at(c.minute),
      sourceText: c.sourceText,
    });
  }

  for (const s of summary.substitutions) {
    await ingestNormalizedEvent(matchId, {
      externalId: subExternalId(espnEventId, s),
      type: "SUBSTITUTION",
      detail: null,
      minute: s.minute,
      extraMinute: s.extraMinute,
      teamExternalId: teamExternalIdByEspnId.get(s.teamEspnId) ?? null,
      playerId: null,
      playerName: s.playerOn,
      assistName: s.playerOff,
      timestamp: at(s.minute),
      sourceText: s.sourceText,
    });
  }

  for (const v of summary.varEvents) {
    await ingestNormalizedEvent(matchId, {
      externalId: varExternalId(espnEventId, v),
      type: "VAR_DECISION",
      detail: null,
      minute: v.minute,
      extraMinute: v.extraMinute,
      teamExternalId: teamExternalIdByEspnId.get(v.teamEspnId) ?? null,
      playerId: null,
      playerName: v.player,
      assistName: null,
      timestamp: at(v.minute),
      sourceText: v.sourceText,
    });
  }

  return {
    goalEventIdByExternalId,
    goalCount: summary.goals.length,
    cardCount: summary.cards.length,
    subCount: summary.substitutions.length,
    varCount: summary.varEvents.length,
  };
}
