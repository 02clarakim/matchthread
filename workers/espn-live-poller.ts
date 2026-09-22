import "dotenv/config";
import { prisma } from "../lib/db/prisma";
import { logger } from "../lib/logger";
import { fetchEspnScoreboard, fetchEspnMatch, isLeagueFixture, type EspnScoreboardMatch } from "../lib/sports/espn";
import { EspnResolver } from "../lib/sports/espn-resolve";
import { upsertEspnMatch, ingestEspnMatchDetail } from "../lib/sports/espn-ingest";

/**
 * Live match detection without a paid live-score feed, using ESPN's free
 * scoreboard endpoint (one call per league per cycle — NOT one per match).
 *
 *  - Every cycle: refresh status + score + minute for every in-window
 *    fixture. A SCHEDULED→LIVE flip is what makes a game appear on the
 *    homepage "Live now" board; score changes tick the scoreboard.
 *  - The expensive call — the full match summary with goalscorers + cards —
 *    is fetched ONLY on a meaningful transition: kick-off's first goal,
 *    any later score change, half-time, and full-time. At those points we
 *    reconcile MatchEvents (idempotent: deterministic externalIds), so
 *    scorers/cards land in the timeline at HT and FT as asked.
 *
 * Does not invent fixtures: a SCHEDULED/FINISHED match not already in the
 * DB is left for scripts/backfill.ts. It only creates a match row itself
 * when ESPN says that match is live right now.
 *
 * Matchday-aware scheduling (the actual point of this file, beyond the
 * per-fixture logic above): Premier League + La Liga kickoffs cluster
 * inside a real, data-derived window — roughly 11:00-19:00 UTC for kickoff
 * time, so accounting for match length the "something could be live" window
 * runs about 11:00-21:30 UTC on an actual match day — and a large share of
 * calendar days have no fixture at all. Polling every minute around the
 * clock, every day, wastes the vast majority of calls on hours/days where
 * nothing is happening. Instead:
 *
 *   1. TIER 1 (cheap, infrequent): every FIXTURE_CHECK_INTERVAL_MS, fetch
 *      today's (and a one-day pad either side, for matches whose kickoff
 *      sits near a UTC day boundary) fixtures for each league and compute
 *      the union kickoff window, padded for match length. This also picks
 *      up postponements/reschedules without a restart.
 *   2. TIER 2 (the real live loop): only inside that computed window does
 *      the LIVE_POLL_INTERVAL_MS loop actually run. Outside it — including
 *      the ~55% of days with no PL/La Liga fixture at all — the poller
 *      sleeps at IDLE_CHECK_INTERVAL_MS instead, touching ESPN only for the
 *      periodic tier-1 refresh.
 *
 * ESPN's multi-day range query (`dates=YYYYMMDD-YYYYMMDD`) started
 * returning 400 for any span (even 2 days) as of 2026-09-21 — confirmed by
 * hand against the live API, not assumed. Every fetch here is therefore a
 * single `dates=YYYYMMDD` call, looped per day needed, not a range.
 */

const LIVE_POLL_INTERVAL_MS = Number(process.env.ESPN_POLL_INTERVAL_MS ?? 120_000); // 2 min while a match is actually live
const FIXTURE_CHECK_INTERVAL_MS = Number(process.env.ESPN_FIXTURE_CHECK_INTERVAL_MS ?? 6 * 60 * 60 * 1000); // 6h
const IDLE_CHECK_INTERVAL_MS = Number(process.env.ESPN_IDLE_CHECK_INTERVAL_MS ?? 15 * 60 * 1000); // 15 min while nothing's on
const PRE_KICKOFF_BUFFER_MS = 5 * 60 * 1000;
const POST_KICKOFF_BUFFER_MS = 130 * 60 * 1000; // 90 min + stoppage/HT/ET slack

const LEAGUES = (process.env.ESPN_LEAGUES ?? "eng.1,esp.1").split(",").map((s) => s.trim());

