import { describe, expect, it } from "vitest";
import { generatedCommentaryProvider } from "@/lib/commentary/generated";
import type { CommentaryInput } from "@/lib/commentary/provider";

function baseInput(overrides: Partial<CommentaryInput>): CommentaryInput {
  return {
    matchExternalId: "m1",
    eventExternalId: "e1",
    type: "GOAL",
    minute: 67,
    teamName: "Arsenal",
    opponentName: "Chelsea",
    playerName: "Bukayo Saka",
    assistName: null,
    detail: null,
    ...overrides,
  };
}

describe("generatedCommentaryProvider", () => {
  it("always returns a result — the guaranteed fallback", async () => {
    const result = await generatedCommentaryProvider.getCommentary(baseInput({}));
    expect(result?.source).toBe("GENERATED");
  });

  it("mentions the assist when present", async () => {
    const result = await generatedCommentaryProvider.getCommentary(
      baseInput({ assistName: "Martin Ødegaard" })
    );
    expect(result?.text).toContain("Bukayo Saka");
    expect(result?.text).toContain("Martin Ødegaard");
  });

  it("describes a substitution as X replaces Y", async () => {
    const result = await generatedCommentaryProvider.getCommentary(
      baseInput({ type: "SUBSTITUTION", playerName: "Gabriel Martinelli", assistName: "Leandro Trossard" })
    );
    expect(result?.text).toBe("Gabriel Martinelli replaces Leandro Trossard for Arsenal.");
  });

  it("describes a red card without inventing an assist", async () => {
    const result = await generatedCommentaryProvider.getCommentary(
      baseInput({ type: "RED_CARD", playerName: "William Saliba", assistName: null })
    );
    expect(result?.text).toBe("William Saliba is shown a straight red card — Arsenal down to ten men.");
  });

  it("falls back to a neutral player label when no name is known", async () => {
    const result = await generatedCommentaryProvider.getCommentary(baseInput({ playerName: null }));
    expect(result?.text).toContain("A player");
  });
});
