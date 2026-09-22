import type { ClipInput } from "../matching/verify-goals";
import { aliasesFor } from "../matching/team-aliases";
import { logger } from "../logger";

/**
 * FetchLayer (fetchlayer.dev) is a hosted REST API — a single Bearer-token
 * key, no per-platform OAuth — that returns structured JSON for Reddit
 * search/posts/etc. Unlike the fetchlayer *MCP tool* (only reachable from
 * an interactive Claude Code session), this REST endpoint is a normal HTTP
 * API any backend can call, which is what makes automating this
 * deployable rather than a manual "ask Claude Code to re-scrape" step.
 *
 * Response shape confirmed against a live call during development: an
 * `items[]` array of post summaries (id, title, permalink, author,
 * createdAt, …). Everything downstream of finding the post — resolving it
 * to a playable video, verifying it against ESPN's goal list — already
 * runs on plain `fetch()` with no FetchLayer/Reddit-API dependency at all
 * (lib/reddit/resolve-post-media.ts, lib/reddit/resolve-clip.ts,
 * lib/matching/verify-goals.ts) and is unchanged by this file.
 *
 * IMPORTANT, confirmed live (not assumed): a `flair_name:"..."` query term
 * does NOT reliably find real Goal Clip posts, and combined with team names
 * it returns ZERO results even for a match with several real posts —
 * Reddit's search appears to require a literal text match on every query
 * term, and flair text isn't indexed as searchable content (a direct
 * per-post fetch shows `flair: null` even on a post that visibly carries
 * the Goal Clip flair on reddit.com). A plain "{home} {away}" team-name
 * query, with no flair term at all, reliably surfaces real posts that the
 * flair-only query missed entirely. So this searches **per match**, by
 * team name, not once globally per day — see workers/reddit-clip-poller.ts.
 */

const BASE = "https://api.fetchlayer.dev/reddit";
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

type SearchTime = "day" | "week" | "month" | "all";
type SearchSort = "new" | "relevance";

async function searchReddit(query: string, time: SearchTime, sort: SearchSort = "new"): Promise<ClipInput[]> {
  const apiKey = process.env.FETCHLAYER_API_KEY;
  if (!apiKey) return [];

  try {
    const res = await fetch(`${BASE}/search`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query, subreddit: SUBREDDIT, sort, time, limit: 30 }),
    });
    if (!res.ok) {
      logger.warn("fetchlayer_search_failed", { status: res.status, query });
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
    logger.warn("fetchlayer_search_error", { error: String(err), query });
    return [];
  }
}

/**
 * Every r/soccer post mentioning both teams from the last day (falls back
 * to the last week if that turns up nothing — a goal from a match that
 * kicked off late in the day can be just outside a strict 24h window by
 * the time this runs). Deliberately no flair filter — see file doc
 * comment. Returns a mixed bag (match threads, news, actual goal clips);
 * lib/reddit/parse-goal-post.ts#parseGoalClipTitle downstream is what
 * actually recognizes a real Goal Clip title and discards the rest.
 */
export async function searchGoalClipPosts(homeTeamName: string, awayTeamName: string): Promise<ClipInput[]> {
  const query = `${aliasesFor(homeTeamName)[0]} ${aliasesFor(awayTeamName)[0]}`;
  const dayResults = await searchReddit(query, "day");
  if (dayResults.length > 0) return dayResults;
  return searchReddit(query, "week");
}

/**
 * For a match that's more than a few days old (workers/reddit-clip-poller.ts's
 * catch-up sweep) — `sort: "new"` (searchGoalClipPosts above) is right for
 * a match that just finished, but it silently stops working for anything
 * older: "new" returns the 30 newest posts matching the query terms at all,
 * and confirmed live, that fills up with unrelated recent chatter mentioning
 * either team well within a week or two, crowding the actual (older) Goal
 * Clip post out of the results entirely — no time window fixes that, since
 * a wider time range sorted by "new" still returns the *newest* matches
 * first. `sort: "relevance"` doesn't have this problem: confirmed live
 * against a real 17-day-old match (Man City 1-0 Coventry, 2026-09-05) that
 * "new" found nothing for at any time window, "relevance" + "month" found
 * immediately, at the exact match's actual post.
 */
export async function searchGoalClipPostsWide(homeTeamName: string, awayTeamName: string): Promise<ClipInput[]> {
  const query = `${aliasesFor(homeTeamName)[0]} ${aliasesFor(awayTeamName)[0]}`;
  const monthResults = await searchReddit(query, "month", "relevance");
  if (monthResults.length > 0) return monthResults;
  return searchReddit(query, "all", "relevance");
}