function yyyymmdd(d: Date): string {
  return d.toISOString().slice(0, 10).replace(/-/g, "");
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Every fixture for a league on one calendar date — never a range (see file doc comment). */
async function fetchDay(league: string, date: Date): Promise<EspnScoreboardMatch[]> {
  try {
    return (await fetchEspnScoreboard(league, yyyymmdd(date))).filter(isLeagueFixture);
  } catch (err) {
    logger.warn("espn_scoreboard_failed", { league, date: yyyymmdd(date), error: String(err) });
    return [];
  }
}

/** Remembers which (match, status, score) we've already pulled a summary for, so a game sitting at HT isn't re-fetched every cycle. */
const summarySeen = new Set<string>();

function scoreStr(sb: EspnScoreboardMatch): string {
  return `${sb.home.score ?? "-"}-${sb.away.score ?? "-"}`;
}

async function processFixture(resolver: EspnResolver, sb: EspnScoreboardMatch): Promise<void> {
  const existing = await prisma.match.findUnique({
    where: { externalId: `espn-${sb.espnEventId}` },
    select: { id: true, status: true, homeScore: true, awayScore: true },
  });

  const isLiveNow = sb.status === "LIVE" || sb.status === "PAUSED";
  if (!existing && !isLiveNow) return; // backfill's job, not ours

  const prevStatus = existing?.status ?? "SCHEDULED";
  const prevScore = existing ? `${existing.homeScore ?? "-"}-${existing.awayScore ?? "-"}` : "-- ";
  const nowScore = scoreStr(sb);

  const statusChanged = prevStatus !== sb.status;
  const scoreChanged = existing !== null && prevScore !== nowScore;
  if (existing && !statusChanged && !scoreChanged && sb.minute === null) return; // nothing to do

  const m = await upsertEspnMatch(resolver, sb);
  if (statusChanged || scoreChanged || !existing) {
    logger.info("espn_live_match_update", {
      matchId: m.matchId,
      teams: `${m.homeTeamName} v ${m.awayTeamName}`,
      status: `${prevStatus}->${sb.status}`,
      score: nowScore,
    });
  }

  // Pull the detailed summary on: first appearance while live, any score
  // change, half-time, full-time. Guard against re-pulling the same state.
  const wantSummary =
    (isLiveNow || sb.status === "FINISHED") &&
    (scoreChanged ||
      (statusChanged && (sb.status === "PAUSED" || sb.status === "FINISHED" || sb.status === "LIVE")) ||
      (!existing && isLiveNow));

  const summaryKey = `${sb.espnEventId}:${sb.status}:${nowScore}`;
  if (wantSummary && !summarySeen.has(summaryKey)) {
    summarySeen.add(summaryKey);
    try {
      const summary = await fetchEspnMatch(sb.espnEventId, sb.league);
      const { goalCount, cardCount, subCount, varCount } = await ingestEspnMatchDetail(
        m.matchId,
        sb.espnEventId,
        summary,
        m.teamExternalIdByEspnId
      );
      logger.info("espn_live_detail_reconciled", {
        matchId: m.matchId,
        trigger: sb.status,
        goals: goalCount,
        cards: cardCount,
        subs: subCount,
        vars: varCount,
      });
    } catch (err) {
      summarySeen.delete(summaryKey); // let a transient failure retry next cycle
      logger.warn("espn_live_summary_failed", { espnEventId: sb.espnEventId, error: String(err) });
    }
  }
}

/** One live-tier cycle: refresh yesterday+today's fixtures (covers a match whose kickoff sits just before a UTC day boundary) for every league. */
export async function pollOnce(): Promise<void> {
  const now = new Date();
  const days = [new Date(now.getTime() - 86_400_000), now];
  const resolver = new EspnResolver(prisma); // fresh each cycle so newly-added teams resolve

  let liveCount = 0;
  for (const league of LEAGUES) {
    for (const day of days) {
      const fixtures = await fetchDay(league, day);
      for (const sb of fixtures) {
        if (sb.status === "LIVE" || sb.status === "PAUSED") liveCount += 1;
        try {
          await processFixture(resolver, sb);
        } catch (err) {
          logger.error("espn_live_fixture_failed", { espnEventId: sb.espnEventId, error: String(err) });
        }
      }
    }
  }
  logger.info("espn_live_poller_cycle", { leagues: LEAGUES.length, live: liveCount });
}

export interface LiveWindow {
  start: Date;
  end: Date;
  fixtureCount: number;
}

/** Pure math, separated out so the window logic is testable without mocking the network. */
export function computeWindowFromKickoffs(kickoffs: Date[]): LiveWindow | null {
  if (kickoffs.length === 0) return null;
  const times = kickoffs.map((k) => k.getTime());
  return {
    start: new Date(Math.min(...times) - PRE_KICKOFF_BUFFER_MS),
    end: new Date(Math.max(...times) + POST_KICKOFF_BUFFER_MS),
    fixtureCount: kickoffs.length,
  };
}

/**
 * Fetches yesterday/today/tomorrow's fixtures for every league (single-day
 * calls, 6 total for 2 leagues) and computes the padded union kickoff
 * window for today — the "worth polling tightly" period. Returns null on a
 * day with no fixture at all, which is most days.
 */
export async function computeTodaysWindow(): Promise<LiveWindow | null> {
  const now = new Date();
  const days = [new Date(now.getTime() - 86_400_000), now, new Date(now.getTime() + 86_400_000)];

  const kickoffs: Date[] = [];
  for (const league of LEAGUES) {
    for (const day of days) {
      const fixtures = await fetchDay(league, day);
      for (const f of fixtures) kickoffs.push(f.kickoffAt);
    }
  }
  return computeWindowFromKickoffs(kickoffs);
}

let currentWindow: LiveWindow | null = null;
let lastFixtureCheckAt = 0;

export function isInsideWindow(window: LiveWindow | null): boolean {
  if (!window) return false;
  const now = Date.now();
  return now >= window.start.getTime() && now <= window.end.getTime();
}

async function refreshWindowIfStale(): Promise<void> {
  if (Date.now() - lastFixtureCheckAt < FIXTURE_CHECK_INTERVAL_MS) return;
  try {
    currentWindow = await computeTodaysWindow();
    lastFixtureCheckAt = Date.now();
    logger.info("espn_fixture_window_computed", {
      fixtures: currentWindow?.fixtureCount ?? 0,
      windowStart: currentWindow?.start.toISOString() ?? null,
      windowEnd: currentWindow?.end.toISOString() ?? null,
    });
  } catch (err) {
    logger.error("espn_fixture_check_failed", { error: String(err) });
  }
}

async function startPolling(): Promise<void> {
  logger.info("espn_live_poller_started", {
    liveIntervalMs: LIVE_POLL_INTERVAL_MS,
    fixtureCheckIntervalMs: FIXTURE_CHECK_INTERVAL_MS,
    idleIntervalMs: IDLE_CHECK_INTERVAL_MS,
    leagues: LEAGUES.join(","),
  });
  // keep the "already pulled" set from growing without bound across a long run
  setInterval(() => summarySeen.clear(), 6 * 60 * 60 * 1000).unref();

  await refreshWindowIfStale(); // prime on startup, don't wait a full interval for the first check

  for (;;) {
    await refreshWindowIfStale();

    if (isInsideWindow(currentWindow)) {
      try {
        await pollOnce();
      } catch (err) {
        logger.error("espn_live_poller_cycle_failed", { error: String(err) });
      }
      await sleep(LIVE_POLL_INTERVAL_MS);
    } else {
      logger.info("espn_live_poller_idle", { nextWindowStart: currentWindow?.start.toISOString() ?? null });
      await sleep(IDLE_CHECK_INTERVAL_MS);
    }
  }
}

if (require.main === module) {
  startPolling();
}
