import type { MatchEventType, MatchingMethod } from "@prisma/client";

export interface MatchableEvent {
  id: string;
  homeTeamName: string;
  awayTeamName: string;
  /** Name of the team the event belongs to, if known. */
  eventTeamName: string | null;
  type: MatchEventType;
  playerName: string | null;
  assistName: string | null;
  /** Match-clock minute, e.g. 67. */
  minute: number;
  /** Wall-clock time the event actually happened. */
  timestamp: Date;
  commentary: string | null;
}

export interface MatchableCandidate {
  id: string;
  title: string;
  body: string | null;
  createdAt: Date;
}

export interface ComponentScores {
  playerScore: number;
  teamScore: number;
  timeScore: number;
  eventTypeScore: number;
  semanticScore: number | null;
}

export interface MatchResult {
  socialPostId: string;
  score: number;
  matchingMethod: MatchingMethod;
  components: ComponentScores;
}

/** Configurable, transparent scoring weights (see README § AI Matching). */
export const MATCH_WEIGHTS = {
  player: 0.3,
  team: 0.25,
  time: 0.2,
  eventType: 0.1,
  semantic: 0.15,
} as const;
