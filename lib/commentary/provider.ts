import type { CommentarySource, MatchEventType } from "@prisma/client";

/**
 * Everything a commentary provider might need to either look up commentary
 * from a source, or synthesize it from structured data. Providers use only
 * the fields relevant to them (e.g. GeneratedCommentaryProvider ignores the
 * external IDs entirely).
 */
export interface CommentaryInput {
  matchExternalId: string;
  eventExternalId: string;
  type: MatchEventType;
  minute: number;
  extraMinute?: number | null;
  teamName?: string | null;
  opponentName?: string | null;
  playerName?: string | null;
  assistName?: string | null;
  /** Raw provider-supplied detail string, if any (e.g. "Yellow card - Foul"). */
  detail?: string | null;
}

export interface Commentary {
  text: string;
  source: CommentarySource;
}

export interface CommentaryProvider {
  name: string;
  getCommentary(input: CommentaryInput): Promise<Commentary | null>;
}
