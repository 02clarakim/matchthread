import { prisma } from "../lib/db/prisma";
import { logger } from "../lib/logger";
import { redditProvider } from "../lib/reddit/provider";
import type { SocialSearchEvent } from "../lib/social/provider";
import { claimOnce } from "../lib/redis/cache";
import { dedupeKeys, DEDUPE_TTL_SECONDS } from "../lib/redis/keys";
import { processEventMatching } from "./event-processor";

/**
 * Goals, red cards, and VAR decisions are worth searching social media for.
 * Yellow cards/subs still get commentary (workers/commentary-worker.ts) but
 * aren't important enough to spend a Reddit search + matching pass on.
 */
const SOCIAL_WORTHY_EVENT_TYPES = new Set([
  "GOAL",
  "PENALTY_GOAL",
  "OWN_GOAL",
  "RED_CARD",
  "SECOND_YELLOW_CARD",
  "VAR_DECISION",
]);

export function isSocialWorthy(eventType: string): boolean {
  return SOCIAL_WORTHY_EVENT_TYPES.has(eventType);
}

export async function ingestSocialForEvent(eventId: string): Promise<void> {
  const claimed = await claimOnce(dedupeKeys.socialInFlight(eventId), DEDUPE_TTL_SECONDS.SOCIAL_IN_FLIGHT);
  if (!claimed) {
    logger.info("social_ingestion_already_in_flight", { eventId });
    return;
  }

  const event = await prisma.matchEvent.findUnique({
    where: { id: eventId },
    include: { match: { include: { homeTeam: true, awayTeam: true } } },
  });
  if (!event) {
    logger.warn("social_ingestion_event_not_found", { eventId });
    return;
  }

  const searchEvent: SocialSearchEvent = {
    homeTeamName: event.match.homeTeam.name,
    awayTeamName: event.match.awayTeam.name,
    eventType: event.type,
    playerName: event.playerName,
    minute: event.minute,
    commentary: event.commentary,
  };

  logger.info("reddit_search_started", { eventId, matchId: event.matchId });

  const candidates = await redditProvider.searchForEvent(searchEvent);

  logger.info("reddit_search_completed", { eventId, candidates: candidates.length });

  for (const candidate of candidates) {
    await prisma.socialPost.upsert({
      where: { source_externalId: { source: "REDDIT", externalId: candidate.externalId } },
      create: {
        source: "REDDIT",
        externalId: candidate.externalId,
        matchId: event.matchId,
        title: candidate.title,
        body: candidate.body,
        author: candidate.author,
        url: candidate.url,
        mediaUrl: candidate.mediaUrl,
        createdAt: candidate.createdAt,
      },
      // A post can plausibly resurface across searches for the same match;
      // nothing about it changes, so upsert is a no-op update.
      update: {},
    });
  }

  if (candidates.length > 0) {
    await processEventMatching(eventId);
  }
}
