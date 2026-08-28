import type { MatchableEvent } from "./types";

/**
 * Abstraction over "can an AI model tell whether this post is about this
 * event". Only OpenAI is implemented, but nothing else in the matching
 * pipeline depends on that — swapping providers means writing one new
 * file, not touching the pipeline.
 */
export interface AIMatchProvider {
  name: string;
  /** Returns a 0..1 confidence that candidateText refers to `event`, or null on any failure. */
  scoreMatch(event: MatchableEvent, candidateText: string): Promise<number | null>;
}
