import "dotenv/config";
import { prisma } from "../lib/db/prisma";
import { redis, redisPublisher } from "../lib/redis/client";
import { LEAGUE_NAMES, fetchEspnMatch } from "../lib/sports/espn";
import { ingestEspnMatchDetail } from "../lib/sports/espn-ingest";
import { waitForPendingBackgroundWork } from "../lib/sports/ingest";
import { logger } from "../lib/logger";

/**
 * Catches up any FINISHED, ESPN-sourced match that has a real score but
 * zero events at all. Confirmed live as a real gap, not hypothetical:
 * scripts/backfill.ts caps how many matches get full detail per run
 * (`--limit-summaries`, default 80, to bound OpenAI/ESPN calls), and
 * anything past that cap gets logged as "summary budget exhausted — score
 * only" and left with no goals/cards/subs/commentary at all. Running a
 * production backfill against more matches than the default cap covers
 * (this project's first production seed pulled 150 finished matches) means
 * some genuinely never get filled in unless something re-checks for them.
 *
 * Deliberately NOT the same as re-running scripts/backfill.ts with a
 * higher --limit-summaries: attachCommentary() is an idempotent
 * *overwrite* (see workers/commentary-worker.ts), so re-running the full
 * backfill would also regenerate — and re-bill — commentary for every
 * event that already has good real commentary, not just the missing ones.
 * This only ever touches matches with zero events to begin with.
 *
 *   npm run fill-missing-events
 */

const LEAGUE_SLUG_BY_NAME = Object.fromEntries(Object.entries(LEAGUE_NAMES).map(([slug, name]) => [name, slug]));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const missing = await prisma.match.findMany({
    where: { externalId: { startsWith: "espn-" }, status: "FINISHED", events: { none: {} } },
    include: { homeTeam: true, awayTeam: true, league: true },
  });
  console.log(`filling in ${missing.length} finished matches with zero events\n`);

  let goals = 0;
  let cards = 0;
  let subs = 0;
  let vars = 0;
  let failed = 0;

  for (const m of missing) {
    const espnEventId = m.externalId.replace(/^espn-/, "");
    const leagueSlug = LEAGUE_SLUG_BY_NAME[m.league.name] ?? "eng.1";
    try {
      const summary = await fetchEspnMatch(espnEventId, leagueSlug);
      const teamExternalIdByEspnId = new Map([
        [summary.home.espnId, m.homeTeam.externalId],
        [summary.away.espnId, m.awayTeam.externalId],
      ]);
      const result = await ingestEspnMatchDetail(m.id, espnEventId, summary, teamExternalIdByEspnId);
      goals += result.goalCount;
      cards += result.cardCount;
      subs += result.subCount;
      vars += result.varCount;
      console.log(
        `  ✓ ${m.homeTeam.name} ${m.homeScore}-${m.awayScore} ${m.awayTeam.name} — ${result.goalCount}g ${result.cardCount}c ${result.subCount}s`
      );
    } catch (err) {
      failed += 1;
      console.log(`  ✗ ${m.homeTeam.name} v ${m.awayTeam.name} — ${String(err)}`);
      logger.warn("fill_missing_events_match_failed", { matchId: m.id, error: String(err) });
    }
    await sleep(100);
  }

  console.log(
    `\ndone — ${missing.length - failed}/${missing.length} matches filled in, ${goals} goals, ${cards} cards, ${subs} subs, ${vars} VAR, ${failed} failed`
  );
  logger.info("fill_missing_events_done", { total: missing.length, goals, cards, subs, vars, failed });
}

main()
  .catch((err) => {
    logger.error("fill_missing_events_failed", { error: String(err) });
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await waitForPendingBackgroundWork();
    await prisma.$disconnect();
    redis?.disconnect();
    redisPublisher?.disconnect();
  });
