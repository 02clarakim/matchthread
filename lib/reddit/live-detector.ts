import { searchSubreddit, type RedditPost } from "./client";
import { aliasesFor } from "../matching/team-aliases";

const SUBREDDIT = "soccer";

/**
 * r/soccer flairs goal-clip posts distinctly from discussion, which makes
 * them a much higher-precision live-goal signal than generic keyword
 * search — someone posting under this flair is asserting "this is a video
 * of a goal that just happened," not just talking about the match.
 *
 * The exact flair string can't be verified from this environment (Reddit
 * is unreachable here — see README § Reddit-Sourced Live Detection), so
 * this is the human-readable text without the emoji shortcode Reddit's UI
 * shows alongside it. If moderators rename it, findGoalClipPosts() still
 * works via its keyword fallback below.
 */
const GOAL_CLIP_FLAIR = "Goal Clip";

/**
 * Finds candidate goal posts for a match, trying the high-precision
 * flair-filtered search first. Falls back to a plain keyword search if
 * that returns nothing — either because this specific goal hasn't been
 * clipped yet, or the flair text doesn't match what's configured above.
 */
export async function findGoalClipPosts(homeTeamName: string, awayTeamName: string): Promise<RedditPost[]> {
  const homeAlias = aliasesFor(homeTeamName)[0];
  const awayAlias = aliasesFor(awayTeamName)[0];

  const flairQuery = `flair_name:"${GOAL_CLIP_FLAIR}" ${homeAlias} ${awayAlias}`;
  const flairResults = await searchSubreddit(SUBREDDIT, flairQuery, 10);
  if (flairResults.length > 0) return flairResults;

  const keywordResults = await searchSubreddit(SUBREDDIT, `${homeAlias} ${awayAlias} goal`, 10);
  return keywordResults;
}

/**
 * Red cards don't have a dedicated flair the way goal clips do, so this is
 * keyword search only — lower precision than findGoalClipPosts, and more
 * likely to occasionally miss a red card or match a false positive (e.g.
 * a post discussing a red card from a *different* match involving one of
 * these teams). Still far better than nothing for a "would be nice" signal.
 */
export async function findRedCardPosts(homeTeamName: string, awayTeamName: string): Promise<RedditPost[]> {
  const homeAlias = aliasesFor(homeTeamName)[0];
  const awayAlias = aliasesFor(awayTeamName)[0];
  return searchSubreddit(SUBREDDIT, `${homeAlias} ${awayAlias} red card`, 10);
}
