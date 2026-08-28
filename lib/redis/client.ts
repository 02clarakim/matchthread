import Redis from "ioredis";

const globalForRedis = globalThis as unknown as {
  redis: Redis | undefined;
  redisPublisher: Redis | undefined;
};

function createClient() {
  const url = process.env.REDIS_URL ?? "redis://localhost:6379";
  return new Redis(url, {
    maxRetriesPerRequest: 3,
    retryStrategy(times) {
      // exponential backoff, capped at 5s, so a Redis restart doesn't crash the process
      return Math.min(times * 500, 5000);
    },
  });
}

/** General-purpose client: GET/SET/caching, dedupe keys, rate limiting. */
export const redis = globalForRedis.redis ?? createClient();

/**
 * Dedicated publisher client. ioredis puts a connection into a special mode
 * once `.subscribe()` is called on it, after which it can only issue
 * subscribe/unsubscribe/ping — so publishing and subscribing must never
 * share a connection.
 */
export const redisPublisher = globalForRedis.redisPublisher ?? createClient();

if (process.env.NODE_ENV !== "production") {
  globalForRedis.redis = redis;
  globalForRedis.redisPublisher = redisPublisher;
}

/** Creates a fresh, dedicated connection for subscribing. Caller owns its lifecycle. */
export function createSubscriberClient() {
  return createClient();
}
