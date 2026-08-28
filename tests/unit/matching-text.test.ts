import { describe, expect, it } from "vitest";
import { normalizeText, tokenOverlapScore, editDistance, containsWord } from "@/lib/matching/text";

describe("normalizeText", () => {
  it("lowercases, strips punctuation, and strips diacritics", () => {
    expect(normalizeText("Barça, Real Madrid!")).toBe("barca real madrid");
    expect(normalizeText("Martin Ødegaard")).toBe("martin degaard");
  });
});

describe("tokenOverlapScore", () => {
  it("scores identical strings as 1", () => {
    expect(tokenOverlapScore("Arsenal Chelsea goal", "Arsenal Chelsea goal")).toBe(1);
  });

  it("scores completely disjoint strings as 0", () => {
    expect(tokenOverlapScore("Arsenal Chelsea", "Liverpool Newcastle")).toBe(0);
  });

  it("gives partial credit for partial overlap", () => {
    const score = tokenOverlapScore("Arsenal Chelsea goal", "Arsenal player ratings");
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThan(1);
  });
});

describe("editDistance", () => {
  it("is 0 for identical strings", () => {
    expect(editDistance("saka", "saka")).toBe(0);
  });

  it("tolerates a single-character typo", () => {
    expect(editDistance("odegaard", "degaard")).toBeLessThanOrEqual(2);
  });
});

describe("containsWord", () => {
  it("matches a whole word within a longer string", () => {
    expect(containsWord("Saka with an absolute screamer", "Saka")).toBe(true);
  });

  it("does not match a partial/substring word", () => {
    expect(containsWord("Sakamoto scores", "Saka")).toBe(false);
  });
});
