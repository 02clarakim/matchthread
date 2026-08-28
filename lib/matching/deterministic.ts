import type { MatchableCandidate, MatchableEvent } from "./types";
import { aliasesFor } from "./team-aliases";
import { normalizeText } from "./text";

const WINDOW_BEFORE_MS = 60 * 60 * 1000; // 1h before the event
const WINDOW_AFTER_MS = 4 * 60 * 60 * 1000; // 4h after (live threads run long)

function candidateText(candidate: MatchableCandidate): string {
  return `${candidate.title} ${candidate.body ?? ""}`;
}

function mentionsAnyAlias(text: string, teamName: string): boolean {
  const normalized = normalizeText(text);
  return aliasesFor(teamName).some((alias) => normalized.includes(normalizeText(alias)));
}

function mentionsPlayer(text: string, playerName: string | null): boolean {
  if (!playerName) return false;
  const normalized = normalizeText(text);
  const lastName = playerName.trim().split(/\s+/).pop() ?? playerName;
  return normalized.includes(normalizeText(lastName));
}

/**
 * Stage 1: cheap, deterministic narrowing before any similarity scoring or
 * AI runs. A candidate only survives if it plausibly refers to *this*
 * match at all — either team is mentioned, or the player involved is
 * mentioned — and was posted in a reasonable window around the event.
 * This is what keeps the expensive stages (fuzzy scoring, and especially
 * the LLM call) from ever seeing the full unfiltered post firehose.
 */
export function deterministicFilter(
  event: MatchableEvent,
  candidates: MatchableCandidate[]
): MatchableCandidate[] {
  return candidates.filter((candidate) => {
    const text = candidateText(candidate);

    const teamMentioned =
      mentionsAnyAlias(text, event.homeTeamName) || mentionsAnyAlias(text, event.awayTeamName);
    const playerMentioned = mentionsPlayer(text, event.playerName);

    if (!teamMentioned && !playerMentioned) return false;

    const delta = candidate.createdAt.getTime() - event.timestamp.getTime();
    if (delta < -WINDOW_BEFORE_MS || delta > WINDOW_AFTER_MS) return false;

    return true;
  });
}

/** Exposed for the fuzzy stage — avoids recomputing alias/player containment logic. */
export function exactPlayerAndTeamHit(event: MatchableEvent, candidate: MatchableCandidate): boolean {
  const text = candidateText(candidate);
  const playerHit = mentionsPlayer(text, event.playerName);
  const eventTeam = event.eventTeamName;
  const teamHit = eventTeam ? mentionsAnyAlias(text, eventTeam) : false;
  return playerHit && teamHit;
}
