import { searchSubreddit, type RedditPost } from "./client";
import { aliasesFor } from "../matching/team-aliases";

const SUBREDDIT = "soccer";

/**
 * r/soccer flairs goal-clip posts distinctly from discussion, which makes
 * them a much higher-precision live-goal signal than generic keyword
 * search — someone posting under this flair is asserting "this is a video
 * of a goal that just happened," not just talking about the match.
 *
 * The flair's indexed name includes the `:n_goal:` emoji shortcode that
 * renders as an icon in Reddit's UI — `flair_name:"Goal Clip"` alone
 * returns nothing. Confirmed 2026-09-02 against a live r/soccer search:
 * `flair_name:":n_goal: Goal Clip"` returns real goal-clip posts;
 * `flair_name:"Goal Clip"` returns zero.
 */
const GOAL_CLIP_FLAIR = ":n_goal: Goal Clip";

/**
 * Finds candidate goal posts for a match, from most to least precise:
 *
 *   1. Exact `flair_name:` match on the shortcode-prefixed flair above.
 *   2. The lenient `flair:` operator on just the words "Goal Clip" —
 *      tolerant of the shortcode being renamed, still flair-scoped.
 *   3. A plain keyword search — last resort, lowest precision.
 *
 * Each tier only runs if the one before it returned nothing.
 */
export async function findGoalClipPosts(homeTeamName: string, awayTeamName: string): Promise<RedditPost[]> {
  const homeAlias = aliasesFor(homeTeamName)[0];
  const awayAlias = aliasesFor(awayTeamName)[0];

  const exactFlairResults = await searchSubreddit(
    SUBREDDIT,
    `flair_name:"${GOAL_CLIP_FLAIR}" ${homeAlias} ${awayAlias}`,
    10
  );
  if (exactFlairResults.length > 0) return exactFlairResults;

  const lenientFlairResults = await searchSubreddit(
    SUBREDDIT,
    `flair:"Goal Clip" ${homeAlias} ${awayAlias}`,
    10
  );
  if (lenientFlairResults.length > 0) return lenientFlairResults;

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
