import { describe, expect, it } from "vitest";
import { parseGoalClipTitle, resolveGoalEvent } from "@/lib/reddit/parse-goal-post";

// Real r/soccer "Goal Clip" post titles, provided directly by the user —
// not invented. Confirms the parser against actual community convention
// rather than a guessed format.
describe("parseGoalClipTitle (real r/soccer examples)", () => {
  it("parses a title with no spaces around the score dash", () => {
    const result = parseGoalClipTitle("Lille 2-[2] Paris Saint-Germain - Marquinhos 90+5'");
    expect(result).toEqual({
      homeTeamText: "Lille",
      awayTeamText: "Paris Saint-Germain",
      homeScore: 2,
      awayScore: 2,
      scoringSide: "away",
      playerName: "Marquinhos",
      minute: 90,
      extraMinute: 5,
      isPenalty: false,
    });
  });

  it("parses a title with spaces around the score dash and invisible bidi marks around the minute", () => {
    // the literal input includes U+200E marks around the apostrophe, as observed
    const result = parseGoalClipTitle("Crystal Palace 1 - [4] Manchester City - Erling Haaland 84‎'‎");
    expect(result?.scoringSide).toBe("away");
    expect(result?.homeTeamText).toBe("Crystal Palace");
    expect(result?.awayTeamText).toBe("Manchester City");
    expect(result?.playerName).toBe("Erling Haaland");
    expect(result?.minute).toBe(84);
  });

  it("parses a home-scoring goal with a trailing assist note in parentheses", () => {
    const result = parseGoalClipTitle("Bayern [5] - 1 Stuttgart - Luis Diaz 93’ (Amazing pass from Saibari)");
    expect(result?.scoringSide).toBe("home");
    expect(result?.homeTeamText).toBe("Bayern");
    expect(result?.awayTeamText).toBe("Stuttgart");
    expect(result?.playerName).toBe("Luis Diaz");
    expect(result?.minute).toBe(93);
    expect(result?.extraMinute).toBeNull();
  });

  it("flags a penalty and returns scoringSide null when the title has no brackets", () => {
    const result = parseGoalClipTitle("Tijuana 2-0 Pumas - Gilberto Mora Penalty 81'");
    expect(result?.scoringSide).toBeNull();
    expect(result?.isPenalty).toBe(true);
    expect(result?.playerName).toBe("Gilberto Mora");
    expect(result?.minute).toBe(81);
  });

  it("returns null for a title that isn't a goal-clip post at all", () => {
    expect(parseGoalClipTitle("Match Thread: Arsenal vs Chelsea")).toBeNull();
  });
});

describe("resolveGoalEvent", () => {
  it("resolves the scoring side via the bracket convention for a real title", () => {
    const result = resolveGoalEvent(
      "Crystal Palace 1 - [4] Manchester City - Erling Haaland 84'",
      "Crystal Palace",
      "Manchester City"
    );
    expect(result).toEqual({
      side: "away",
      playerName: "Erling Haaland",
      minute: 84,
      extraMinute: null,
      isPenalty: false,
    });
  });

  it("maps a Reddit-abbreviated team name onto our tracked team via aliases, regardless of title word order", () => {
    // "Atleti" is a known alias for Atletico Madrid, not the literal DB
    // name — and this title happens to list Sevilla first even though
    // Atletico Madrid is *our* home team, so this also checks that
    // resolution goes by identity, not by position in the title.
    const result = resolveGoalEvent(
      "Sevilla 0-[1] Atleti - Antoine Griezmann 23'",
      "Atletico Madrid",
      "Sevilla"
    );
    expect(result?.side).toBe("home");
  });

  it("falls back to score-delta detection when the title has no bracket convention", () => {
    const result = resolveGoalEvent("Tijuana 2-0 Pumas - Gilberto Mora Penalty 81'", "Tijuana", "Pumas", {
      homeScore: 1,
      awayScore: 0,
    });
    expect(result?.side).toBe("home");
    expect(result?.isPenalty).toBe(false); // fallback path doesn't extract the penalty flag
  });

  it("returns null when nothing resolves the scoring side", () => {
    const result = resolveGoalEvent("Highlights of an unrelated match", "Atletico Madrid", "Sevilla");
    expect(result).toBeNull();
  });
});
