import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db/prisma";
import { upsertMatch } from "@/lib/sports/ingest";
import type { RedditPost } from "@/lib/reddit/client";

/**
 * Exercises workers/reddit-live-poller.ts end to end against real
 * Postgres/Redis, with only the Reddit network call mocked — proving the
 * DB writes (event, score increment, social post, highlight) and the
 * status/minute heuristics work, independent of whether real Reddit
 * credentials are available in this environment.
 */

vi.mock("@/lib/reddit/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/reddit/client")>();
  return { ...actual, isRedditConfigured: () => true };
});

const goalPosts: RedditPost[] = [];
const redCardPosts: RedditPost[] = [];

vi.mock("@/lib/reddit/live-detector", () => ({
  findGoalClipPosts: async () => goalPosts,
  findRedCardPosts: async () => redCardPosts,
}));

const { pollOnce } = await import("@/workers/reddit-live-poller");

function fakePost(overrides: Partial<RedditPost>): RedditPost {
  return {
    id: randomUUID().slice(0, 8),
    title: "Test",
    selftext: "",
    author: "test_bot",
    permalink: "/r/soccer/comments/test/",
    url: "https://reddit.com",
    thumbnail: "default",
    created_utc: Math.floor(Date.now() / 1000),
    score: 1,
    ...overrides,
  };
}

describe("workers/reddit-live-poller (real Postgres/Redis, mocked Reddit search)", () => {
  const suffix = randomUUID();
  let matchId: string;
  const homeExternalId = `test-rlp-home-${suffix}`;
  const awayExternalId = `test-rlp-away-${suffix}`;

  beforeAll(async () => {
    const match = await upsertMatch({
      externalId: `test-rlp-match-${suffix}`,
      league: { externalId: `test-rlp-league-${suffix}`, name: "Test League", country: null, logoUrl: null },
      homeTeam: { externalId: homeExternalId, name: "Reddit Poller Home", shortName: "RPH", logoUrl: null },
      awayTeam: { externalId: awayExternalId, name: "Reddit Poller Away", shortName: "RPA", logoUrl: null },
      status: "SCHEDULED",
      homeScore: null,
      awayScore: null,
      minute: null,
      // kicked off 10 minutes ago — should be picked up and flipped to LIVE
      kickoffAt: new Date(Date.now() - 10 * 60 * 1000),
      venue: null,
    });
    matchId = match.id;
  });

  afterAll(async () => {
    await prisma.eventSocialMatch.deleteMany({ where: { event: { matchId } } });
    await prisma.socialPost.deleteMany({ where: { matchId } });
    await prisma.matchEvent.deleteMany({ where: { matchId } });
    await prisma.match.deleteMany({ where: { id: matchId } });
    await prisma.team.deleteMany({ where: { externalId: { in: [homeExternalId, awayExternalId] } } });
    await prisma.league.deleteMany({ where: { externalId: `test-rlp-league-${suffix}` } });
  });

  it("flips a SCHEDULED match to LIVE once kickoff has passed", async () => {
    goalPosts.length = 0;
    redCardPosts.length = 0;

    await pollOnce();

    const match = await prisma.match.findUniqueOrThrow({ where: { id: matchId } });
    expect(match.status).toBe("LIVE");
    expect(match.minute).toBeGreaterThanOrEqual(9);
  });

  it("ingests a detected goal, increments the score, and attaches the post as an instant highlight", async () => {
    goalPosts.length = 0;
    redCardPosts.length = 0;
    goalPosts.push(
      fakePost({
        id: `goal-${suffix}`,
        // real r/soccer "Goal Clip" title convention — bracket marks the scorer's side
        title: "Reddit Poller Home [1] - 0 Reddit Poller Away - Test Scorer 11'",
      })
    );

    await pollOnce();

    const match = await prisma.match.findUniqueOrThrow({ where: { id: matchId } });
    expect(match.homeScore).toBe(1);
    expect(match.awayScore).toBe(0);

    const event = await prisma.matchEvent.findFirst({ where: { matchId, externalId: `reddit-goal-${suffix}` } });
    expect(event).not.toBeNull();
    expect(event?.type).toBe("GOAL");
    expect(event?.playerName).toBe("Test Scorer");
    expect(event?.minute).toBe(11);

    const highlight = await prisma.eventSocialMatch.findFirst({
      where: { eventId: event!.id },
      include: { socialPost: true },
    });
    expect(highlight?.matchingMethod).toBe("DETERMINISTIC");
    expect(highlight?.score).toBe(1);
    expect(highlight?.socialPost.title).toContain("Test Scorer");
  });

  it("does not double-count the same goal post on a second poll cycle", async () => {
    // goalPosts still contains the same post from the previous test —
    // simulating Reddit's search still returning it on the next cycle
    await pollOnce();

    const match = await prisma.match.findUniqueOrThrow({ where: { id: matchId } });
    expect(match.homeScore).toBe(1); // unchanged, not 2

    const events = await prisma.matchEvent.findMany({ where: { matchId, type: "GOAL" } });
    expect(events).toHaveLength(1);
  });

  it("skips a goal post when the scoring team can't be confidently resolved", async () => {
    goalPosts.length = 0;
    redCardPosts.length = 0;
    goalPosts.push(fakePost({ id: `ambiguous-${suffix}`, title: "Unrelated team scores a wonder goal" }));

    const before = await prisma.matchEvent.count({ where: { matchId } });
    await pollOnce();
    const after = await prisma.matchEvent.count({ where: { matchId } });

    expect(after).toBe(before);
  });
});
