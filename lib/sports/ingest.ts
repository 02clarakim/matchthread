import { prisma } from "../db/prisma";
import { logger } from "../logger";
import { claimOnce } from "../redis/cache";
import { dedupeKeys, DEDUPE_TTL_SECONDS, cacheKeys } from "../redis/keys";
import { invalidateCache } from "../redis/cache";
import { publishRealtimeMessage } from "../redis/pubsub";
import type { NormalizedEvent, NormalizedLeague, NormalizedMatch, NormalizedTeam } from "./types";
import { isSocialWorthy, ingestSocialForEvent } from "../../workers/social-ingestion";
import { attachCommentary } from "../../workers/commentary-worker";
import type { Match, MatchEvent } from "@prisma/client";

/**
 * This module is "Event Normalization + Idempotency" from the architecture
 * diagram — the single choke point every new match/event passes through,
 * whether it came from the real sports-poller or from the local event
 * simulator (scripts/simulate-event.ts). Both call these exact functions,
 * so the simulator exercises the real pipeline rather than faking UI state.
 */

export async function upsertLeague(league: NormalizedLeague) {
  return prisma.league.upsert({
    where: { externalId: league.externalId },
    create: league,
    update: { name: league.name, country: league.country, logoUrl: league.logoUrl ?? undefined },
  });
}

export async function upsertTeam(team: NormalizedTeam, leagueId: string | null) {
  return prisma.team.upsert({
    where: { externalId: team.externalId },
    create: {
      externalId: team.externalId,
      name: team.name,
      shortName: team.shortName,
      logoUrl: team.logoUrl,
      leagueId: leagueId ?? undefined,
    },
    update: {
      name: team.name,
      shortName: team.shortName,
      logoUrl: team.logoUrl ?? undefined,
    },
  });
}

/** Upserts league/teams/match, and publishes match_update if score/status/minute changed. */
export async function upsertMatch(normalized: NormalizedMatch): Promise<Match> {
  const league = await upsertLeague(normalized.league);
  const [homeTeam, awayTeam] = await Promise.all([
    upsertTeam(normalized.homeTeam, league.id),
    upsertTeam(normalized.awayTeam, league.id),
  ]);

  const existing = await prisma.match.findUnique({ where: { externalId: normalized.externalId } });

  const match = await prisma.match.upsert({
    where: { externalId: normalized.externalId },
    create: {
      externalId: normalized.externalId,
      leagueId: league.id,
      homeTeamId: homeTeam.id,
      awayTeamId: awayTeam.id,
      status: normalized.status,
      homeScore: normalized.homeScore,
      awayScore: normalized.awayScore,
      minute: normalized.minute,
      kickoffAt: normalized.kickoffAt,
      venue: normalized.venue,
      lastSyncedAt: new Date(),
    },
    update: {
      status: normalized.status,
      homeScore: normalized.homeScore,
      awayScore: normalized.awayScore,
      minute: normalized.minute,
      venue: normalized.venue,
      lastSyncedAt: new Date(),
    },
  });

  const changed =
    !existing ||
    existing.status !== match.status ||
    existing.homeScore !== match.homeScore ||
    existing.awayScore !== match.awayScore ||
    existing.minute !== match.minute;

  if (changed) {
    await invalidateCache(cacheKeys.matchDetail(match.id));
    await publishRealtimeMessage({
      type: "match_update",
      matchId: match.id,
      teamIds: [match.homeTeamId, match.awayTeamId],
      status: match.status,
      homeScore: match.homeScore,
      awayScore: match.awayScore,
      minute: match.minute,
    });
  }

  return match;
}

/**
 * Idempotently ingests one normalized event for a match. Safe to call
 * repeatedly with the same externalId (e.g. from overlapping poll cycles):
 * a Redis "seen" marker short-circuits the common case, and the Postgres
 * `@@unique([matchId, externalId])` constraint is the real source of truth
 * if two processes race past that.
 *
 * On a genuinely new event: persists it, publishes `match_event`
 * immediately (before any commentary/social work), then fires off
 * commentary retrieval and — for important events — social ingestion
 * without waiting for them, so the UI can progressively enhance the event
 * as that work completes (see README § Real-Time Architecture).
 */
