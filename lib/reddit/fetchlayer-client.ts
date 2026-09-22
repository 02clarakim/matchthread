import type { ClipInput } from "../matching/verify-goals";
import { logger } from "../logger";

/**
 * FetchLayer (fetchlayer.dev) is a hosted REST API — a single Bearer-token
 * key, no per-platform OAuth — that returns structured JSON for Reddit
 * search/posts/etc. Unlike the fetchlayer *MCP tool* (only reachable from
 * an interactive Claude Code session), this REST endpoint is a normal HTTP
 * API any backend can call, which is what makes automating this
 * deployable rather than a manual "ask Claude Code to re-scrape" step.
 * Pay-as-you-go, ~$0.002/request — at roughly one call per match day (see
 * workers/reddit-clip-poller.ts), this runs to cents a month.
 *
 * Response shape confirmed against a live call during development: an
 * `items[]` array of post summaries (id, title, permalink, author,
 * createdAt, …). Everything downstream of finding the post — resolving it
 * to a playable video, verifying it against ESPN's goal list — already
 * runs on plain `fetch()` with no FetchLayer/Reddit-API dependency at all
 * (lib/reddit/resolve-post-media.ts, lib/reddit/resolve-clip.ts,
 * lib/matching/verify-goals.ts) and is unchanged by this file.
 */

const BASE = "https://api.fetchlayer.dev/reddit";
const GOAL_CLIP_QUERY = 'flair_name:":n_goal: Goal Clip"';
const SUBREDDIT = "soccer";

export function isFetchlayerConfigured(): boolean {
  return Boolean(process.env.FETCHLAYER_API_KEY);
}

interface FetchlayerSearchItem {
  id: string;
  title: string;
  author: string | null;
  permalink: string;
  createdAt: string;
}

interface FetchlayerSearchResponse {
  items?: FetchlayerSearchItem[];
}

function toRelativePermalink(absoluteOrRelative: string): string {
  try {
    return new URL(absoluteOrRelative).pathname;
  } catch {
    return absoluteOrRelative; // already relative
  }
}

/**
 * Every r/soccer "Goal Clip" post from the last 24 hours, across every
 * match — one call covers an entire match day regardless of how many
 * games were on, since the cost here is per-request, not per-goal.
 * lib/matching/verify-goals.ts's clipsForMatch() then sorts these by team
 * name locally, no extra network calls needed.
 */
export async function searchGoalClipPosts(): Promise<ClipInput[]> {
  const apiKey = process.env.FETCHLAYER_API_KEY;
  if (!apiKey) return [];

  try {
    const res = await fetch(`${BASE}/search`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        query: GOAL_CLIP_QUERY,
        subreddit: SUBREDDIT,
        sort: "new",
        time: "day",
        limit: 100,
      }),
    });
    if (!res.ok) {
      logger.warn("fetchlayer_search_failed", { status: res.status });
      return [];
    }
    const data = (await res.json()) as FetchlayerSearchResponse;
    const items = Array.isArray(data.items) ? data.items : [];
    return items.map(
      (item): ClipInput => ({
        postId: item.id,
        title: item.title,
        permalink: toRelativePermalink(item.permalink),
        author: item.author,
        createdAt: item.createdAt,
        sourceUrl: `https://www.reddit.com${toRelativePermalink(item.permalink)}`,
        sourceHost: "reddit",
      })
    );
  } catch (err) {
    logger.warn("fetchlayer_search_error", { error: String(err) });
    return [];
  }
}
