import { describe, expect, it } from "vitest";
import { extractMinute, extractPlayerName, detectScoringSide } from "@/lib/reddit/parse-goal-post";

describe("extractMinute", () => {
  it("extracts a minute followed by an apostrophe", () => {
    expect(extractMinute("Julián Álvarez 65' | Atletico Madrid 1-0 Sevilla")).toBe(65);
  });

  it("extracts a minute with a curly apostrophe", () => {
    expect(extractMinute("Griezmann 12’ Atletico Madrid")).toBe(12);
  });

  it("extracts a minute written as 'min'", () => {
    expect(extractMinute("Goal at 78 min - Sevilla equalize")).toBe(78);
  });

  it("returns null when no minute marker is present", () => {
    expect(extractMinute("Atletico Madrid dominating possession")).toBeNull();
  });

  it("rejects an out-of-range number", () => {
    expect(extractMinute("200' clip compilation")).toBeNull();
  });
});

describe("extractPlayerName", () => {
  it("takes the text before a minute marker", () => {
    expect(extractPlayerName("[Goal Clip] Antoine Griezmann 23'")).toBe("Antoine Griezmann");
  });

  it("takes the text before a pipe delimiter", () => {
    expect(extractPlayerName("Julián Álvarez 65' | Atletico Madrid 1-0 Sevilla")).toBe("Julián Álvarez");
  });

  it("strips a leading bracketed flair tag", () => {
    expect(extractPlayerName("[Highlight] Isaac Romero 10'")).toBe("Isaac Romero");
  });

  it("returns null for a title that looks like a match preview, not a name", () => {
    expect(extractPlayerName("Atletico Madrid vs Sevilla — Full commentary")).toBeNull();
  });

  it("returns null for an empty/degenerate candidate", () => {
    expect(extractPlayerName("[Goal Clip]")).toBeNull();
  });
});

describe("detectScoringSide", () => {
  const home = "Atletico Madrid";
  const away = "Sevilla";

  it("attributes to the home team when only its alias is mentioned", () => {
    expect(detectScoringSide("Griezmann scores for Atletico Madrid!", home, away)).toBe("home");
  });

  it("attributes to the away team when only its alias is mentioned", () => {
    expect(detectScoringSide("Isaac Romero equalizes for Sevilla", home, away)).toBe("away");
  });

  it("recognizes common nicknames, not just the full team name", () => {
    expect(detectScoringSide("Atleti go 1-0 up", home, away)).toBe("home");
  });

  it("returns null when both teams are mentioned and no score context is given", () => {
    expect(detectScoringSide("Atletico Madrid 1-0 Sevilla", home, away)).toBeNull();
  });

  it("returns null when neither team is mentioned", () => {
    expect(detectScoringSide("Real Madrid win the title", home, away)).toBeNull();
  });

  it("resolves the common 'both teams + score' title via score-delta against the known score", () => {
    // previous score was 0-0, title reports 1-0 -> the home side (named first) just scored
    const result = detectScoringSide(
      "Julián Álvarez 65' | Atletico Madrid 1-0 Sevilla",
      home,
      away,
      { homeScore: 0, awayScore: 0 }
    );
    expect(result).toBe("home");
  });

  it("resolves an away goal via score-delta when the away team's number increased", () => {
    // previous score was 1-0, title reports 1-1 -> Sevilla's number went up
    const result = detectScoringSide("Isaac Romero 70' | Atletico Madrid 1-1 Sevilla", home, away, {
      homeScore: 1,
      awayScore: 0,
    });
    expect(result).toBe("away");
  });

  it("does not guess from score-delta when the score in the title didn't actually change", () => {
    // stale re-post / recap where the score matches what we already know — no signal either way
    const result = detectScoringSide("Highlights: Atletico Madrid 1-0 Sevilla", home, away, {
      homeScore: 1,
      awayScore: 0,
    });
    expect(result).toBeNull();
  });
});
