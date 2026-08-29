import type { SocialProvider, SocialSearchEvent, SocialCandidate } from "../social/provider";
import { searchSubreddit, type RedditPost } from "./client";
import { aliasesFor } from "../matching/team-aliases";
import { logger } from "../logger";

const SUBREDDIT = "soccer";

const EVENT_TYPE_WORDS: Partial<Record<SocialSearchEvent["eventType"], string>> = {
  GOAL: "goal",
  PENALTY_GOAL: "goal",
  OWN_GOAL: "goal",
  RED_CARD: "red card",
  SECOND_YELLOW_CARD: "red card",
  YELLOW_CARD: "yellow card",
  VAR_DECISION: "VAR",
  SUBSTITUTION: "sub",
};

const INVALID_THUMBNAILS = new Set(["self", "default", "nsfw", "spoiler", "image", ""]);

/** Reddit's JSON API HTML-escapes URLs (e.g. `&amp;` for `&`) — undo that before use. */
function unescapeUrl(url: string): string {
  return url.replace(/&amp;/g, "&");
}

/**
 * Extracts a directly embeddable media URL straight from Reddit's own CDN
 * (v.redd.it / preview.redd.it) — never downloaded or re-hosted by us, the
 * same as hotlinking any other embed. Falls back through native video →
 * full-size preview image → direct image link → low-res thumbnail → none,
 * in that order of embed quality.
 */
export function extractMedia(post: RedditPost): { mediaUrl: string | null; mediaType: "IMAGE" | "VIDEO" | null } {
  const videoUrl = post.media?.reddit_video?.fallback_url;
  if (post.is_video && videoUrl) {
    return { mediaUrl: unescapeUrl(videoUrl), mediaType: "VIDEO" };
  }

  const previewImage = post.preview?.images?.[0]?.source?.url;
  if (previewImage) {
    return { mediaUrl: unescapeUrl(previewImage), mediaType: "IMAGE" };
  }

  if (post.post_hint === "image" && post.url_overridden_by_dest) {
    return { mediaUrl: post.url_overridden_by_dest, mediaType: "IMAGE" };
  }

  const thumbnail = post.thumbnail && !INVALID_THUMBNAILS.has(post.thumbnail) ? post.thumbnail : null;
  if (thumbnail) {
    return { mediaUrl: thumbnail, mediaType: "IMAGE" };
  }

  return { mediaUrl: null, mediaType: null };
}

function buildQueries(event: SocialSearchEvent): string[] {
  const homeAlias = aliasesFor(event.homeTeamName)[0];
  const awayAlias = aliasesFor(event.awayTeamName)[0];
  const eventWord = EVENT_TYPE_WORDS[event.eventType];

  const queries = new Set<string>();

  if (eventWord) {
    queries.add(`${homeAlias} ${awayAlias} ${eventWord}`);
  }
  if (event.playerName) {
    queries.add(`${event.playerName} ${event.minute}`);
    if (eventWord) queries.add(`${event.playerName} ${eventWord}`);
  }

  // cost control: cap the number of searches fired per event
  return Array.from(queries).slice(0, 3);
}

function toCandidate(post: RedditPost): SocialCandidate {
  const { mediaUrl, mediaType } = extractMedia(post);
  return {
    externalId: post.id,
    title: post.title,
    body: post.selftext || null,
    author: post.author,
    url: `https://www.reddit.com${post.permalink}`,
    mediaUrl,
    mediaType,
    createdAt: new Date(post.created_utc * 1000),
  };
}

export const redditProvider: SocialProvider = {
  name: "reddit",
  async searchForEvent(event: SocialSearchEvent): Promise<SocialCandidate[]> {
    const queries = buildQueries(event);
    if (queries.length === 0) return [];

    const results = await Promise.all(queries.map((q) => searchSubreddit(SUBREDDIT, q)));

    const seen = new Map<string, SocialCandidate>();
    for (const posts of results) {
      for (const post of posts) {
        if (!seen.has(post.id)) seen.set(post.id, toCandidate(post));
      }
    }

    logger.info("reddit_search_completed", {
      queries: queries.length,
      candidates: seen.size,
    });

    return Array.from(seen.values());
  },
};
