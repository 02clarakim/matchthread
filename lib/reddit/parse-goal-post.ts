import { aliasesFor } from "../matching/team-aliases";
import { normalizeText } from "../matching/text";

/**
 * Best-effort extraction of structured data from a Reddit post title. This
 * is fundamentally a heuristic, not an authoritative source — titles are
 * free text written by humans, not a structured API field. When extraction
 * fails or is ambiguous, callers should prefer omitting the field (null)
 * over guessing wrong, especially for scoring-team attribution, which
 * would otherwise risk incrementing the wrong side's score.
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

/** A minute marker: `84'`, `90+5'`, or the `90'+7'` variant (apostrophe before the plus). */
const MINUTE_PATTERN = /(\d{1,3})(?:['’‘]?\s*\+\s*\d{1,2})?\s*(?:['’‘]|min\b)/i;

/** Non-name tokens r/soccer appends inside the scorer slot: `Penalty`, `OG` / `own goal`. */
const SCORER_ANNOTATION_PATTERN = /\b(?:penalty|pen\.?|o\.?g\.?|own[ -]goal)\b/gi;

export function extractMinute(title: string): number | null {
  const match = cleanTitle(title).match(MINUTE_PATTERN);
  if (!match) return null;
  const minute = Number(match[1]);
  return minute >= 1 && minute <= 130 ? minute : null;
}

/**
 * Best-effort player name for titles that don't match the structured
 * "Goal Clip" convention parseGoalClipTitle() targets. r/soccer's
 * convention puts the scorer between the score line and the minute
 * (`Team X-Y Team - Player 87'`), so this takes the text after the *last*
 * " - " and before the minute marker — not the leading text, which is the
 * score line. Falls back to leading text for the older `Player 23'` shape.
 */
export function extractPlayerName(title: string): string | null {
  const cleaned = cleanTitle(title)
    .replace(/^\[[^\]]*\]\s*/, "")
    .replace(/\s*\([^)]*\)\s*$/, "")
    .trim();

  const minuteMatch = cleaned.match(MINUTE_PATTERN);
  const beforeMinute = (minuteMatch ? cleaned.slice(0, minuteMatch.index) : cleaned).trim();

  const lastDash = beforeMinute.lastIndexOf(" - ");
  let candidate = (lastDash === -1 ? beforeMinute : beforeMinute.slice(lastDash + 3)).trim();
  candidate = candidate.replace(SCORER_ANNOTATION_PATTERN, "").replace(/\s{2,}/g, " ").trim();

  if (!candidate || candidate.length < 2 || candidate.length > 40) return null;
  if (/\bvs\.?\b/i.test(candidate)) return null;
  if (/\d/.test(candidate)) return null; // still carrying a score fragment — not a clean name

  return candidate;
}

export type ScoringSide = "home" | "away" | null;

export interface KnownScore {
  homeScore: number | null;
  awayScore: number | null;
}

const SCORE_PATTERN = /(\d{1,2})\s*[-–]\s*(\d{1,2})/;

/**
 * Generic fallback for titles that don't match the structured "Goal Clip"
 * convention. Two strategies, in order:
 *
 * 1. Alias matching — if only one team's name/nickname appears, use it.
 * 2. Score-delta matching — parse an "X-Y" score out of the title, work
 *    out which side of it belongs to which team (whichever team name
 *    appears before the score in the text), and compare against the
 *    match's currently known score: whichever side's number went up is
 *    the scorer. Same idea as the score-diff fallback in
 *    workers/sports-poller.ts for providers that don't give per-event data.
 *
 * Returns null — never a guess — when neither strategy resolves it.
 */
export function detectScoringSide(
  title: string,
  homeTeamName: string,
  awayTeamName: string,
  knownScore?: KnownScore
): ScoringSide {
  const normalized = normalizeText(title);
  const homeAliases = aliasesFor(homeTeamName).map(normalizeText);
  const awayAliases = aliasesFor(awayTeamName).map(normalizeText);
  const homeHit = homeAliases.some((alias) => normalized.includes(alias));
  const awayHit = awayAliases.some((alias) => normalized.includes(alias));

  if (homeHit && !awayHit) return "home";
  if (awayHit && !homeHit) return "away";

  if (homeHit && awayHit && knownScore) {
    const scoreMatch = title.match(SCORE_PATTERN);
    if (scoreMatch) {
      const first = Number(scoreMatch[1]);
      const second = Number(scoreMatch[2]);
      const textBeforeScore = normalizeText(title.slice(0, scoreMatch.index ?? 0));
      const homeNamedFirst = homeAliases.some((alias) => textBeforeScore.includes(alias));

      const homeNewScore = homeNamedFirst ? first : second;
      const awayNewScore = homeNamedFirst ? second : first;

      if (knownScore.homeScore !== null && homeNewScore > knownScore.homeScore) return "home";
      if (knownScore.awayScore !== null && awayNewScore > knownScore.awayScore) return "away";
    }
  }

  return null;
}

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
 * unambiguous signal for who just scored, which is far more reliable than
 * guessing from a score delta against our own DB state (detectScoringSide
 * below, kept as the fallback for titles that don't follow this format —
 * like the fourth example above, which has no brackets at all).
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

function textMatchesTeam(text: string, teamName: string): boolean {
  const normalized = normalizeText(text);
  return aliasesFor(teamName).some((alias) => {
    const normalizedAlias = normalizeText(alias);
    return normalizedAlias === normalized || normalized.includes(normalizedAlias) || normalizedAlias.includes(normalized);
  });
}

/** Maps a team name as written in a Reddit title (which may abbreviate/alias) onto our tracked match's home/away designation. */
function resolveTeamSide(teamText: string, homeTeamName: string, awayTeamName: string): ScoringSide {
  const homeHit = textMatchesTeam(teamText, homeTeamName);
  const awayHit = textMatchesTeam(teamText, awayTeamName);
  if (homeHit && !awayHit) return "home";
  if (awayHit && !homeHit) return "away";
  return null;
}

export interface ResolvedGoalEvent {
  side: "home" | "away";
  playerName: string | null;
  minute: number | null;
  extraMinute: number | null;
  isPenalty: boolean;
  isOwnGoal: boolean;
}

/**
 * The single entry point workers/reddit-live-poller.ts uses for goal
 * posts: tries the structured "Goal Clip" bracket convention first (high
 * confidence, gets minute/extraMinute/player/penalty all at once), and
 * falls back to the generic heuristics above for titles that don't match
 * it. Returns null — never a guess — when neither resolves a scoring side.
 */
export function resolveGoalEvent(
  rawTitle: string,
  homeTeamName: string,
  awayTeamName: string,
  knownScore?: KnownScore
): ResolvedGoalEvent | null {
  const structured = parseGoalClipTitle(rawTitle);

  if (structured?.scoringSide) {
    const scoringTeamText = structured.scoringSide === "home" ? structured.homeTeamText : structured.awayTeamText;
    const side = resolveTeamSide(scoringTeamText, homeTeamName, awayTeamName);
    if (side) {
      return {
        side,
        playerName: structured.playerName,
        minute: structured.minute,
        extraMinute: structured.extraMinute,
        isPenalty: structured.isPenalty,
        isOwnGoal: structured.isOwnGoal,
      };
    }
  }

  const side = detectScoringSide(rawTitle, homeTeamName, awayTeamName, knownScore);
  if (!side) return null;

  return {
    side,
    playerName: extractPlayerName(rawTitle),
    minute: extractMinute(rawTitle),
    extraMinute: null,
    isPenalty: false,
    isOwnGoal: false,
  };
}
