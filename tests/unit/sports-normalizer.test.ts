import { describe, expect, it } from "vitest";
import { normalizeMatch, normalizeEvents, type RawFootballDataMatch } from "@/lib/sports/normalizer";

const rawMatch: RawFootballDataMatch = {
  id: 12345,
  utcDate: "2026-01-01T15:00:00Z",
  status: "IN_PLAY",
  venue: "Emirates Stadium",
  minute: 67,
  competition: { id: 2021, name: "Premier League", area: { name: "England" } },
  homeTeam: { id: 57, name: "Arsenal", shortName: "Arsenal", crest: "https://example.com/arsenal.png" },
  awayTeam: { id: 61, name: "Chelsea", shortName: "Chelsea", crest: null },
  score: { fullTime: { home: 1, away: 0 } },
  goals: [
    {
      minute: 67,
      type: "REGULAR",
      team: { id: 57 },
      scorer: { id: 999, name: "Bukayo Saka" },
      assist: { id: 998, name: "Martin Ødegaard" },
    },
  ],
  bookings: [{ minute: 23, card: "YELLOW_CARD", team: { id: 61 }, player: { id: 111, name: "Enzo Fernández" } }],
  substitutions: [
    { minute: 74, team: { id: 57 }, playerOut: { id: 222, name: "Leandro Trossard" }, playerIn: { id: 223, name: "Gabriel Martinelli" } },
  ],
};

describe("normalizeMatch", () => {
  it("maps provider status enums to our internal MatchStatus", () => {
    expect(normalizeMatch(rawMatch).status).toBe("LIVE");
    expect(normalizeMatch({ ...rawMatch, status: "TIMED" }).status).toBe("SCHEDULED");
    expect(normalizeMatch({ ...rawMatch, status: "FINISHED" }).status).toBe("FINISHED");
    expect(normalizeMatch({ ...rawMatch, status: "SUSPENDED" }).status).toBe("PAUSED");
  });

  it("extracts score, teams, and league", () => {
    const match = normalizeMatch(rawMatch);
    expect(match.homeScore).toBe(1);
    expect(match.awayScore).toBe(0);
    expect(match.homeTeam.name).toBe("Arsenal");
    expect(match.awayTeam.externalId).toBe("61");
    expect(match.league.country).toBe("England");
  });

  it("defaults score to null when the provider hasn't reported one", () => {
    const match = normalizeMatch({ ...rawMatch, score: undefined });
    expect(match.homeScore).toBeNull();
    expect(match.awayScore).toBeNull();
  });
});

describe("normalizeEvents", () => {
  it("maps goals, bookings, and substitutions into our MatchEventType enum", () => {
    const events = normalizeEvents(rawMatch);
    expect(events).toHaveLength(3);

    const goal = events.find((e) => e.type === "GOAL");
    expect(goal?.playerName).toBe("Bukayo Saka");
    expect(goal?.assistName).toBe("Martin Ødegaard");
    expect(goal?.teamExternalId).toBe("57");

    const card = events.find((e) => e.type === "YELLOW_CARD");
    expect(card?.playerName).toBe("Enzo Fernández");

    const sub = events.find((e) => e.type === "SUBSTITUTION");
    expect(sub?.playerName).toBe("Gabriel Martinelli");
    expect(sub?.assistName).toBe("Leandro Trossard");
  });

  it("produces deterministic externalIds so repeated polling can't create duplicates", () => {
    const first = normalizeEvents(rawMatch);
    const second = normalizeEvents(rawMatch);
    expect(first.map((e) => e.externalId)).toEqual(second.map((e) => e.externalId));
  });

  it("returns an empty array when the provider gives no event-level detail", () => {
    const events = normalizeEvents({ ...rawMatch, goals: undefined, bookings: undefined, substitutions: undefined });
    expect(events).toEqual([]);
  });
});
