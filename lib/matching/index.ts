import type { MatchableCandidate, MatchableEvent, MatchResult, ComponentScores } from "./types";
import { deterministicFilter, exactPlayerAndTeamHit } from "./deterministic";
import { scoreFuzzyMatch } from "./fuzzy";
import { combineScore } from "./score";
import type { AIMatchProvider } from "./ai-provider";
import { openAIMatchProvider } from "./openai-provider";
import { logger } from "../logger";

export * from "./types";

/** Below this, a candidate isn't relevant enough to persist as a match. */
const MIN_RELEVANCE_THRESHOLD = 0.35;
/** At or above this fuzzy score, the match is confident enough to skip the AI call entirely. */
const CONFIDENT_FUZZY_THRESHOLD = 0.72;
/** Cost control: never send more than this many candidates to the LLM per event. */
const MAX_AI_CALLS_PER_EVENT = 5;

function candidateText(candidate: MatchableCandidate): string {
  return `${candidate.title}\n${candidate.body ?? ""}`.trim();
}

/**
 * The full three-stage pipeline: deterministic filtering narrows the pool,
 * fuzzy scoring ranks what's left, and only genuinely ambiguous candidates
 * (mid-confidence fuzzy score) are ever sent to the AI provider. Returns
 * ranked, transparent results — every score is explainable from its
 * components, never a black box.
 *
 * Fully functional with aiProvider omitted/unavailable: falls back to
 * deterministic + fuzzy matching only (see README § Reliability).
 */
export async function matchEventToPosts(
  event: MatchableEvent,
  candidates: MatchableCandidate[],
  aiProvider: AIMatchProvider = openAIMatchProvider
): Promise<MatchResult[]> {
  const narrowed = deterministicFilter(event, candidates);
  if (narrowed.length === 0) return [];

  const scored = narrowed.map((candidate) => {
    const fuzzy = scoreFuzzyMatch(event, candidate);
    const fuzzyScore = combineScore({ ...fuzzy, semanticScore: null });
    const exactHit = exactPlayerAndTeamHit(event, candidate);
    return { candidate, fuzzy, fuzzyScore, exactHit };
  });

  const confident = scored.filter((s) => s.exactHit || s.fuzzyScore >= CONFIDENT_FUZZY_THRESHOLD);
  const ambiguous = scored
    .filter((s) => !s.exactHit && s.fuzzyScore >= MIN_RELEVANCE_THRESHOLD && s.fuzzyScore < CONFIDENT_FUZZY_THRESHOLD)
    .sort((a, b) => b.fuzzyScore - a.fuzzyScore)
    .slice(0, MAX_AI_CALLS_PER_EVENT);

  const results: MatchResult[] = [];

  for (const { candidate, fuzzy, exactHit } of confident) {
    const components: ComponentScores = { ...fuzzy, semanticScore: null };
    results.push({
      socialPostId: candidate.id,
      score: combineScore(components),
      matchingMethod: exactHit ? "DETERMINISTIC" : "FUZZY",
      components,
    });
  }

  for (const { candidate, fuzzy, fuzzyScore } of ambiguous) {
    const semanticScore = await aiProvider.scoreMatch(event, candidateText(candidate)).catch((err) => {
      logger.warn("ai_matching_error", { provider: aiProvider.name, error: String(err) });
      return null;
    });

    const components: ComponentScores = { ...fuzzy, semanticScore };
    const finalScore = semanticScore === null ? fuzzyScore : combineScore(components);

    if (finalScore < MIN_RELEVANCE_THRESHOLD) continue;

    results.push({
      socialPostId: candidate.id,
      score: finalScore,
      matchingMethod: semanticScore === null ? "FUZZY" : "SEMANTIC",
      components,
    });
  }

  logger.info("matching_completed", {
    candidates: candidates.length,
    afterDeterministic: narrowed.length,
    confident: confident.length,
    aiCalls: ambiguous.length,
    matched: results.length,
  });

  return results.sort((a, b) => b.score - a.score);
}
