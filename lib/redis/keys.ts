/**
 * Central place for Redis key/channel naming + TTL decisions so cache
 * invalidation and pub/sub stay consistent across workers, API routes, and
 * the WebSocket gateway.
 */

export const CACHE_TTL = {
  /** Match list for a given date — changes as statuses/scores update. */
  MATCHES_BY_DATE: 30,
  /** Single match detail — polled frequently while live. */
  MATCH_DETAIL: 15,
  /** Event timeline for a match. */
  MATCH_EVENTS: 10,
  /** Ranked community highlights for a match. */
  MATCH_HIGHLIGHTS: 20,
} as const;

export const cacheKeys = {
  matchesByDate: (date: string) => `sports:matches:${date}`,
  liveMatches: () => "sports:matches:live",
  matchDetail: (matchId: string) => `sports:match:${matchId}`,
  matchEvents: (matchId: string) => `sports:events:${matchId}`,
  matchHighlights: (matchId: string) => `sports:highlights:${matchId}`,
};

/**
 * Short-lived dedupe/in-flight markers. These are a defense-in-depth layer
 * on top of Postgres unique constraints (see MatchEvent@@unique) — they stop
 * a slow overlapping poll cycle from doing duplicate work (e.g. kicking off
 * a second matching pass) before the DB write would have caught it anyway.
 */
export const dedupeKeys = {
  /** Prevents re-processing the same external event within one poll window. */
  eventSeen: (matchId: string, externalId: string) => `dedupe:event:${matchId}:${externalId}`,
  /** Marks that the matching pipeline is already running for an event. */
  matchingInFlight: (eventId: string) => `dedupe:matching:${eventId}`,
};

export const DEDUPE_TTL_SECONDS = {
  EVENT_SEEN: 300,
  MATCHING_IN_FLIGHT: 60,
} as const;

/** Single pub/sub channel carrying a discriminated union — see lib/redis/pubsub.ts. */
export const REALTIME_CHANNEL = "football:updates";
