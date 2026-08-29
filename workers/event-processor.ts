import { prisma } from "../lib/db/prisma";
import { logger } from "../lib/logger";
import { matchEventToPosts, type MatchableEvent, type MatchableCandidate } from "../lib/matching";
import { claimOnce, invalidateCache } from "../lib/redis/cache";
import { dedupeKeys, DEDUPE_TTL_SECONDS, cacheKeys } from "../lib/redis/keys";
import { publishRealtimeMessage } from "../lib/redis/pubsub";

/** Only publish a live "community highlight" toast for genuinely strong matches. */
const HIGHLIGHT_PUBLISH_THRESHOLD = 0.6;
/** How far back to consider candidate posts already ingested for this match. */
const CANDIDATE_LOOKBACK_HOURS = 6;

/**
 * Stage: candidate SocialPosts (already persisted by social-ingestion) →
 * matching pipeline → ranked EventSocialMatch rows → highlight_update
 * published for the strongest result. Triggered by social-ingestion after
 * it finds new candidates; safe to call again (upserts).
 */
export async function processEventMatching(eventId: string): Promise<void> {
  const claimed = await claimOnce(dedupeKeys.matchingInFlight(eventId), DEDUPE_TTL_SECONDS.MATCHING_IN_FLIGHT);
  if (!claimed) {
    logger.info("event_matching_already_in_flight", { eventId });
    return;
  }

  const event = await prisma.matchEvent.findUnique({
    where: { id: eventId },
    include: { team: true, match: { include: { homeTeam: true, awayTeam: true } } },
  });
  if (!event) {
    logger.warn("event_processor_event_not_found", { eventId });
    return;
  }

  const since = new Date(Date.now() - CANDIDATE_LOOKBACK_HOURS * 60 * 60 * 1000);
  const candidatePosts = await prisma.socialPost.findMany({
    where: { matchId: event.matchId, fetchedAt: { gte: since } },
  });
  if (candidatePosts.length === 0) return;

  const matchableEvent: MatchableEvent = {
    id: event.id,
    homeTeamName: event.match.homeTeam.name,
    awayTeamName: event.match.awayTeam.name,
    eventTeamName: event.team?.name ?? null,
    type: event.type,
    playerName: event.playerName,
    assistName: event.assistName,
    minute: event.minute,
    timestamp: event.timestamp,
    commentary: event.commentary,
  };

  const candidates: MatchableCandidate[] = candidatePosts.map((p) => ({
    id: p.id,
    title: p.title,
    body: p.body,
    createdAt: p.createdAt,
  }));

  const results = await matchEventToPosts(matchableEvent, candidates);

  for (const result of results) {
    await prisma.eventSocialMatch.upsert({
      where: { eventId_socialPostId: { eventId: event.id, socialPostId: result.socialPostId } },
      create: {
        eventId: event.id,
        socialPostId: result.socialPostId,
        score: result.score,
        matchingMethod: result.matchingMethod,
        playerScore: result.components.playerScore,
        teamScore: result.components.teamScore,
        timeScore: result.components.timeScore,
        eventTypeScore: result.components.eventTypeScore,
        semanticScore: result.components.semanticScore,
      },
      update: {
        score: result.score,
        matchingMethod: result.matchingMethod,
        playerScore: result.components.playerScore,
        teamScore: result.components.teamScore,
        timeScore: result.components.timeScore,
        eventTypeScore: result.components.eventTypeScore,
        semanticScore: result.components.semanticScore,
      },
    });
  }

  await invalidateCache(cacheKeys.matchHighlights(event.matchId));

  const top = results[0];
  if (top && top.score >= HIGHLIGHT_PUBLISH_THRESHOLD) {
    const post = candidatePosts.find((p) => p.id === top.socialPostId);
    if (post) {
      await publishRealtimeMessage({
        type: "highlight_update",
        matchId: event.matchId,
        teamIds: [event.match.homeTeamId, event.match.awayTeamId],
        eventId: event.id,
        highlight: {
          socialPostId: post.id,
          title: post.title,
          url: post.url,
          mediaUrl: post.mediaUrl,
          mediaType: post.mediaType,
          author: post.author,
          score: top.score,
          matchingMethod: top.matchingMethod,
        },
      });
    }
  }

  logger.info("matching_completed", { eventId, matched: results.length, topScore: top?.score ?? null });
}
