import { describe, expect, it } from "vitest";
import { parseGoalClipTitle, resolveGoalEvent } from "@/lib/reddit/parse-goal-post";

// Real r/soccer "Goal Clip" post titles. The first four were provided
// directly by the user; the rest were pulled from a live r/soccer flair
// search (`flair_name:":n_goal: Goal Clip"`, sorted new) on 2026-09-02.
// Confirms the parser against actual community convention, not a guess.
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
      isOwnGoal: false,
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

  // --- Titles from the live 2026-09-02 flair scrape ---

  it("parses a home-scoring goal with no space before the dash: '[1]-1'", () => {
    const result = parseGoalClipTitle("Burnley [1]-1 Middlesbrough - Ugo Raghouber 54'");
    expect(result).toMatchObject({
      homeTeamText: "Burnley",
      awayTeamText: "Middlesbrough",
      homeScore: 1,
      awayScore: 1,
      scoringSide: "home",
      playerName: "Ugo Raghouber",
      minute: 54,
      extraMinute: null,
      isPenalty: false,
    });
  });

  it("parses a bracketed penalty (penalty flag + scoringSide together)", () => {
    const result = parseGoalClipTitle("VfL Osnabruck 1 - [4] Bayern Munich - Harry Kane Penalty 85'");
    expect(result).toMatchObject({
      awayTeamText: "Bayern Munich",
      awayScore: 4,
      scoringSide: "away",
      playerName: "Harry Kane",
      minute: 85,
      isPenalty: true,
    });
  });

  it("strips a trailing parenthetical that isn't an assist note", () => {
    const result = parseGoalClipTitle("Slavia Sofia 1-[1] Levski Sofia - Armstrong Oko-Flex 70' (great goal)");
    expect(result?.scoringSide).toBe("away");
    expect(result?.playerName).toBe("Armstrong Oko-Flex");
    expect(result?.minute).toBe(70);
  });

  it("returns scoringSide null for a real Goal Clip post that omits brackets", () => {
    // A meaningful share of genuine Goal Clip posts carry no bracket at all.
    const result = parseGoalClipTitle("Widzew Łódź 0-1 Korona Kielce - Daniel Bąk 73' (Polish Cup RO64)");
    expect(result?.scoringSide).toBeNull();
    expect(result?.homeScore).toBe(0);
    expect(result?.awayScore).toBe(1);
    expect(result?.minute).toBe(73);
    expect(result?.playerName).toBe("Daniel Bąk");
  });

  it("parses the '90'+7'' stoppage-time variant and strips an aggregate-score annotation", () => {
    const result = parseGoalClipTitle("Real Madrid W [2]-1 Ajax W [4-1 on agg.] - Linda Caicedo 90'+7'");
    expect(result).toMatchObject({
      homeTeamText: "Real Madrid W",
      awayTeamText: "Ajax W", // "[4-1 on agg.]" removed before parsing
      homeScore: 2,
      awayScore: 1,
      scoringSide: "home",
      playerName: "Linda Caicedo",
      minute: 90,
      extraMinute: 7,
    });
  });

  it("flags an own goal and returns a clean player name without the 'OG' marker", () => {
    const result = parseGoalClipTitle("Falkirk [1]-1 Rangers - Kosta Nedeljkovic OG 44'");
    expect(result).toMatchObject({
      scoringSide: "home",
      playerName: "Kosta Nedeljkovic",
      isOwnGoal: true,
      isPenalty: false,
      minute: 44,
    });
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
      isOwnGoal: false,
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
    expect(result?.playerName).toBe("Gilberto Mora"); // scorer taken from after the last " - ", annotation stripped
    expect(result?.isPenalty).toBe(false); // fallback path doesn't extract the penalty flag
  });

  it("extracts the scorer from the score-line shape in the fallback path (not the leading team text)", () => {
    const result = resolveGoalEvent("Dundee FC 1-0 St. Johnstone - Charlie Reilly 87'", "Dundee FC", "St. Johnstone", {
      homeScore: 0,
      awayScore: 0,
    });
    expect(result).toEqual({
      side: "home",
      playerName: "Charlie Reilly",
      minute: 87,
      extraMinute: null,
      isPenalty: false,
      isOwnGoal: false,
    });
  });

  it("returns null when nothing resolves the scoring side", () => {
    const result = resolveGoalEvent("Highlights of an unrelated match", "Atletico Madrid", "Sevilla");
    expect(result).toBeNull();
  });

  it("resolves a bracketed penalty from the live scrape end to end", () => {
    const result = resolveGoalEvent(
      "VfL Osnabruck 1 - [4] Bayern Munich - Harry Kane Penalty 85'",
      "VfL Osnabrück",
      "Bayern Munich"
    );
    expect(result).toEqual({
      side: "away",
      playerName: "Harry Kane",
      minute: 85,
      extraMinute: null,
      isPenalty: true,
      isOwnGoal: false,
    });
  });
});
