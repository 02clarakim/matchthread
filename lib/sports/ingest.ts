import { prisma } from "../db/prisma";
import { logger } from "../logger";
import { claimOnce } from "../redis/cache";
import { dedupeKeys, DEDUPE_TTL_SECONDS, cacheKeys } from "../redis/keys";
import { invalidateCache } from "../redis/cache";
import { publishRealtimeMessage } from "../redis/pubsub";
import type { NormalizedEvent, NormalizedLeague, NormalizedMatch, NormalizedTeam } from "./types";
import { matchSlug, teamProfileSlug } from "./match-slug";
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

/** teamProfileSlug() with a numeric suffix if that base is taken by a different team. */
async function uniqueTeamSlug(name: string, externalId: string): Promise<string> {
  const base = teamProfileSlug(name);
  for (let i = 0; i < 10; i++) {
    const candidate = i === 0 ? base : `${base}-${i + 1}`;
    const clash = await prisma.team.findUnique({ where: { slug: candidate }, select: { externalId: true } });
    if (!clash || clash.externalId === externalId) return candidate;
  }
  return `${base}-${externalId.slice(-4)}`;
}

export async function upsertTeam(team: NormalizedTeam, leagueId: string | null) {
  const existing = await prisma.team.findUnique({ where: { externalId: team.externalId }, select: { slug: true } });
  const slug = existing?.slug ?? (await uniqueTeamSlug(team.name, team.externalId));

  return prisma.team.upsert({
    where: { externalId: team.externalId },
    create: {
      externalId: team.externalId,
      slug,
      name: team.name,
      shortName: team.shortName,
      logoUrl: team.logoUrl,
      leagueId: leagueId ?? undefined,
    },
    update: {
      slug,
      name: team.name,
      shortName: team.shortName,
      logoUrl: team.logoUrl ?? undefined,
    },
  });
}

/** matchSlug() with a numeric suffix if that base is already taken by a different match. */
async function uniqueMatchSlug(home: string, away: string, kickoffAt: Date, externalId: string): Promise<string> {
  const base = matchSlug(home, away, kickoffAt);
  for (let i = 0; i < 10; i++) {
    const candidate = i === 0 ? base : `${base}-${i + 1}`;
    const clash = await prisma.match.findUnique({ where: { slug: candidate }, select: { externalId: true } });
    if (!clash || clash.externalId === externalId) return candidate;
  }
  return `${base}-${externalId.slice(-4)}`;
}

/** Upserts league/teams/match, and publishes match_update if score/status/minute changed. */
export async function upsertMatch(normalized: NormalizedMatch): Promise<Match> {
  const league = await upsertLeague(normalized.league);
  const [homeTeam, awayTeam] = await Promise.all([
    upsertTeam(normalized.homeTeam, league.id),
    upsertTeam(normalized.awayTeam, league.id),
  ]);

  const existing = await prisma.match.findUnique({ where: { externalId: normalized.externalId } });

  const slug =
    existing?.slug ??
    (await uniqueMatchSlug(normalized.homeTeam.name, normalized.awayTeam.name, normalized.kickoffAt, normalized.externalId));

  const match = await prisma.match.upsert({
    where: { externalId: normalized.externalId },
    create: {
      externalId: normalized.externalId,
      slug,
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
      slug,
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
 * Event types that are "the same real-world moment" for dedup purposes —
 * a goal is a goal whether it comes in as GOAL, PENALTY_GOAL or OWN_GOAL,
 * and a dismissal is a dismissal whether RED_CARD or SECOND_YELLOW_CARD.
 */
const EVENT_DEDUP_CLASS: Partial<Record<MatchEvent["type"], MatchEvent["type"][]>> = {
  GOAL: ["GOAL", "PENALTY_GOAL", "OWN_GOAL"],
  PENALTY_GOAL: ["GOAL", "PENALTY_GOAL", "OWN_GOAL"],
  OWN_GOAL: ["GOAL", "PENALTY_GOAL", "OWN_GOAL"],
  RED_CARD: ["RED_CARD", "SECOND_YELLOW_CARD"],
  SECOND_YELLOW_CARD: ["RED_CARD", "SECOND_YELLOW_CARD"],
};
function totalMinute(minute: number, extra: number | null): number {
  return minute + (extra ?? 0);
}

/** Last name token, normalized — "Ollie Watkins" -> "watkins", "B. Saka" -> "saka". */
function surname(name: string | null): string {
  if (!name) return "";
  const toks = name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter((t) => t.length > 1);
  return toks[toks.length - 1] ?? "";
}

/**
 * A goal/red-card already recorded for the same team at the *exact* same
 * minute by the same player — regardless of which source reported it or
 * what externalId scheme it used. Stops a mirrored Reddit clip, or a
 * second poller / a changed id scheme, from doubling the timeline.
 *
 * Deliberately strict: the minute must match exactly and the scorer
 * surnames must agree (unless one source has no name). A team scoring
 * again a minute later — even the same player (a quick brace) — is a
 * distinct event and must NOT be collapsed. Never dedups yellow cards /
 * subs / VAR, where a repeat near the same minute is its own event.
 */
export async function findEquivalentEvent(
  matchId: string,
  type: MatchEvent["type"],
  teamId: string | null,
  minute: number,
  extraMinute: number | null,
  playerName: string | null = null
): Promise<MatchEvent | null> {
  const classes = EVENT_DEDUP_CLASS[type];
  if (!classes || !teamId) return null;
  const target = totalMinute(minute, extraMinute);
  const incoming = surname(playerName);

  const candidates = await prisma.matchEvent.findMany({ where: { matchId, teamId, type: { in: classes } } });
  return (
    candidates.find((c) => {
      if (totalMinute(c.minute, c.extraMinute) !== target) return false;
      const stored = surname(c.playerName);
      return !incoming || !stored || incoming === stored;
    }) ?? null
  );
}

/**
 * Idempotently ingests one normalized event for a match. Safe to call
 * repeatedly (overlapping polls, mirrored posts, a different source):
 * a Redis "seen" marker short-circuits the common case, the Postgres
 * `@@unique([matchId, externalId])` constraint catches an exact re-send,
 * and findEquivalentEvent() catches the *same goal* arriving under a
 * different externalId.
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

  // Same goal/dismissal already on the timeline under a different externalId
  // (a Reddit mirror post, another poller). Reuse it — and backfill a scorer
  // name / stoppage minute if this source has one and the stored row doesn't.
  const equivalent = await findEquivalentEvent(
    matchId,
    normalized.type,
    team?.id ?? null,
    normalized.minute,
    normalized.extraMinute,
    normalized.playerName
  );
  if (equivalent) {
    const patch: { playerName?: string; extraMinute?: number; sourceText?: string } = {};
    if (!equivalent.playerName && normalized.playerName) patch.playerName = normalized.playerName;
    if (equivalent.extraMinute === null && normalized.extraMinute !== null) patch.extraMinute = normalized.extraMinute;
    if (!equivalent.sourceText && normalized.sourceText) patch.sourceText = normalized.sourceText;
    const event = Object.keys(patch).length
      ? await prisma.matchEvent.update({ where: { id: equivalent.id }, data: patch })
      : equivalent;
    logger.info("duplicate_event_skipped_equivalent", {
      matchId,
      externalId: normalized.externalId,
      existingExternalId: equivalent.externalId,
    });
    return { event, isNew: false };
  }

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
        sourceText: normalized.sourceText ?? null,
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
