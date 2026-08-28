import { describe, expect, it } from "vitest";
import { scoreFuzzyMatch } from "@/lib/matching/fuzzy";
import type { MatchableEvent, MatchableCandidate } from "@/lib/matching/types";

const event: MatchableEvent = {
  id: "evt1",
  homeTeamName: "Arsenal",
  awayTeamName: "Chelsea",
  eventTeamName: "Arsenal",
  type: "GOAL",
  playerName: "Bukayo Saka",
  assistName: "Martin Ødegaard",
  minute: 67,
  timestamp: new Date("2026-01-01T15:00:00Z"),
  commentary: "Saka cuts inside from the right and fires a low shot into the far corner.",
};

function candidate(overrides: Partial<MatchableCandidate>): MatchableCandidate {
  return {
    id: "post1",
    title: "",
    body: null,
    createdAt: event.timestamp,
    ...overrides,
  };
}

describe("scoreFuzzyMatch", () => {
  it("scores a full-name, both-teams, matching-minute post highly on every component", () => {
    const scores = scoreFuzzyMatch(
      event,
      candidate({ title: "[Goal] Saka cuts inside for Arsenal and curls it past the Chelsea keeper! 67'" })
    );
    expect(scores.playerScore).toBe(1);
    expect(scores.teamScore).toBeGreaterThanOrEqual(0.7);
    expect(scores.timeScore).toBeGreaterThan(0.9);
    expect(scores.eventTypeScore).toBe(1);
  });

  it("scores a post naming the player but neither team as zero on the team component", () => {
    // This mirrors a common, realistic Reddit title style — the canonical
    // example from the product brief doesn't restate the team names.
    const scores = scoreFuzzyMatch(
      event,
      candidate({ title: "[Goal] Saka cuts inside and curls it past the keeper! 67'" })
    );
    expect(scores.playerScore).toBe(1);
    expect(scores.teamScore).toBe(0);
  });

  it("recognizes a bare last name as a full player match", () => {
    const scores = scoreFuzzyMatch(event, candidate({ title: "Saka with an absolute screamer" }));
    expect(scores.playerScore).toBe(1);
  });

  it("gives partial credit for a close-but-not-exact minute", () => {
    const exact = scoreFuzzyMatch(event, candidate({ title: "Saka goal 67'" }));
    const close = scoreFuzzyMatch(event, candidate({ title: "Saka goal 66'" }));
    const far = scoreFuzzyMatch(event, candidate({ title: "Saka goal 20'" }));
    expect(close.timeScore).toBeLessThan(exact.timeScore);
    expect(far.timeScore).toBeLessThan(close.timeScore);
  });

  it("scores a post mentioning neither team nor player at zero on those components", () => {
    const scores = scoreFuzzyMatch(event, candidate({ title: "Liverpool player ratings vs Newcastle" }));
    expect(scores.playerScore).toBe(0);
    expect(scores.teamScore).toBe(0);
  });

  it("gives the opponent team a lower score than the event's own team", () => {
    const ownTeam = scoreFuzzyMatch(event, candidate({ title: "Arsenal fans celebrate wildly" }));
    const opponentOnly = scoreFuzzyMatch(event, candidate({ title: "Chelsea defense was awful today" }));
    expect(ownTeam.teamScore).toBeGreaterThan(opponentOnly.teamScore);
  });
});
