import "dotenv/config";
import { prisma } from "../lib/db/prisma";
import { logger } from "../lib/logger";
import { LEAGUE_NAMES, fetchEspnMatch } from "../lib/sports/espn";
import { ingestEspnMatchDetail } from "../lib/sports/espn-ingest";
import { clipsForMatch } from "../lib/matching/verify-goals";
import { verifyAndAttachClips } from "../lib/matching/attach-clip";
import { isFetchlayerConfigured, searchGoalClipPosts } from "../lib/reddit/fetchlayer-client";
import { resolveAndPersistClipMedia } from "../lib/reddit/resolve-social-post-media";
import { computeTodaysWindow } from "./espn-live-poller";

/**
 * Automated counterpart to `scripts/backfill.ts --clips`: instead of a
 * manually fetchlayer-scraped snapshot, this calls FetchLayer's REST API
 * (lib/reddit/fetchlayer-client.ts) directly — no Claude Code session
 * needed, genuinely schedulable from a Render background worker.
 *
 * Runs once per calendar day, and only on an actual match day — reusing
 * espn-live-poller.ts's own window computation to know when today's
 * matches have finished (its `end` already pads for stoppage/ET, so a
 * clip search fired then finds a full-time-settled match, not a live one).
 * A day with zero PL/La Liga fixtures never calls FetchLayer at all.
 *
 * One search call covers the ENTIRE day's Goal Clip posts across every
 * match at once (see fetchlayer-client.ts) — a heavier match day (more
 * games) doesn't need more calls, since the cost is per-request, not
 * per-goal. That's the same principle behind espn-live-poller.ts's
 * game-count-independent polling: the lever that matters is whether to
 * poll at all today, not how many games happened to be on.
 */

const CHECK_INTERVAL_MS = Number(process.env.REDDIT_CLIP_CHECK_INTERVAL_MS ?? 15 * 60 * 1000); // 15 min
const LEAGUE_SLUG_BY_NAME = Object.fromEntries(Object.entries(LEAGUE_NAMES).map(([slug, name]) => [name, slug]));

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function todayDateKey(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Everything ESPN-sourced that finished today (any league already in the DB, not just PL/La Liga — harmless if a clip search finds nothing for it). */
async function todaysFinishedMatches() {
  const startOfDay = new Date();
  startOfDay.setUTCHours(0, 0, 0, 0);
  const endOfDay = new Date(startOfDay.getTime() + 86_400_000);

  return prisma.match.findMany({
    where: {
      externalId: { startsWith: "espn-" },
      status: "FINISHED",
      kickoffAt: { gte: startOfDay, lt: endOfDay },
    },
    include: { homeTeam: true, awayTeam: true, league: true },
  });
}

export async function runOnce(): Promise<void> {
  if (!isFetchlayerConfigured()) {
    logger.info("reddit_clip_poller_skipped_unconfigured");
    return;
  }

  const clips = await searchGoalClipPosts();
  logger.info("reddit_clip_search_completed", { candidates: clips.length });
  if (clips.length === 0) return;

  const matches = await todaysFinishedMatches();
  let matchesWithClips = 0;
  let totalAttached = 0;

  for (const m of matches) {
    const matchClips = clipsForMatch(clips, m.homeTeam.name, m.awayTeam.name);
    if (matchClips.length === 0) continue;

    const espnEventId = m.externalId.replace(/^espn-/, "");
    const leagueSlug = LEAGUE_SLUG_BY_NAME[m.league.name] ?? "eng.1";

    try {
      const summary = await fetchEspnMatch(espnEventId, leagueSlug);
      const teamExternalIdByEspnId = new Map([
        [summary.home.espnId, m.homeTeam.externalId],
        [summary.away.espnId, m.awayTeam.externalId],
      ]);
      // Idempotent re-ingest: picks up the goalEventIdByExternalId map for a
      // match that's already fully ingested, and catches any very-last-
      // stoppage-time change the live poller's window just missed.
      const { goalEventIdByExternalId } = await ingestEspnMatchDetail(
        m.id,
        espnEventId,
        summary,
        teamExternalIdByEspnId
      );

      const { attached, verified, discrepancy } = await verifyAndAttachClips(
        m.id,
        espnEventId,
        summary.goals,
        matchClips,
        goalEventIdByExternalId,
        {} // media resolved just below, not pre-loaded like backfill.ts's static snapshot
      );
      if (attached > 0) {
        matchesWithClips += 1;
        totalAttached += attached;
      }
      logger.info("reddit_clip_match_processed", {
        matchId: m.id,
        teams: `${m.homeTeam.name} v ${m.awayTeam.name}`,
        candidateClips: matchClips.length,
        attached,
        verified,
        discrepancy,
      });
    } catch (err) {
      logger.warn("reddit_clip_match_failed", { matchId: m.id, error: String(err) });
    }
  }

  // Resolve every still-unresolved attached clip (today's new ones, plus any
  // stray from a previous run that failed transiently) to a playable
  // inline video — same two-step, no-API-key resolution the backfill uses.
  const pending = await prisma.socialPost.findMany({
    where: { source: "REDDIT", videoUrl: null, clipHost: { not: "v.redd.it" } },
    select: { id: true },
  });
  let resolved = 0;
  for (const p of pending) {
    const outcome = await resolveAndPersistClipMedia(p.id);
    if (outcome !== "stuck") resolved += 1;
    await sleep(80);
  }

  logger.info("reddit_clip_poller_run_completed", {
    candidates: clips.length,
    matchesChecked: matches.length,
    matchesWithClips,
    totalAttached,
    resolved,
    pending: pending.length,
  });
}

let lastRunDate: string | null = null;

async function startPolling(): Promise<void> {
  logger.info("reddit_clip_poller_started", {
    checkIntervalMs: CHECK_INTERVAL_MS,
    configured: isFetchlayerConfigured(),
  });

  for (;;) {
    try {
      const window = await computeTodaysWindow();
      const today = todayDateKey();
      const pastTodaysWindow = window !== null && Date.now() > window.end.getTime();

      if (pastTodaysWindow && lastRunDate !== today) {
        lastRunDate = today; // set before running: a failed run shouldn't retry-loop every 15min for the rest of the day
        await runOnce();
      } else if (!window) {
        logger.info("reddit_clip_poller_idle_no_fixtures_today");
      }
    } catch (err) {
      logger.error("reddit_clip_poller_cycle_failed", { error: String(err) });
    }
    await sleep(CHECK_INTERVAL_MS);
  }
}

if (require.main === module) {
  startPolling();
}
