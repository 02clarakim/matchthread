import { describe, expect, it } from "vitest";
import { matchEventToPosts } from "@/lib/matching";
import type { MatchableEvent, MatchableCandidate } from "@/lib/matching/types";
import type { AIMatchProvider } from "@/lib/matching/ai-provider";

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

const candidates: MatchableCandidate[] = [
  {
    id: "strong-exact",
    title: "[Goal] Saka cuts inside for Arsenal and curls it past the Chelsea keeper! 67'",
    body: null,
    createdAt: event.timestamp,
  },
  {
    id: "ambiguous",
    // Mentions the team, vaguely plausible timing, but no player/event-type
    // keyword — a genuinely ambiguous case that fuzzy scoring alone can't
    // confidently resolve, which is exactly what the AI stage is for.
    title: "Arsenal doing Arsenal things again this afternoon",
    body: null,
    createdAt: new Date(event.timestamp.getTime() + 5 * 60 * 1000),
  },
  {
    id: "irrelevant",
    title: "Liverpool player ratings vs Newcastle",
    body: "Salah 8, Van Dijk 7, Alisson 6",
    createdAt: event.timestamp,
  },
];

const neverCalledAI: AIMatchProvider = {
  name: "never-called",
  async scoreMatch() {
    throw new Error("AI should not have been called for a confident fuzzy match");
  },
};

describe("matchEventToPosts", () => {
  it("rejects posts that mention neither the teams nor the player", async () => {
    const results = await matchEventToPosts(event, candidates, neverCalledAI);
    expect(results.find((r) => r.socialPostId === "irrelevant")).toBeUndefined();
  });

  it("resolves a strong match via deterministic/fuzzy scoring without calling the AI provider", async () => {
    const results = await matchEventToPosts(event, candidates, neverCalledAI);
    const strong = results.find((r) => r.socialPostId === "strong-exact");
    expect(strong).toBeDefined();
    expect(["DETERMINISTIC", "FUZZY"]).toContain(strong!.matchingMethod);
    expect(strong!.score).toBeGreaterThan(0.6);
  });

  it("sends only genuinely ambiguous candidates to the AI provider, and uses its verdict", async () => {
    const calls: string[] = [];
    const aiProvider: AIMatchProvider = {
      name: "stub-confident",
      async scoreMatch(_evt, candidateText) {
        calls.push(candidateText);
        return 0.9;
      },
    };

    const results = await matchEventToPosts(event, candidates, aiProvider);

    // the strong/exact match should never have reached the AI stage
    expect(calls.some((c) => c.includes("Saka cuts inside for Arsenal"))).toBe(false);
    // the irrelevant post never survives deterministic filtering either
    expect(calls.some((c) => c.includes("Liverpool"))).toBe(false);

    const ambiguous = results.find((r) => r.socialPostId === "ambiguous");
    expect(ambiguous?.matchingMethod).toBe("SEMANTIC");
    expect(ambiguous?.components.semanticScore).toBe(0.9);
  });

  it("falls back to fuzzy-only scoring when the AI provider fails, instead of throwing", async () => {
    const failingProvider: AIMatchProvider = {
      name: "stub-failing",
      async scoreMatch() {
        throw new Error("simulated AI outage");
      },
    };

    await expect(matchEventToPosts(event, candidates, failingProvider)).resolves.not.toThrow();
    const results = await matchEventToPosts(event, candidates, failingProvider);
    // the confident match still comes through even though the AI provider is broken
    expect(results.find((r) => r.socialPostId === "strong-exact")).toBeDefined();
  });
});
