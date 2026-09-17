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
  /**
   * Grounding facts from the data source's own play-by-play (ESPN's
   * `keyEvents[].text`, e.g. "left footed shot from the centre of the box
   * ... Assisted by ... with a headed pass."). Only lib/commentary/
   * llm-provider.ts reads this — as source material for an *original*
   * sentence, never reproduced verbatim (see that file's doc comment for
   * why that distinction matters here).
   */
  sourceText?: string | null;
}

export interface Commentary {
  text: string;
  source: CommentarySource;
}

export interface CommentaryProvider {
  name: string;
  getCommentary(input: CommentaryInput): Promise<Commentary | null>;
}
