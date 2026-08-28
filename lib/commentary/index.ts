import type { CommentaryProvider, CommentaryInput, Commentary } from "./provider";
import { sportsApiCommentaryProvider } from "./sports-api";
import { fotmobCommentaryProvider } from "./fotmob";
import { generatedCommentaryProvider } from "./generated";
import { normalizeCommentaryText } from "./normalizer";
import { logger } from "../logger";

export type { CommentaryProvider, CommentaryInput, Commentary };

const PROVIDER_TIMEOUT_MS = 3000;

/** Fallback order: official sports API detail → (disabled) FotMob → generated. */
const PROVIDER_CHAIN: CommentaryProvider[] = [
  sportsApiCommentaryProvider,
  fotmobCommentaryProvider,
  generatedCommentaryProvider,
];

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error("commentary provider timeout")), ms)),
  ]);
}

/**
 * Runs the provider chain and returns the first usable, normalized result.
 * A failing or slow provider is logged and skipped — generatedCommentaryProvider
 * never fails, so this only returns null if `input` itself is unusable.
 */
export async function getCommentaryForEvent(input: CommentaryInput): Promise<Commentary | null> {
  for (const provider of PROVIDER_CHAIN) {
    try {
      const result = await withTimeout(provider.getCommentary(input), PROVIDER_TIMEOUT_MS);
      if (!result) continue;

      const text = normalizeCommentaryText(result.text);
      if (!text) continue;

      logger.info("commentary_fetched", {
        provider: provider.name,
        source: result.source,
        eventExternalId: input.eventExternalId,
      });
      return { text, source: result.source };
    } catch (err) {
      logger.warn("commentary_provider_failed", { provider: provider.name, error: String(err) });
    }
  }
  return null;
}
