import "dotenv/config";
import { prisma } from "../lib/db/prisma";
import { logger } from "../lib/logger";
import { LEAGUE_NAMES, fetchEspnMatch } from "../lib/sports/espn";
import { ingestEspnMatchDetail } from "../lib/sports/espn-ingest";
import { clipsForMatch } from "../lib/matching/verify-goals";
import { verifyAndAttachClips } from "../lib/matching/attach-clip";
import { isFetchlayerConfigured, searchGoalClipPosts, searchGoalClipPostsWide } from "../lib/reddit/fetchlayer-client";
import { resolveAndPersistClipMedia } from "../lib/reddit/resolve-social-post-media";
import { GOAL_EVENT_TYPES } from "../lib/match-format";
import { computeTodaysWindow } from "./espn-live-poller";

/**
 * Automated counterpart to `scripts/backfill.ts --clips`: instead of a
 * manually fetchlayer-scraped snapshot, this calls FetchLayer's REST API
 * (lib/reddit/fetchlayer-client.ts) directly — no Claude Code session
 * needed, genuinely schedulable from a Render background worker.
 *
 * Runs every REDDIT_CLIP_POLL_INTERVAL_MS *throughout* today's match
 * window (reusing espn-live-poller.ts's own window computation — same
 * padded kickoff-to-full-time span used for live ESPN polling), not just
 * once at the end of the day. A goal's Reddit clip usually exists within
 * minutes of the goal; polling only once after the last match finishes
 * meant a fan could wait most of the day to see a clip that was already
 * postable hours earlier. Outside today's window — including every
 * non-match day — this idles at CHECK_INTERVAL_MS and calls FetchLayer
 * zero times.
 *
 * Searches PER MATCH (fetchlayer-client.ts#searchGoalClipPosts), not once
 * globally per day — confirmed live that a `flair_name:"Goal Clip"` query
 * doesn't reliably find real posts (Reddit's search doesn't index flair as
 * searchable text), and combined with team names it returns zero results
 * even for a match with several real posts. A plain "{home} {away}" query
 * does find them. Each poll tick only searches matches that don't already
 * have a Reddit clip (matchIdsWithClips), so a match stops costing calls
 * the moment it's covered — still cheap (a handful of matches × a few
 * polls per match day, at ~$0.002/request), just no longer "one call
 * covers everything."
 */

const POLL_INTERVAL_MS = Number(process.env.REDDIT_CLIP_POLL_INTERVAL_MS ?? 30 * 60 * 1000); // 30 min, while inside today's match window
const CHECK_INTERVAL_MS = Number(process.env.REDDIT_CLIP_CHECK_INTERVAL_MS ?? 15 * 60 * 1000); // 15 min, while idle (no window yet/today, or none at all)
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

/** Matches already have at least one Reddit clip — no point re-searching them again this run or next. */
async function matchIdsWithClips(matchIds: string[]): Promise<Set<string>> {
  const rows = await prisma.socialPost.findMany({
    where: { source: "REDDIT", matchId: { in: matchIds } },
    select: { matchId: true },
  });
  return new Set(rows.map((r) => r.matchId).filter((id): id is string => id !== null));
}

interface MatchForClipSearch {
  id: string;
  externalId: string;
  homeTeam: { name: string; externalId: string };
  awayTeam: { name: string; externalId: string };
  league: { name: string };
}

/**
 * One match's worth of search -> verify -> attach -> resolve. Pulled out of
 * runOnce()'s loop so runCatchUpSweep() below can share the exact same
 * logic instead of a second, drifting copy of it.
 *
 * `wide` picks the search strategy: `searchGoalClipPostsWide`
 * (sort=relevance, month->all) for a match that could be days or weeks
 * old (runCatchUpSweep), vs. the narrower `searchGoalClipPosts`
 * (sort=new, day->week) for one that just finished today (runOnce) — see
 * fetchlayer-client.ts's doc comment on searchGoalClipPostsWide for why
 * "new" sort silently stops finding anything once a match is more than a
 * few days old, regardless of how wide the time window is.
 */
