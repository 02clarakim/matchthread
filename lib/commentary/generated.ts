import type { CommentaryProvider, CommentaryInput, Commentary } from "./provider";

/**
 * Deterministic, template-based commentary. This is the guaranteed fallback
 * at the end of the provider chain — every event type produces a concise,
 * factual one-liner from structured data alone, no LLM call required.
 * (AI is reserved for the harder problem: matching events to social posts.)
 */

function player(input: CommentaryInput): string {
  return input.playerName ?? "A player";
}

function team(input: CommentaryInput): string {
  return input.teamName ?? "The team";
}

function minuteLabel(input: CommentaryInput): string {
  return input.extraMinute ? `${input.minute}+${input.extraMinute}'` : `${input.minute}'`;
}

function generateText(input: CommentaryInput): string {
  switch (input.type) {
    case "GOAL":
      return input.assistName
        ? `${player(input)} scores for ${team(input)} after being set up by ${input.assistName}.`
        : `${player(input)} scores for ${team(input)}.`;

    case "PENALTY_GOAL":
      return `${player(input)} converts from the penalty spot for ${team(input)}.`;

    case "PENALTY_MISSED":
      return `${player(input)} fails to convert the penalty for ${team(input)}.`;

    case "OWN_GOAL":
      return `${player(input)} puts through his own net — own goal, ${team(input)} concede.`;

    case "YELLOW_CARD":
      return `${player(input)} is shown a yellow card${input.detail ? ` after ${input.detail.toLowerCase()}` : " after a foul"}.`;

    case "SECOND_YELLOW_CARD":
      return `${player(input)} is shown a second yellow and is sent off for ${team(input)}.`;

    case "RED_CARD":
      return `${player(input)} is shown a straight red card — ${team(input)} down to ten men.`;

    case "SUBSTITUTION":
      return input.assistName
        ? `${player(input)} replaces ${input.assistName} for ${team(input)}.`
        : `${player(input)} comes on for ${team(input)}.`;

    case "VAR_DECISION":
      return input.detail
        ? `VAR review: ${input.detail.toLowerCase()}.`
        : `The decision is being reviewed by VAR.`;

    case "KICKOFF":
      return `Kick-off — the match is underway.`;

    case "HALFTIME":
      return `Half-time.`;

    case "FULLTIME":
      return `Full-time.`;

    default:
      return input.detail ?? `${minuteLabel(input)} — ${team(input)}.`;
  }
}

export const generatedCommentaryProvider: CommentaryProvider = {
  name: "generated",
  async getCommentary(input: CommentaryInput): Promise<Commentary | null> {
    return { text: generateText(input), source: "GENERATED" };
  },
};
