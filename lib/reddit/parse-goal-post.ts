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

const MINUTE_PATTERN = /(\d{1,3})\s*(?:['’]|min\b)/i;

export function extractMinute(title: string): number | null {
  const match = title.match(MINUTE_PATTERN);
  if (!match) return null;
  const minute = Number(match[1]);
  return minute >= 1 && minute <= 130 ? minute : null;
}

/**
 * Takes the leading text before the first minute marker / common
 * delimiter as a best-effort player name, e.g.:
 *   "[Goal Clip] Antoine Griezmann 23'" -> "Antoine Griezmann"
 *   "Julián Álvarez 65' | Atletico Madrid 1-0 Sevilla" -> "Julián Álvarez"
 * Returns null rather than a low-confidence guess when the leading text
 * doesn't look like a plausible name.
 */
export function extractPlayerName(title: string): string | null {
  const withoutFlairTag = title.replace(/^\[[^\]]*\]\s*/, "").trim();
  const cutMatch = withoutFlairTag.match(/^(.*?)(?:\s*\d{1,3}\s*(?:['’]|min\b)|\s*[|:(]|\s+-\s+)/i);
  const candidate = (cutMatch ? cutMatch[1] : withoutFlairTag).trim();

  if (!candidate || candidate.length < 2 || candidate.length > 40) return null;
  if (/\bvs\.?\b/i.test(candidate)) return null;

  return candidate;
}

export type ScoringSide = "home" | "away" | null;

export interface KnownScore {
  homeScore: number | null;
  awayScore: number | null;
}

const SCORE_PATTERN = /(\d{1,2})\s*[-–]\s*(\d{1,2})/;

/**
 * Determines which team a goal/card belongs to from the post title.
 * Two strategies, in order:
 *
 * 1. Alias matching — if only one team's name/nickname appears, use it.
 *    Fails on the *most common* real title format, though, which names
 *    both teams alongside the current score (e.g. "Julián Álvarez 65' |
 *    Atletico Madrid 1-0 Sevilla").
 * 2. Score-delta matching — parse an "X-Y" score out of the title, work
 *    out which side of it belongs to which team (whichever team name
 *    appears before the score in the text), and compare against the
 *    match's currently known score: whichever side's number went up is
 *    the scorer. Same idea as the score-diff fallback in
 *    workers/sports-poller.ts for providers that don't give per-event data.
 *
 * Returns null — never a guess — when neither strategy resolves it, since
 * an auto-detected goal wrongly credited to a team would also mis-increment
 * the scoreboard.
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
