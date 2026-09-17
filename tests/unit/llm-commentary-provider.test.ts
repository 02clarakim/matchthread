import { describe, expect, it } from "vitest";
import { llmCommentaryProvider } from "@/lib/commentary/llm-provider";

/**
 * Real prompt/output quality can't be asserted without a live network call
 * (and shouldn't be, in a unit test — see tests/unit/matching-pipeline.test.ts
 * for the same philosophy with the AI matching provider). What's testable
 * here, cheaply and deterministically, is the graceful-degradation contract
 * every optional provider in this app follows: no key configured -> no
 * network call, no throw, just null so the chain falls through to the
 * generated template (see lib/commentary/index.ts).
 */
describe("llmCommentaryProvider", () => {
  it("returns null without throwing when OPENAI_API_KEY is unset", async () => {
    // Force the unconfigured case regardless of the developer's own .env —
    // a unit test must not depend on whether a real key happens to be set.
    const original = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;

    try {
      const result = await llmCommentaryProvider.getCommentary({
        matchExternalId: "m1",
        eventExternalId: "e1",
        type: "GOAL",
        minute: 62,
        teamName: "Newcastle United",
        opponentName: "Tottenham Hotspur",
        playerName: "Anthony Elanga",
        assistName: "Amar Dedic",
      });

      expect(result).toBeNull();
    } finally {
      if (original !== undefined) process.env.OPENAI_API_KEY = original;
    }
  });
});
