import { describe, expect, it } from "vitest";
import { matchSlug, teamSlug, teamProfileSlug } from "@/lib/sports/match-slug";

describe("teamSlug", () => {
  it("lowercases and hyphenates, dropping only safe filler words", () => {
    expect(teamSlug("Manchester United")).toBe("manchester-united");
    expect(teamSlug("Ipswich Town")).toBe("ipswich");
    expect(teamSlug("Tottenham Hotspur")).toBe("tottenham");
    expect(teamSlug("Brighton & Hove Albion")).toBe("brighton");
    expect(teamSlug("Wolverhampton Wanderers")).toBe("wolverhampton");
  });

  it("keeps 'united' / 'city' so the two Manchester clubs don't collide", () => {
    expect(teamSlug("Manchester United")).not.toBe(teamSlug("Manchester City"));
  });

  it("strips diacritics", () => {
    expect(teamSlug("Atlético Madrid")).toBe("atletico-madrid");
    expect(teamSlug("Alavés")).toBe("alaves");
  });
});

describe("teamProfileSlug", () => {
  it("keeps every word of the full club name, tidied", () => {
    expect(teamProfileSlug("Tottenham Hotspur")).toBe("tottenham-hotspur");
    expect(teamProfileSlug("Manchester United")).toBe("manchester-united");
    expect(teamProfileSlug("VfB Stuttgart")).toBe("vfb-stuttgart");
  });

  it("collapses punctuation and strips diacritics", () => {
    expect(teamProfileSlug("Brighton & Hove Albion")).toBe("brighton-hove-albion");
    expect(teamProfileSlug("Atlético Madrid")).toBe("atletico-madrid");
    expect(teamProfileSlug("Borussia Mönchengladbach")).toBe("borussia-monchengladbach");
  });
});

describe("matchSlug", () => {
  it("builds home-away-MMDDYY", () => {
    expect(matchSlug("Manchester United", "Ipswich Town", new Date("2026-08-30T14:00:00Z"))).toBe(
      "manchester-united-ipswich-083026"
    );
    expect(matchSlug("Tottenham Hotspur", "Newcastle United", new Date("2026-08-29T16:30:00Z"))).toBe(
      "tottenham-newcastle-united-082926"
    );
  });
});
