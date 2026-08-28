import { describe, expect, it } from "vitest";
import { normalizeCommentaryText } from "@/lib/commentary/normalizer";

describe("normalizeCommentaryText", () => {
  it("strips HTML tags", () => {
    expect(normalizeCommentaryText("<p>Saka scores <b>again</b>!</p>")).toBe("Saka scores again !");
  });

  it("decodes common HTML entities", () => {
    expect(normalizeCommentaryText("Arsenal &amp; Chelsea &mdash; it&#39;s tense")).toBe(
      "Arsenal & Chelsea &mdash; it's tense"
    );
  });

  it("collapses whitespace", () => {
    expect(normalizeCommentaryText("Saka   scores\n\nagain")).toBe("Saka scores again");
  });

  it("truncates long text at a word boundary with an ellipsis", () => {
    const long = "word ".repeat(80).trim();
    const result = normalizeCommentaryText(long);
    expect(result).not.toBeNull();
    expect(result!.length).toBeLessThanOrEqual(221);
    expect(result!.endsWith("…")).toBe(true);
  });

  it("returns null for empty or missing input", () => {
    expect(normalizeCommentaryText(null)).toBeNull();
    expect(normalizeCommentaryText(undefined)).toBeNull();
    expect(normalizeCommentaryText("   ")).toBeNull();
    expect(normalizeCommentaryText("<p></p>")).toBeNull();
  });
});
