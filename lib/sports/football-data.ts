import type { SportsApiProvider, NormalizedMatch, MatchWithEvents } from "./types";
import { normalizeMatch, normalizeEvents, type RawFootballDataMatch } from "./normalizer";
import { fetchWithRetry } from "../http/fetch-with-retry";
import { redis } from "../redis/client";
import { logger } from "../logger";

const BASE_URL = process.env.SPORTS_API_BASE_URL || "https://api.football-data.org/v4";

// football-data.org's free tier allows ~10 requests/minute per token.
const MAX_REQUESTS_PER_WINDOW = 9;
const RATE_LIMIT_WINDOW_SECONDS = 60;

export function isSportsApiConfigured(): boolean {
  return Boolean(process.env.SPORTS_API_KEY);
}

async function withinRateLimit(): Promise<boolean> {
  const key = "ratelimit:sports-api";
  const count = await redis.incr(key);
  if (count === 1) await redis.expire(key, RATE_LIMIT_WINDOW_SECONDS);
  return count <= MAX_REQUESTS_PER_WINDOW;
}

async function request<T>(path: string): Promise<T | null> {
  const apiKey = process.env.SPORTS_API_KEY;
  if (!apiKey) {
    logger.warn("sports_api_not_configured", {});
    return null;
  }
  if (!(await withinRateLimit())) {
    logger.warn("sports_api_rate_limited", { path });
    return null;
  }

  logger.info("sports_api_request", { path });

  try {
    const response = await fetchWithRetry(
      `${BASE_URL}${path}`,
      { headers: { "X-Auth-Token": apiKey } },
      { label: "football_data_api", retries: 3, baseDelayMs: 500, timeoutMs: 8000 }
    );

    if (!response.ok) {
      logger.error("sports_api_failure", { path, status: response.status });
      return null;
    }

    return (await response.json()) as T;
  } catch (err) {
    logger.error("sports_api_failure", { path, error: String(err) });
    return null;
  }
}

export const footballDataProvider: SportsApiProvider = {
  name: "football-data",

  async getMatchesByDate(date: string): Promise<NormalizedMatch[]> {
    const data = await request<{ matches: RawFootballDataMatch[] }>(
      `/matches?dateFrom=${date}&dateTo=${date}`
    );
    if (!data) return [];
    return data.matches.map(normalizeMatch);
  },

  async getMatchDetail(externalMatchId: string): Promise<MatchWithEvents> {
    const raw = await request<RawFootballDataMatch>(`/matches/${externalMatchId}`);
    if (!raw) {
      throw new Error(`football-data: no data for match ${externalMatchId}`);
    }
    return { match: normalizeMatch(raw), events: normalizeEvents(raw) };
  },
};
