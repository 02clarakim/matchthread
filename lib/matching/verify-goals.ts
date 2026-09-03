import { parseGoalClipTitle, type ParsedGoalClipTitle } from "../reddit/parse-goal-post";
import { normalizeText } from "./text";
import { aliasesFor } from "./team-aliases";
import type { EspnGoal } from "../sports/espn";

/**
 * The "verifying" layer. r/soccer Goal Clip titles give us a scorer, a
 * minute and a bracketed scoreline; ESPN's match summary gives us the same
 * facts from an independent, editorially-maintained source. This module
 * cross-checks the two so the backfill can (a) attach each clip to the
 * right goal and (b) refuse to publish a match whose Reddit data
 * contradicts ESPN — a wrong scorer or a phantom goal is worse than a
 * missing clip.
 *
 * ESPN is treated as the source of truth for score/scorer/minute; the
 * Reddit clip only ever contributes the video.
 */

export interface ClipInput {
  postId: string;
  title: string;
  permalink: string;
  author: string | null;
  createdAt: string;
  sourceUrl: string;
  sourceHost: string;
}

export interface GoalVerification {
  espn: EspnGoal;
  clip: ClipInput | null;
  clipParsed: ParsedGoalClipTitle | null;
  status: "verified" | "clip-missing" | "clip-mismatch";
  notes: string[];
}

export interface VerifyResult {
  /** ESPN final score agrees with the highest bracketed scoreline any clip asserts. */
  scoreConsistent: boolean;
  /** Every ESPN goal has a matched clip. */
  allGoalsHaveClip: boolean;
  /** Safe to publish: no contradictions (mismatched scorer/minute, or a clip for a goal ESPN doesn't list). */
  verified: boolean;
  goals: GoalVerification[];
  /** Clips that matched no ESPN goal — Reddit asserting something ESPN doesn't. A hard failure. */
  orphanClips: ClipInput[];
  discrepancies: string[];
}

function textIsTeam(text: string, teamName: string): boolean {
  const t = normalizeText(text);
  return aliasesFor(teamName).some((alias) => {
    const a = normalizeText(alias);
    return a === t || t.includes(a) || a.includes(t);
  });
}

/**
 * From a flat pool of Goal Clip posts (e.g. a whole matchday snapshot),
 * the ones whose title names *these two* teams — in either order. Used by
 * the backfill to hand verifyGoals only the clips for the match at hand.
 */
export function clipsForMatch<T extends { title: string }>(clips: T[], homeTeamName: string, awayTeamName: string): T[] {
  return clips.filter((clip) => {
    const parsed = parseGoalClipTitle(clip.title);
    if (!parsed) return false;
    const { homeTeamText: h, awayTeamText: a } = parsed;
    return (
      (textIsTeam(h, homeTeamName) && textIsTeam(a, awayTeamName)) ||
      (textIsTeam(h, awayTeamName) && textIsTeam(a, homeTeamName))
    );
  });
}

/** Last whitespace-delimited token of a normalized name — "Yoane Wissa" -> "wissa", "B. Saka" -> "saka". */
function surname(name: string | null): string {
  if (!name) return "";
  const tokens = normalizeText(name).split(/\s+/).filter((t) => t.length > 1);
  return tokens[tokens.length - 1] ?? "";
}

function sameScorer(a: string | null, b: string | null): boolean {
  const sa = surname(a);
  const sb = surname(b);
  if (!sa || !sb) return false;
  return sa === sb || sa.includes(sb) || sb.includes(sa);
}

function minuteOf(g: { minute: number; extraMinute: number | null }): number {
  return g.minute + (g.extraMinute ?? 0);
}

export function verifyGoals(espnGoals: EspnGoal[], clips: ClipInput[]): VerifyResult {
  const parsedClips = clips.map((clip) => ({ clip, parsed: parseGoalClipTitle(clip.title) }));
  const usedClipIds = new Set<string>();
  const discrepancies: string[] = [];

  const goals: GoalVerification[] = espnGoals.map((espn) => {
    const notes: string[] = [];

    // A clip matches an ESPN goal on scorer surname + minute within one
    // (Reddit titles and ESPN occasionally differ by a minute on the same goal).
    const hit = parsedClips.find(({ clip, parsed }) => {
      if (usedClipIds.has(clip.postId) || !parsed) return false;
      const scorerOk = sameScorer(parsed.playerName, espn.scorer);
      const minuteOk = Math.abs(minuteOf(parsed) - minuteOf(espn)) <= 1;
      return scorerOk && minuteOk;
    });

    if (!hit) {
      // Is there a clip near this minute whose scorer disagrees? That's a mismatch, not just a gap.
      const nearMiss = parsedClips.find(
        ({ clip, parsed }) =>
          !usedClipIds.has(clip.postId) && parsed && Math.abs(minuteOf(parsed) - minuteOf(espn)) <= 1
      );
      if (nearMiss?.parsed) {
        usedClipIds.add(nearMiss.clip.postId);
        const msg = `${espn.minute}' ESPN scorer "${espn.scorer}" vs Reddit "${nearMiss.parsed.playerName}"`;
        discrepancies.push(msg);
        notes.push(msg);
        return { espn, clip: nearMiss.clip, clipParsed: nearMiss.parsed, status: "clip-mismatch", notes };
      }
      notes.push(`no Goal Clip post found for ${espn.minute}' ${espn.scorer ?? "goal"}`);
      return { espn, clip: null, clipParsed: null, status: "clip-missing", notes };
    }

    usedClipIds.add(hit.clip.postId);
    if (hit.parsed && minuteOf(hit.parsed) !== minuteOf(espn)) {
      notes.push(`minute off by one: ESPN ${espn.minute}', Reddit ${hit.parsed.minute}'`);
    }
    if (hit.parsed?.isPenalty && espn.type !== "PENALTY_GOAL") {
      notes.push("Reddit flags penalty, ESPN does not");
    }
    return { espn, clip: hit.clip, clipParsed: hit.parsed, status: "verified", notes };
  });

  const orphanClips = parsedClips
    .filter(({ clip }) => !usedClipIds.has(clip.postId))
    .map(({ clip, parsed }) => {
      discrepancies.push(
        `Reddit clip "${clip.title}" (${parsed?.playerName ?? "?"} ${parsed?.minute ?? "?"}') matches no ESPN goal`
      );
      return clip;
    });

  // Highest bracketed scoreline any clip asserts, e.g. "0-[2]" -> 2 goals total.
  // A clip merely being missing makes this LOWER than ESPN's count — that's a
  // gap (allGoalsHaveClip), not a contradiction. Only Reddit claiming MORE
  // goals than ESPN is inconsistent.
  const clipMaxTotal = parsedClips.reduce((max, { parsed }) => {
    if (!parsed) return max;
    return Math.max(max, parsed.homeScore + parsed.awayScore);
  }, 0);
  const espnTotal = espnGoals.length;
  const scoreConsistent = clipMaxTotal <= espnTotal;
  if (!scoreConsistent) {
    discrepancies.push(`goal count: ESPN lists ${espnTotal}, a Reddit scoreline implies at least ${clipMaxTotal}`);
  }

  const hasMismatch = goals.some((g) => g.status === "clip-mismatch");
  const verified = scoreConsistent && !hasMismatch && orphanClips.length === 0;

  return {
    scoreConsistent,
    allGoalsHaveClip: goals.every((g) => g.status === "verified"),
    verified,
    goals,
    orphanClips,
    discrepancies,
  };
}
