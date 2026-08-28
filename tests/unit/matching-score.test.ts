import { describe, expect, it } from "vitest";
import { combineScore } from "@/lib/matching/score";

describe("combineScore", () => {
  it("returns 1 when every component is a perfect match", () => {
    expect(
      combineScore({ playerScore: 1, teamScore: 1, timeScore: 1, eventTypeScore: 1, semanticScore: 1 })
    ).toBeCloseTo(1);
  });

  it("returns 0 when every component is zero", () => {
    expect(
      combineScore({ playerScore: 0, teamScore: 0, timeScore: 0, eventTypeScore: 0, semanticScore: 0 })
    ).toBe(0);
  });

  it("renormalizes weights when semanticScore is null, staying on a 0..1 scale", () => {
    const score = combineScore({
      playerScore: 1,
      teamScore: 1,
      timeScore: 1,
      eventTypeScore: 1,
      semanticScore: null,
    });
    expect(score).toBeCloseTo(1);
  });

  it("weighs player similarity more heavily than event-type similarity", () => {
    const playerMatch = combineScore({
      playerScore: 1,
      teamScore: 0,
      timeScore: 0,
      eventTypeScore: 0,
      semanticScore: null,
    });
    const eventTypeMatch = combineScore({
      playerScore: 0,
      teamScore: 0,
      timeScore: 0,
      eventTypeScore: 1,
      semanticScore: null,
    });
    expect(playerMatch).toBeGreaterThan(eventTypeMatch);
  });
});
