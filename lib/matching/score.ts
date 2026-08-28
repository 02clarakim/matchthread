import type { ComponentScores } from "./types";
import { MATCH_WEIGHTS } from "./types";

/**
 * Weighted-average of the component scores. When semanticScore is null
 * (AI stage skipped or unavailable), its weight is excluded and the
 * remaining weights are renormalized — so a fuzzy-only match and an
 * AI-assisted match both land on a comparable 0..1 scale.
 */
export function combineScore(components: ComponentScores): number {
  const entries: Array<[number, number]> = [
    [MATCH_WEIGHTS.player, components.playerScore],
    [MATCH_WEIGHTS.team, components.teamScore],
    [MATCH_WEIGHTS.time, components.timeScore],
    [MATCH_WEIGHTS.eventType, components.eventTypeScore],
  ];
  if (components.semanticScore !== null) {
    entries.push([MATCH_WEIGHTS.semantic, components.semanticScore]);
  }

  const weightSum = entries.reduce((sum, [w]) => sum + w, 0);
  const weightedSum = entries.reduce((sum, [w, s]) => sum + w * s, 0);
  return weightSum === 0 ? 0 : weightedSum / weightSum;
}