async function searchAndAttachClipsForMatch(
  m: MatchForClipSearch,
  wide: boolean
): Promise<{ attached: number }> {
  // One search per match — see fetchlayer-client.ts for why this can't be
  // a single query covering the whole day.
  const clips = wide
    ? await searchGoalClipPostsWide(m.homeTeam.name, m.awayTeam.name)
    : await searchGoalClipPosts(m.homeTeam.name, m.awayTeam.name);
  const matchClips = clipsForMatch(clips, m.homeTeam.name, m.awayTeam.name);
  if (matchClips.length === 0) return { attached: 0 };

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

    const { attached, verified, discrepancy, attachedPostIds } = await verifyAndAttachClips(
      m.id,
      espnEventId,
      summary.goals,
      matchClips,
      goalEventIdByExternalId,
      {} // media resolved immediately below, not pre-loaded like backfill.ts's static snapshot
    );
    logger.info("reddit_clip_match_processed", {
      matchId: m.id,
      teams: `${m.homeTeam.name} v ${m.awayTeam.name}`,
      candidateClips: matchClips.length,
      attached,
      verified,
      discrepancy,
    });

    // Resolve right away, in the same iteration — a clip that sits
    // attached-but-unresolved for a while renders as a broken "native
    // Reddit" iframe in the UI (the frontend can't tell "not yet
    // resolved" from "genuinely native" until clipHost is actually set;
    // see lib/matching/attach-clip.ts). Resolving immediately keeps that
    // window as short as possible instead of deferring every match's
    // clips to one batch pass at the very end of the run.
    for (const postId of attachedPostIds) {
      await resolveAndPersistClipMedia(postId);
      await sleep(80);
    }
    return { attached };
  } catch (err) {
    logger.warn("reddit_clip_match_failed", { matchId: m.id, error: String(err) });
    return { attached: 0 };
  }
}

export async function runOnce(): Promise<void> {
  if (!isFetchlayerConfigured()) {
    logger.info("reddit_clip_poller_skipped_unconfigured");
    return;
  }

  const allMatches = await todaysFinishedMatches();
  const alreadyHaveClips = await matchIdsWithClips(allMatches.map((m) => m.id));
  const matches = allMatches.filter((m) => !alreadyHaveClips.has(m.id));
  logger.info("reddit_clip_poller_run_started", {
    finishedToday: allMatches.length,
    alreadyHaveClips: alreadyHaveClips.size,
    toSearch: matches.length,
  });

  let matchesWithClips = 0;
  let totalAttached = 0;

  for (const m of matches) {
    const { attached } = await searchAndAttachClipsForMatch(m, false);
    if (attached > 0) {
      matchesWithClips += 1;
      totalAttached += attached;
    }
  }

  const { resolved, pending } = await resolvePendingClips();

  logger.info("reddit_clip_poller_run_completed", {
    matchesSearched: matches.length,
    matchesWithClips,
    totalAttached,
    resolved,
    pending,
  });
}

// 90 days comfortably covers a full season-so-far (this one started
// 2026-08-15) — searchGoalClipPostsWide's relevance+all-time search works
// regardless of how old the match is, so there's no search-side reason to
// cap this tighter; the only real cost is one FetchLayer call per
// still-missing match, once a day, and that shrinks to ~0 once the
// existing backlog clears.
const CATCH_UP_LOOKBACK_DAYS = Number(process.env.REDDIT_CLIP_CATCHUP_LOOKBACK_DAYS ?? 90);

/**
 * Every real goal from the last N days that still has zero attached Reddit
 * posts at all — not just "unresolved" (resolvePendingClips's job), never
 * searched for in the first place.
 *
 * runOnce()'s same-day search is a one-shot window: once today closes, a
 * match that missed it (a transient FetchLayer error, a post that wasn't
 * up yet when the search ran, or a match touched by something outside the
 * normal live pipeline entirely — a manual DB fix, a re-featured match on
 * the landing page) never gets retried. Confirmed live: a real goal
 * (Erling Haaland, Man Utd 0-1 Man City, 2026-09-13) sat with no attached
 * clip for over a week because nothing had ever searched for it — a human
 * had to notice the broken embed and fix it by hand. This is the fix: a
 * daily sweep (see catchUpDoneForDate in startPolling) that re-checks
 * recent scoreless-on-clips matches, so a gap like that closes itself
 * within a day instead of needing to be found and reported one at a time.
 */
async function matchesMissingClips(lookbackDays: number) {
  const since = new Date(Date.now() - lookbackDays * 86_400_000);
  return prisma.match.findMany({
    where: {
      externalId: { startsWith: "espn-" },
      status: "FINISHED",
      kickoffAt: { gte: since },
      events: { some: { type: { in: GOAL_EVENT_TYPES } } },
      socialPosts: { none: {} },
    },
    include: { homeTeam: true, awayTeam: true, league: true },
  });
}

export async function runCatchUpSweep(): Promise<void> {
  if (!isFetchlayerConfigured()) return;

  const matches = await matchesMissingClips(CATCH_UP_LOOKBACK_DAYS);
  logger.info("reddit_clip_catchup_started", { lookbackDays: CATCH_UP_LOOKBACK_DAYS, candidates: matches.length });

  let totalAttached = 0;
  for (const m of matches) {
    const { attached } = await searchAndAttachClipsForMatch(m, true);
    totalAttached += attached;
  }

  logger.info("reddit_clip_catchup_completed", { checked: matches.length, totalAttached });
}

