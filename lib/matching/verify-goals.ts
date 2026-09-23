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
  /** Additional posts for the *same* goal — mirrors / alternate angles. Not phantom goals. */
  extraClips: ClipInput[];
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

/** Every significant (length > 1) normalized token in a name, as a set — order-independent. */
function nameTokenSet(name: string | null): Set<string> {
  if (!name) return new Set();
  return new Set(normalizeText(name).split(/\s+/).filter((t) => t.length > 1));
}

/** True when two token sets contain exactly the same elements (ignoring order). */
function sameTokenSet(a: Set<string>, b: Set<string>): boolean {
  if (a.size === 0 || a.size !== b.size) return false;
  for (const t of a) if (!b.has(t)) return false;
  return true;
}

function sameScorer(a: string | null, b: string | null): boolean {
  const sa = surname(a);
  const sb = surname(b);
  if (sa && sb && (sa === sb || sa.includes(sb) || sb.includes(sa))) return true;
  // Fallback for a name ESPN stores family-name-first (the Korean/East
  // Asian convention) when a real Reddit title uses the Western given-
  // name-first order instead — confirmed live: ESPN has "Lee Kang-In" for
  // Atletico Madrid's second goal against Osasuna, but the real post is
  // "Atletico Madrid [2]-0 Osasuna - Kang-in Lee 54'". Taking the LAST
  // token as "the surname" picks the wrong fragment on whichever side is
  // reversed — "in" instead of "lee" — so no ordering-dependent heuristic
  // can get both right at once. Instead, accept an exact match of the
  // *full set* of name tokens regardless of order — deliberately not just
  // "any shared token", which would risk matching two different players
  // who happen to share one name part (e.g. two different "Kane"s).
  return sameTokenSet(nameTokenSet(a), nameTokenSet(b));
}

function minuteOf(g: { minute: number; extraMinute: number | null }): number {
  return g.minute + (g.extraMinute ?? 0);
}

function hasMinute(p: ParsedGoalClipTitle): p is ParsedGoalClipTitle & { minute: number } {
  return p.minute !== null;
}

/** True when two clips' minutes are within a minute of each other — always false when either side has no minute at all (the rare title that omits one entirely; see parseGoalClipTitle's minute doc comment). A minute-less clip is matched separately, by surname alone, in the fallback pass below — never treated as "close enough" here. */
function minutesClose(a: ParsedGoalClipTitle, b: { minute: number; extraMinute: number | null }): boolean {
  return hasMinute(a) && Math.abs(minuteOf(a) - minuteOf(b)) <= 1;
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
      return scorerOk && minutesClose(parsed, espn);
    });

    if (!hit) {
      // Is there a clip near this minute whose scorer disagrees? That's a mismatch, not just a gap.
      const nearMiss = parsedClips.find(
        ({ clip, parsed }) => !usedClipIds.has(clip.postId) && parsed && minutesClose(parsed, espn)
      );
      if (nearMiss?.parsed) {
        usedClipIds.add(nearMiss.clip.postId);
        const msg = `${espn.minute}' ESPN scorer "${espn.scorer}" vs Reddit "${nearMiss.parsed.playerName}"`;
        discrepancies.push(msg);
        notes.push(msg);
        return { espn, clip: nearMiss.clip, clipParsed: nearMiss.parsed, extraClips: [], status: "clip-mismatch", notes };
      }
      notes.push(`no Goal Clip post found for ${espn.minute}' ${espn.scorer ?? "goal"}`);
      return { espn, clip: null, clipParsed: null, extraClips: [], status: "clip-missing", notes };
    }

    usedClipIds.add(hit.clip.postId);
    if (hit.parsed && hasMinute(hit.parsed) && minuteOf(hit.parsed) !== minuteOf(espn)) {
      notes.push(`minute off by one: ESPN ${espn.minute}', Reddit ${hit.parsed.minute}'`);
    }
    if (hit.parsed?.isPenalty && espn.type !== "PENALTY_GOAL") {
      notes.push("Reddit flags penalty, ESPN does not");
    }
    return { espn, clip: hit.clip, clipParsed: hit.parsed, extraClips: [], status: "verified", notes };
  });

  // Fallback pass: a real post can omit the minute entirely — confirmed
  // live ("Atleti 2 - [1] Real Madrid -  Toni Rudiger" has no minute
  // marker at all, not a parsing failure on our end). minutesClose() never
  // matches a minute-less clip, by design, so it never fills a gap in the
  // main pass above; this runs once more afterward, matching by scorer
  // surname alone, only for goals still missing a clip. Deliberately
  // narrower than the main pass (no fallback for a mismatch, no minute
  // cross-check) since surname is the only signal available.
  for (const gv of goals) {
    if (gv.status !== "clip-missing") continue;
    const fallbackHit = parsedClips.find(
      ({ clip, parsed }) => !usedClipIds.has(clip.postId) && parsed && !hasMinute(parsed) && sameScorer(parsed.playerName, gv.espn.scorer)
    );
    if (!fallbackHit?.parsed) continue;
    usedClipIds.add(fallbackHit.clip.postId);
    gv.clip = fallbackHit.clip;
    gv.clipParsed = fallbackHit.parsed;
    gv.status = "verified";
    gv.notes = [`matched by scorer only — Reddit title has no minute ("${fallbackHit.clip.title}")`];
  }

  // Second pass: an as-yet-unused clip whose scorer + minute still line up
  // with a goal we already matched is a mirror / alternate angle of that
  // goal — attach it there. Only a clip that fits NO goal is a phantom.
  for (const { clip, parsed } of parsedClips) {
    if (usedClipIds.has(clip.postId) || !parsed) continue;
    const gv = goals.find(
      (g) => g.status === "verified" && sameScorer(parsed.playerName, g.espn.scorer) && minutesClose(parsed, g.espn)
    );
    if (gv) {
      usedClipIds.add(clip.postId);
      gv.extraClips.push(clip);
    }
  }

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