export async function ingestNormalizedEvent(
  matchId: string,
  normalized: NormalizedEvent
): Promise<{ event: MatchEvent; isNew: boolean }> {
  const seenKey = dedupeKeys.eventSeen(matchId, normalized.externalId);
  const claimedFresh = await claimOnce(seenKey, DEDUPE_TTL_SECONDS.EVENT_SEEN);

  if (!claimedFresh) {
    const existing = await prisma.matchEvent.findUnique({
      where: { matchId_externalId: { matchId, externalId: normalized.externalId } },
    });
    if (existing) return { event: existing, isNew: false };
    // Redis said "seen" but Postgres disagrees (e.g. TTL raced) — fall through and try the real insert.
  }

  const team = normalized.teamExternalId
    ? await prisma.team.findUnique({ where: { externalId: normalized.teamExternalId } })
    : null;

  let event: MatchEvent;
  let isNew: boolean;

  try {
    event = await prisma.matchEvent.create({
      data: {
        externalId: normalized.externalId,
        matchId,
        type: normalized.type,
        detail: normalized.detail,
        minute: normalized.minute,
        extraMinute: normalized.extraMinute,
        teamId: team?.id,
        playerId: normalized.playerId,
        playerName: normalized.playerName,
        assistName: normalized.assistName,
        timestamp: normalized.timestamp,
      },
    });
    isNew = true;
  } catch (err) {
    // P2002 = unique constraint violation → another process already inserted this event.
    if (isUniqueConstraintError(err)) {
      const existing = await prisma.matchEvent.findUniqueOrThrow({
        where: { matchId_externalId: { matchId, externalId: normalized.externalId } },
      });
      logger.info("duplicate_event_skipped", { matchId, externalId: normalized.externalId });
      return { event: existing, isNew: false };
    }
    throw err;
  }

  logger.info("new_match_event", { matchId, eventId: event.id, type: event.type });

  const match = await prisma.match.findUniqueOrThrow({ where: { id: matchId } });
  await invalidateCache(cacheKeys.matchEvents(matchId));

  await publishRealtimeMessage({
    type: "match_event",
    matchId,
    teamIds: [match.homeTeamId, match.awayTeamId],
    event: {
      id: event.id,
      type: event.type,
      detail: event.detail,
      minute: event.minute,
      extraMinute: event.extraMinute,
      teamId: event.teamId,
      playerName: event.playerName,
      assistName: event.assistName,
      commentary: event.commentary,
    },
  });

  triggerDownstreamProcessing(event.id, event.type);

  return { event, isNew };
}

function isUniqueConstraintError(err: unknown): boolean {
  return typeof err === "object" && err !== null && "code" in err && (err as { code: unknown }).code === "P2002";
}

/**
 * Tracks fire-and-forget background work (commentary + social ingestion)
 * so short-lived callers — scripts/seed.ts, scripts/simulate-event.ts —
 * can wait for it to finish before disconnecting Prisma/Redis and exiting.
 * Long-running processes (the Next.js server, the WS gateway, the poller)
 * never need this; they simply stay alive until the work completes.
 * Without it, a script that exits immediately after ingesting an event can
 * tear down the DB connection mid-query and the triggered work fails with
 * an opaque "Response from the Engine was empty" error.
 */
const pendingBackgroundWork = new Set<Promise<unknown>>();

export async function waitForPendingBackgroundWork(): Promise<void> {
  await Promise.allSettled(pendingBackgroundWork);
}

function track(promise: Promise<unknown>) {
  pendingBackgroundWork.add(promise);
  promise.finally(() => pendingBackgroundWork.delete(promise));
}

/** Fire-and-forget: commentary + (for important events) social ingestion, so the caller isn't blocked. */
function triggerDownstreamProcessing(eventId: string, eventType: string) {
  track(
    attachCommentary(eventId).catch((err) =>
      logger.error("commentary_worker_trigger_failed", { eventId, error: String(err) })
    )
  );

  if (isSocialWorthy(eventType)) {
    track(
      ingestSocialForEvent(eventId).catch((err) =>
        logger.error("social_ingestion_trigger_failed", { eventId, error: String(err) })
      )
    );
  }
}
