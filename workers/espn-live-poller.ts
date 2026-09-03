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
 */

const POLL_INTERVAL_MS = Number(process.env.ESPN_POLL_INTERVAL_MS ?? 60_000);
const LEAGUES = (process.env.ESPN_LEAGUES ?? "eng.1,esp.1").split(",").map((s) => s.trim());

function yyyymmdd(d: Date): string {
  return d.toISOString().slice(0, 10).replace(/-/g, "");
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
      const { goalCount, cardCount } = await ingestEspnMatchDetail(
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
      });
    } catch (err) {
      summarySeen.delete(summaryKey); // let a transient failure retry next cycle
      logger.warn("espn_live_summary_failed", { espnEventId: sb.espnEventId, error: String(err) });
    }
  }
}

export async function pollOnce(): Promise<void> {
  const now = new Date();
  const dates = `${yyyymmdd(new Date(now.getTime() - 86_400_000))}-${yyyymmdd(new Date(now.getTime() + 86_400_000))}`;
  const resolver = new EspnResolver(prisma); // fresh each cycle so newly-added teams resolve

  let liveCount = 0;
  for (const league of LEAGUES) {
    let fixtures: EspnScoreboardMatch[];
    try {
      fixtures = (await fetchEspnScoreboard(league, dates)).filter(isLeagueFixture);
    } catch (err) {
      logger.warn("espn_scoreboard_failed", { league, error: String(err) });
      continue;
    }
    for (const sb of fixtures) {
      if (sb.status === "LIVE" || sb.status === "PAUSED") liveCount += 1;
      try {
        await processFixture(resolver, sb);
      } catch (err) {
        logger.error("espn_live_fixture_failed", { espnEventId: sb.espnEventId, error: String(err) });
      }
    }
  }
  logger.info("espn_live_poller_cycle", { leagues: LEAGUES.length, live: liveCount });
}

async function startPolling(): Promise<void> {
  logger.info("espn_live_poller_started", { intervalMs: POLL_INTERVAL_MS, leagues: LEAGUES.join(",") });
  // keep the "already pulled" set from growing without bound across a long run
  setInterval(() => summarySeen.clear(), 6 * 60 * 60 * 1000).unref();
  for (;;) {
    try {
      await pollOnce();
    } catch (err) {
      logger.error("espn_live_poller_cycle_failed", { error: String(err) });
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
}

if (require.main === module) {
  startPolling();
}
