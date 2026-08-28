import "dotenv/config";
import { prisma } from "../lib/db/prisma";
import { logger } from "../lib/logger";
import { footballDataProvider, isSportsApiConfigured } from "../lib/sports/football-data";
import { upsertMatch, ingestNormalizedEvent } from "../lib/sports/ingest";
import type { NormalizedMatch } from "../lib/sports/types";

const POLL_INTERVAL_MS = 60_000;

/**
 * football-data.org's free tier does not reliably expose goal/booking/
 * substitution arrays for most competitions (see lib/sports/normalizer.ts).
 * When a live match's score changes but no structured events came back,
 * synthesize a minimal GOAL event from the score delta so the timeline
 * still reflects reality — scorer unknown is better than silently
 * dropping the goal. Real per-event detail (scorer, assist, cards, subs)
 * still comes through untouched whenever the provider does supply it.
 */
async function synthesizeGoalIfScoreChanged(
  matchId: string,
  previous: { homeScore: number | null; awayScore: number | null },
  detail: NormalizedMatch
) {
  const homeIncreased = (detail.homeScore ?? 0) > (previous.homeScore ?? 0);
  const awayIncreased = (detail.awayScore ?? 0) > (previous.awayScore ?? 0);
  if (!homeIncreased && !awayIncreased) return;

  const teamExternalId = homeIncreased ? detail.homeTeam.externalId : detail.awayTeam.externalId;

  await ingestNormalizedEvent(matchId, {
    externalId: `score-sync-${detail.externalId}-${detail.homeScore}-${detail.awayScore}`,
    type: "GOAL",
    detail: "Goal detected via score change (scorer not provided by data source)",
    minute: detail.minute ?? 0,
    extraMinute: null,
    teamExternalId,
    playerId: null,
    playerName: null,
    assistName: null,
    timestamp: new Date(),
  });
}

async function syncLiveMatch(listMatch: NormalizedMatch) {
  const previous = await prisma.match.findUnique({ where: { externalId: listMatch.externalId } });

  const { match: detailMatch, events } = await footballDataProvider.getMatchDetail(listMatch.externalId);
  const match = await upsertMatch(detailMatch);

  if (events.length > 0) {
    for (const event of events) {
      await ingestNormalizedEvent(match.id, event);
    }
    return;
  }

  if (previous) {
    await synthesizeGoalIfScoreChanged(match.id, previous, detailMatch);
  }
}

export async function pollOnce(): Promise<void> {
  if (!isSportsApiConfigured()) {
    logger.warn("sports_poller_skipped_not_configured", {});
    return;
  }

  const today = new Date().toISOString().slice(0, 10);
  const matches = await footballDataProvider.getMatchesByDate(today);
  logger.info("sports_poller_cycle_started", { date: today, matchCount: matches.length });

  for (const listMatch of matches) {
    try {
      if (listMatch.status === "LIVE" || listMatch.status === "PAUSED") {
        await syncLiveMatch(listMatch);
      } else {
        // scheduled/finished/postponed/cancelled — list-level data is enough, no detail call needed
        await upsertMatch(listMatch);
      }
    } catch (err) {
      // one bad match must not stop the rest of the poll cycle
      logger.error("sports_poller_match_failed", { externalId: listMatch.externalId, error: String(err) });
    }
  }
}

async function startPolling() {
  logger.info("sports_poller_started", { intervalMs: POLL_INTERVAL_MS });
  while (true) {
    try {
      await pollOnce();
    } catch (err) {
      logger.error("sports_poller_cycle_failed", { error: String(err) });
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
}

if (require.main === module) {
  startPolling();
}