/**
 * Safety net for anything that failed to resolve right after attaching
 * (transient network error, etc.) or was left over from an interrupted
 * previous run. Explicit OR because `clipHost: { not: "v.redd.it" }` alone
 * silently excludes NULL rows (SQL's <> never matches NULL) — a real bug
 * found live: it meant a never-resolved clip was never retried.
 *
 * Deliberately NOT gated behind today's match window (unlike runOnce/the
 * FetchLayer search above) — this is a plain fetch with no API key and no
 * per-request cost, so there's no reason to make a stuck clip wait for the
 * next match day. Confirmed live: a Sevilla v Barcelona clip that failed to
 * resolve once sat broken in the UI for two days because the only place
 * that retried it was inside runOnce(), which only ran when a match was on
 * *today* — with no fixtures that day, the poller logged
 * "idle_no_fixtures_today" forever and never got another chance to retry it.
 */
export async function resolvePendingClips(): Promise<{ resolved: number; pending: number }> {
  const pending = await prisma.socialPost.findMany({
    where: { source: "REDDIT", videoUrl: null, OR: [{ clipHost: null }, { clipHost: { not: "v.redd.it" } }] },
    select: { id: true },
  });
  let resolved = 0;
  for (const p of pending) {
    const outcome = await resolveAndPersistClipMedia(p.id);
    if (outcome !== "stuck") resolved += 1;
    await sleep(80);
  }
  return { resolved, pending: pending.length };
}

type Window = Awaited<ReturnType<typeof computeTodaysWindow>>;

/**
 * Pure scheduling decision, separated out so it's testable without mocking
 * timers or the network: run now only if `now` falls inside the window AND
 * either this is the first run of the day (lastRunAt null) or a full
 * interval has elapsed since the last one.
 */
export function shouldRunNow(window: Window, now: number, lastRunAt: number | null, pollIntervalMs: number): boolean {
  if (!window) return false;
  const insideWindow = now >= window.start.getTime() && now <= window.end.getTime();
  const dueForRun = lastRunAt === null || now - lastRunAt >= pollIntervalMs;
  return insideWindow && dueForRun;
}

let windowCheckedForDate: string | null = null;
let currentWindow: Window = null;
let lastRunAt: number | null = null;
let catchUpDoneForDate: string | null = null;

export async function startPolling(): Promise<void> {
  logger.info("reddit_clip_poller_started", {
    pollIntervalMs: POLL_INTERVAL_MS,
    checkIntervalMs: CHECK_INTERVAL_MS,
    catchUpLookbackDays: CATCH_UP_LOOKBACK_DAYS,
    configured: isFetchlayerConfigured(),
  });

  for (;;) {
    try {
      const today = todayDateKey();
      if (windowCheckedForDate !== today) {
        currentWindow = await computeTodaysWindow();
        windowCheckedForDate = today;
        lastRunAt = null; // fresh day — first run inside the window shouldn't wait a full interval
        logger.info("reddit_clip_window_computed", {
          fixtures: currentWindow?.fixtureCount ?? 0,
          windowStart: currentWindow?.start.toISOString() ?? null,
          windowEnd: currentWindow?.end.toISOString() ?? null,
        });
      }

      // Once per day, independent of today's window — this is catching up
      // *past* gaps, not reacting to today's live schedule (see
      // matchesMissingClips's doc comment).
      if (catchUpDoneForDate !== today) {
        catchUpDoneForDate = today;
        await runCatchUpSweep();
      }

      const now = Date.now();
      if (shouldRunNow(currentWindow, now, lastRunAt, POLL_INTERVAL_MS)) {
        lastRunAt = now; // set before running: a failed run shouldn't retry-loop before the next interval is actually due
        await runOnce();
      } else {
        if (!currentWindow) logger.info("reddit_clip_poller_idle_no_fixtures_today");
        // Runs every idle tick regardless of the match window — see
        // resolvePendingClips's doc comment for why this can't wait for a
        // fixture to exist today.
        const { resolved, pending } = await resolvePendingClips();
        if (resolved > 0 || pending > 0) {
          logger.info("reddit_clip_poller_idle_resolve_pass", { resolved, pending });
        }
      }
    } catch (err) {
      logger.error("reddit_clip_poller_cycle_failed", { error: String(err) });
    }
    await sleep(Math.min(POLL_INTERVAL_MS, CHECK_INTERVAL_MS));
  }
}

if (require.main === module) {
  startPolling();
}
