import type { MatchableCandidate, MatchableEvent, ComponentScores } from "./types";
import { aliasesFor } from "./team-aliases";
import { editDistance, normalizeText, tokenize } from "./text";

const EVENT_TYPE_KEYWORDS: Partial<Record<MatchableEvent["type"], string[]>> = {
  GOAL: ["goal", "scores", "score", "nets", "finish", "strike", "screamer", "curls", "slots"],
  PENALTY_GOAL: ["penalty", "spot", "goal"],
  PENALTY_MISSED: ["penalty", "miss", "saved"],
  OWN_GOAL: ["own goal", "og"],
  YELLOW_CARD: ["yellow", "booked", "booking"],
  SECOND_YELLOW_CARD: ["second yellow", "red card", "sent off"],
  RED_CARD: ["red card", "sent off", "off"],
  SUBSTITUTION: ["sub", "substitution", "replaces", "comes on"],
  VAR_DECISION: ["var", "review", "overturned", "disallowed", "ruled out"],
};

function candidateText(candidate: MatchableCandidate): string {
  return `${candidate.title} ${candidate.body ?? ""}`;
}

function playerScore(event: MatchableEvent, text: string): number {
  if (!event.playerName) return 0;
  const normalizedText = tokenize(text);
  const lastName = normalizeText(event.playerName.trim().split(/\s+/).pop() ?? event.playerName);
  const fullName = normalizeText(event.playerName);

  if (normalizeText(text).includes(fullName)) return 1;
  if (normalizedText.includes(lastName)) return 1;

  // tolerate small typos in the last name (e.g. "Odegaard" vs "Ødegaard")
  const closeMatch = normalizedText.some((token) => editDistance(token, lastName) <= 1 && lastName.length > 3);
  return closeMatch ? 0.5 : 0;
}

function teamScore(event: MatchableEvent, text: string): number {
  const normalized = normalizeText(text);
  const eventTeamAliases = event.eventTeamName ? aliasesFor(event.eventTeamName) : [];
  const opponentName =
    event.eventTeamName === event.homeTeamName ? event.awayTeamName : event.homeTeamName;
  const opponentAliases = aliasesFor(opponentName);

  const eventTeamHit = eventTeamAliases.some((a) => normalized.includes(normalizeText(a)));
  const opponentHit = opponentAliases.some((a) => normalized.includes(normalizeText(a)));

  if (eventTeamHit && opponentHit) return 1;
  if (eventTeamHit) return 0.7;
  if (opponentHit) return 0.3;
  return 0;
}

/** Looks for an explicit minute reference like "67'" or "67 min" and compares to the event minute. */
function minuteMentionedInText(text: string): number | null {
  const match = text.match(/\b(\d{1,3})\s*(?:'|min\b|’)/i);
  if (!match) return null;
  const minute = Number(match[1]);
  return Number.isFinite(minute) ? minute : null;
}

function timeScore(event: MatchableEvent, candidate: MatchableCandidate): number {
  const mentionedMinute = minuteMentionedInText(candidateText(candidate));
  if (mentionedMinute !== null) {
    const diff = Math.abs(mentionedMinute - event.minute);
    return Math.max(0, 1 - diff / 10);
  }

  const diffMs = Math.abs(candidate.createdAt.getTime() - event.timestamp.getTime());
  const diffMinutes = diffMs / (60 * 1000);
  return Math.max(0, 1 - diffMinutes / 60);
}

function eventTypeScore(event: MatchableEvent, text: string): number {
  const keywords = EVENT_TYPE_KEYWORDS[event.type];
  if (!keywords || keywords.length === 0) return 0.2;
  const normalized = normalizeText(text);
  const hit = keywords.some((keyword) => normalized.includes(normalizeText(keyword)));
  return hit ? 1 : 0.2;
}

/** Stage 2: token/string similarity scoring — the "components" of ComponentScores except semanticScore. */
export function scoreFuzzyMatch(
  event: MatchableEvent,
  candidate: MatchableCandidate
): Omit<ComponentScores, "semanticScore"> {
  const text = candidateText(candidate);
  return {
    playerScore: playerScore(event, text),
    teamScore: teamScore(event, text),
    timeScore: timeScore(event, candidate),
    eventTypeScore: eventTypeScore(event, text),
  };
}
