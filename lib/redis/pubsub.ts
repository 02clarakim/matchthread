import { redisPublisher, createSubscriberClient } from "./client";
import { REALTIME_CHANNEL } from "./keys";
import { logger } from "../logger";
import type { MatchEventType, MatchStatus, MatchingMethod, SocialMediaType } from "@prisma/client";

/**
 * Discriminated union of everything that can flow from workers to the
 * WebSocket gateway over the single `football:updates` Redis channel.
 * Kept as one channel + a `type` tag (rather than one channel per message
 * type) because the gateway subscribes once and fans out to clients based
 * on `matchId`/`teamIds` — a single stream is simpler to reason about and
 * there's no meaningful throughput problem at this scale.
 */
export type RealtimeMessage =
  | {
      type: "match_event";
      matchId: string;
      teamIds: string[];
      event: {
        id: string;
        type: MatchEventType;
        detail: string | null;
        minute: number;
        extraMinute: number | null;
        teamId: string | null;
        playerName: string | null;
        assistName: string | null;
        commentary: string | null;
      };
    }
  | {
      type: "commentary_update";
      matchId: string;
      teamIds: string[];
      eventId: string;
      commentary: string;
    }
  | {
      type: "highlight_update";
      matchId: string;
      teamIds: string[];
      eventId: string;
      highlight: {
        socialPostId: string;
        title: string;
        url: string;
        mediaUrl: string | null;
        mediaType: SocialMediaType | null;
        author: string | null;
        score: number;
        matchingMethod: MatchingMethod;
      };
    }
  | {
      type: "match_update";
      matchId: string;
      teamIds: string[];
      status: MatchStatus;
      homeScore: number | null;
      awayScore: number | null;
      minute: number | null;
    };

export async function publishRealtimeMessage(message: RealtimeMessage): Promise<void> {
  try {
    await redisPublisher.publish(REALTIME_CHANNEL, JSON.stringify(message));
    logger.info("redis_publish", { channel: REALTIME_CHANNEL, type: message.type, matchId: message.matchId });
  } catch (err) {
    logger.error("redis_publish_failed", { channel: REALTIME_CHANNEL, error: String(err) });
  }
}

/**
 * Subscribes to the realtime channel on a dedicated connection.
 * Returns an unsubscribe function. Intended for use by the standalone
 * WebSocket gateway process (workers/ws-server.ts).
 */
export function subscribeToRealtimeMessages(
  onMessage: (message: RealtimeMessage) => void
): () => Promise<void> {
  const subscriber = createSubscriberClient();

  subscriber.subscribe(REALTIME_CHANNEL, (err) => {
    if (err) {
      logger.error("redis_subscribe_failed", { channel: REALTIME_CHANNEL, error: String(err) });
    } else {
      logger.info("redis_subscribed", { channel: REALTIME_CHANNEL });
    }
  });

  subscriber.on("message", (channel, raw) => {
    if (channel !== REALTIME_CHANNEL) return;
    try {
      const message = JSON.parse(raw) as RealtimeMessage;
      onMessage(message);
    } catch (err) {
      logger.warn("redis_message_parse_failed", { channel, error: String(err) });
    }
  });

  return async () => {
    await subscriber.unsubscribe(REALTIME_CHANNEL);
    subscriber.disconnect();
  };
}
