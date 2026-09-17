/**
 * Best-effort extraction of structured data from a Reddit post title. This
 * is fundamentally a heuristic, not an authoritative source — titles are
 * free text written by humans, not a structured API field. When extraction
 * fails or is ambiguous, callers should prefer omitting the field (null)
 * over guessing wrong, especially for scoring-team attribution.
 *
 * This file used to also carry a generic "no structured convention" fallback
 * (minute/player extraction by position, alias + score-delta side detection)
 * for `workers/reddit-live-poller.ts`, which had to make a best guess on any
 * r/soccer post since Reddit *was* the live-detection source. That worker is
 * gone — ESPN is the sole live-detection source now (see
 * lib/sports/espn.ts), and Reddit's only remaining job is supplying a clip
 * for a goal ESPN already confirmed, cross-checked against ESPN's own goal
 * list (lib/matching/verify-goals.ts) rather than guessed from the title
 * alone. So only the structured "Goal Clip" convention parser below
 * survives; the generic fallback was removed as dead code along with its
 * only caller.
 */

/**
 * Zero-width/bidi marks that show up in some Reddit titles (observed around
 * minute apostrophes) and break naive regexes, plus aggregate-score
 * annotations like `[4-1 on agg.]` that r/soccer appends on cup ties — those
 * carry a hyphenated "X-Y" that isn't the live score line, so strip them
 * before any score/team parsing runs.
 */
function cleanTitle(title: string): string {
  return title
    .replace(/[​-‏‪-‮﻿]/g, "")
    .replace(/\s*\[[^\]]*\bagg\b[^\]]*\]/gi, "")
    .trim();
}

/** Non-name tokens r/soccer appends inside the scorer slot: `Penalty`, `OG` / `own goal`. */
const SCORER_ANNOTATION_PATTERN = /\b(?:penalty|pen\.?|o\.?g\.?|own[ -]goal)\b/gi;

export type ScoringSide = "home" | "away" | null;

// ---------------------------------------------------------------------------
// r/soccer "Goal Clip" structured title parser
// ---------------------------------------------------------------------------

/**
 * r/soccer's Goal Clip flair follows a consistent community convention —
 * confirmed against real examples, not assumed:
 *
 *   Lille 2-[2] Paris Saint-Germain - Marquinhos 90+5'
 *   Crystal Palace 1 - [4] Manchester City - Erling Haaland 84'
 *   Bayern [5] - 1 Stuttgart - Luis Diaz 93' (Amazing pass from Saibari)
 *   Tijuana 2-0 Pumas - Gilberto Mora Penalty 81'
 *
 * The scoring team's number is wrapped in `[brackets]` — an explicit,
 * unambiguous signal for who just scored. A title that doesn't follow this
 * format (like the fourth example above, which has no brackets at all)
 * returns `scoringSide: null`; the caller (`lib/matching/verify-goals.ts`)
 * cross-checks against ESPN's own goal list rather than guessing further.
 */
export interface ParsedGoalClipTitle {
  homeTeamText: string;
  awayTeamText: string;
  homeScore: number;
  awayScore: number;
  /** null when neither/both score numbers are bracketed — caller should fall back. */
  scoringSide: ScoringSide;
  playerName: string | null;
  minute: number;
  extraMinute: number | null;
  isPenalty: boolean;
  isOwnGoal: boolean;
}

const SCORE_LINE_PATTERN = /^(.+?)\s+(\[?)(\d{1,2})(\]?)\s*-\s*(\[?)(\d{1,2})(\]?)\s+(.+)$/;
// `90+5'` and the `90'+7'` variant (apostrophe before the plus) both parse to minute 90, extra 5/7.
const MINUTE_MARKER_PATTERN = /(\d{1,3})(?:['’‘]?\s*\+\s*(\d{1,2}))?\s*['’‘]/g;

export function parseGoalClipTitle(rawTitle: string): ParsedGoalClipTitle | null {
  const title = cleanTitle(rawTitle);
  const withoutTrailingParen = title.replace(/\s*\([^)]*\)\s*$/, "").trim();

  // search (not a single match) — the minute marker is usually the last
  // one in the title, and a global search is more robust than anchoring
  // to the string end given trailing punctuation/whitespace variance.
  const minuteMatches = [...withoutTrailingParen.matchAll(MINUTE_MARKER_PATTERN)];
  const lastMinuteMatch = minuteMatches[minuteMatches.length - 1];
  if (!lastMinuteMatch || lastMinuteMatch.index === undefined) return null;

  const minute = Number(lastMinuteMatch[1]);
  const extraMinute = lastMinuteMatch[2] ? Number(lastMinuteMatch[2]) : null;
  if (minute < 1 || minute > 130) return null;

  const beforeMinute = withoutTrailingParen.slice(0, lastMinuteMatch.index).trim();

  const lastDashIndex = beforeMinute.lastIndexOf(" - ");
  if (lastDashIndex === -1) return null;

  const scoreLine = beforeMinute.slice(0, lastDashIndex).trim();
  let playerSection = beforeMinute.slice(lastDashIndex + 3).trim();

  const isPenalty = /\b(?:penalty|pen\.?)\b/i.test(playerSection);
  const isOwnGoal = /\b(?:o\.?g\.?|own[ -]goal)\b/i.test(playerSection);
  playerSection = playerSection.replace(SCORER_ANNOTATION_PATTERN, "").replace(/\s{2,}/g, " ").trim();
  const playerName = playerSection.length >= 2 && playerSection.length <= 40 ? playerSection : null;

  const scoreMatch = scoreLine.match(SCORE_LINE_PATTERN);
  if (!scoreMatch) return null;

  const [, homeTeamText, homeOpen, homeScoreStr, homeClose, awayOpen, awayScoreStr, awayClose, awayTeamText] =
    scoreMatch;
  const homeBracketed = homeOpen === "[" && homeClose === "]";
  const awayBracketed = awayOpen === "[" && awayClose === "]";

  let scoringSide: ScoringSide = null;
  if (homeBracketed && !awayBracketed) scoringSide = "home";
  else if (awayBracketed && !homeBracketed) scoringSide = "away";

  return {
    homeTeamText: homeTeamText.trim(),
    awayTeamText: awayTeamText.trim(),
    homeScore: Number(homeScoreStr),
    awayScore: Number(awayScoreStr),
    scoringSide,
    playerName,
    minute,
    extraMinute,
    isPenalty,
    isOwnGoal,
  };
}

