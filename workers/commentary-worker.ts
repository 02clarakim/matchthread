import { prisma } from "../lib/db/prisma";
import { logger } from "../lib/logger";
import { getCommentaryForEvent, type CommentaryInput } from "../lib/commentary";
import { publishRealtimeMessage } from "../lib/redis/pubsub";
import { invalidateCache } from "../lib/redis/cache";
import { cacheKeys } from "../lib/redis/keys";

/**
 * Retrieves commentary for a just-ingested event, normalizes it, persists it,
 * and publishes a `commentary_update` so it can arrive on the client a beat
 * after the bare event — the "progressive enhancement" part of the pipeline.
 * Safe to call more than once for the same event (idempotent overwrite).
 */
export async function attachCommentary(eventId: string): Promise<void> {
  const event = await prisma.matchEvent.findUnique({
    where: { id: eventId },
    include: {
      team: true,
      match: { include: { homeTeam: true, awayTeam: true } },
    },
  });
  if (!event) {
    logger.warn("commentary_worker_event_not_found", { eventId });
    return;
  }

  const opponent =
    event.teamId === event.match.homeTeamId ? event.match.awayTeam : event.match.homeTeam;

  const input: CommentaryInput = {
    matchExternalId: event.match.externalId,
    eventExternalId: event.externalId,
    type: event.type,
    minute: event.minute,
    extraMinute: event.extraMinute,
    teamName: event.team?.name ?? null,
    opponentName: opponent?.name ?? null,
    playerName: event.playerName,
    assistName: event.assistName,
    detail: event.detail,
  };

  const commentary = await getCommentaryForEvent(input);
  if (!commentary) {
    logger.info("commentary_unavailable", { eventId });
    return;
  }

  await prisma.matchEvent.update({
    where: { id: eventId },
    data: {
      commentary: commentary.text,
      commentarySource: commentary.source,
      commentaryFetchedAt: new Date(),
    },
  });

  await invalidateCache(cacheKeys.matchEvents(event.matchId));

  await publishRealtimeMessage({
    type: "commentary_update",
    matchId: event.matchId,
    teamIds: [event.match.homeTeamId, event.match.awayTeamId],
    eventId: event.id,
    commentary: commentary.text,
  });

  logger.info("commentary_attached", { eventId, source: commentary.source });
}
