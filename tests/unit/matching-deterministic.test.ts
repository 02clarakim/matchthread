import { describe, expect, it } from "vitest";
import { deterministicFilter } from "@/lib/matching/deterministic";
import type { MatchableEvent, MatchableCandidate } from "@/lib/matching/types";

const event: MatchableEvent = {
  id: "evt1",
  homeTeamName: "Arsenal",
  awayTeamName: "Chelsea",
  eventTeamName: "Arsenal",
  type: "GOAL",
  playerName: "Bukayo Saka",
  assistName: null,
  minute: 67,
  timestamp: new Date("2026-01-01T15:00:00Z"),
  commentary: null,
};

function candidate(id: string, title: string, createdAt = event.timestamp): MatchableCandidate {
  return { id, title, body: null, createdAt };
}

describe("deterministicFilter", () => {
  it("keeps posts that mention either team", () => {
    const result = deterministicFilter(event, [
      candidate("a", "Arsenal player ratings"),
      candidate("b", "Chelsea need a new striker"),
    ]);
    expect(result.map((c) => c.id)).toEqual(["a", "b"]);
  });

  it("keeps posts that mention only the player", () => {
    const result = deterministicFilter(event, [candidate("a", "Saka is unplayable right now")]);
    expect(result).toHaveLength(1);
  });

  it("drops posts mentioning neither team nor player", () => {
    const result = deterministicFilter(event, [candidate("a", "Liverpool player ratings vs Newcastle")]);
    expect(result).toHaveLength(0);
  });

  it("drops posts far outside the event's time window", () => {
    const tooEarly = candidate("a", "Arsenal goal", new Date(event.timestamp.getTime() - 3 * 60 * 60 * 1000));
    const tooLate = candidate("b", "Arsenal goal", new Date(event.timestamp.getTime() + 6 * 60 * 60 * 1000));
    const result = deterministicFilter(event, [tooEarly, tooLate]);
    expect(result).toHaveLength(0);
  });
});
