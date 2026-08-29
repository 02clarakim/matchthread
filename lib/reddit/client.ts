import { fetchWithRetry } from "../http/fetch-with-retry";
import { getCached, setCached, claimOnce } from "../redis/cache";
import { rateLimitKeys } from "../redis/keys";
import { redis } from "../redis/client";
import { logger } from "../logger";

const REDDIT_TOKEN_CACHE_KEY = "reddit:access_token";
const USER_AGENT = process.env.REDDIT_USER_AGENT || "football-realtime/0.1";

// Conservative client-side ceiling, well under Reddit's own documented
// OAuth script-app limit (~60/min) — this protects the app from a runaway
// polling loop hammering Reddit, not the other way around.
//
// Sized for the live-poller (workers/reddit-live-poller.ts): at a 20s
// interval, one tracked match costs up to 3 searches/cycle (goal flair
// search, its keyword fallback, and a red-card search) = ~9/min per match.
// 45/min leaves headroom for a couple of concurrently tracked matches
// plus the event-triggered searches from social-ingestion.ts.
const MAX_SEARCHES_PER_WINDOW = 45;
const RATE_LIMIT_WINDOW_SECONDS = 60;

export function isRedditConfigured(): boolean {
  return Boolean(process.env.REDDIT_CLIENT_ID && process.env.REDDIT_CLIENT_SECRET);
}

/**
 * Reddit's "application only" OAuth flow (client_credentials grant) — no
 * user login required, appropriate for read-only search. Token is cached
 * in Redis so we don't re-authenticate on every search (tokens last ~1h).
 */
async function getAccessToken(): Promise<string | null> {
  const cached = await getCached<string>(REDDIT_TOKEN_CACHE_KEY);
  if (cached) return cached;

  const clientId = process.env.REDDIT_CLIENT_ID;
  const clientSecret = process.env.REDDIT_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;

  const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");

  const response = await fetchWithRetry(
    "https://www.reddit.com/api/v1/access_token",
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${basicAuth}`,
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": USER_AGENT,
      },
      body: "grant_type=client_credentials",
    },
    { label: "reddit_oauth", retries: 2, timeoutMs: 5000 }
  );

  if (!response.ok) {
    logger.warn("reddit_oauth_failed", { status: response.status });
    return null;
  }

  const data = (await response.json()) as { access_token: string; expires_in: number };
  // refresh a little early to avoid using a token that expires mid-request
  await setCached(REDDIT_TOKEN_CACHE_KEY, data.access_token, Math.max(60, data.expires_in - 60));
  return data.access_token;
}

async function withinRateLimit(): Promise<boolean> {
  const key = rateLimitKeys.redditSearch();
  const count = await redis.incr(key);
  if (count === 1) {
    await redis.expire(key, RATE_LIMIT_WINDOW_SECONDS);
  }
  return count <= MAX_SEARCHES_PER_WINDOW;
}

export interface RedditPost {
  id: string;
  title: string;
  selftext: string;
  author: string;
  permalink: string;
  url: string;
  thumbnail: string;
  created_utc: number;
  score: number;
  post_hint?: string;
  is_video?: boolean;
  url_overridden_by_dest?: string;
  media?: { reddit_video?: { fallback_url?: string } } | null;
  preview?: { images?: Array<{ source?: { url?: string } }> };
}

/** Searches a subreddit for a query string. Returns [] on any failure/rate-limit — search is best-effort. */
export async function searchSubreddit(
  subreddit: string,
  query: string,
  limit = 15
): Promise<RedditPost[]> {
  if (!isRedditConfigured()) return [];

  if (!(await withinRateLimit())) {
    logger.warn("reddit_rate_limited", { subreddit, query });
    return [];
  }

  const token = await getAccessToken();
  if (!token) return [];

  const params = new URLSearchParams({
    q: query,
    restrict_sr: "1",
    sort: "relevance",
    limit: String(limit),
    t: "day",
  });

  try {
    const response = await fetchWithRetry(
      `https://oauth.reddit.com/r/${subreddit}/search?${params.toString()}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          "User-Agent": USER_AGENT,
        },
      },
      { label: "reddit_search", retries: 2, timeoutMs: 5000 }
    );

    if (!response.ok) {
      logger.warn("reddit_search_failed", { subreddit, query, status: response.status });
      return [];
    }

    const data = (await response.json()) as {
      data: { children: Array<{ data: RedditPost }> };
    };
    return data.data.children.map((c) => c.data);
  } catch (err) {
    logger.warn("reddit_search_error", { subreddit, query, error: String(err) });
    return [];
  }
}

/** Best-effort in-process dedupe so identical queries fired close together don't double-search. */
export async function claimSearch(query: string): Promise<boolean> {
  return claimOnce(`reddit:search-claim:${query}`, 30);
}
