import { describe, expect, it, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db/prisma";
import { upsertMatch, ingestNormalizedEvent, waitForPendingBackgroundWork } from "@/lib/sports/ingest";
import type { NormalizedMatch, NormalizedEvent } from "@/lib/sports/types";

/**
 * Exercises the real ingestion pipeline against the local Postgres instance
 * (see docker-compose.yml / README § Local Setup) — no mocks. Every fixture
 * uses a random suffix so this is safe to run repeatedly and in parallel
 * with other test files without colliding with seeded demo data.
 */

const suffix = randomUUID();

function fixtureMatch(): NormalizedMatch {
  return {
    externalId: `test-match-${suffix}`,
    league: { externalId: `test-league-${suffix}`, name: "Test League", country: "Testland", logoUrl: null },
    homeTeam: { externalId: `test-home-${suffix}`, name: "Test Home FC", shortName: "THFC", logoUrl: null },
    awayTeam: { externalId: `test-away-${suffix}`, name: "Test Away FC", shortName: "TAFC", logoUrl: null },
    status: "LIVE",
    homeScore: 0,
    awayScore: 0,
    minute: 10,
    kickoffAt: new Date(),
    venue: null,
  };
}

function fixtureEvent(): NormalizedEvent {
  return {
    externalId: `test-event-${suffix}`,
    type: "GOAL",
    detail: null,
    minute: 10,
    extraMinute: null,
    teamExternalId: `test-home-${suffix}`,
    playerId: null,
    playerName: "Test Player",
    assistName: null,
    timestamp: new Date(),
  };
}

describe("event ingestion idempotency (real Postgres)", () => {
  afterAll(async () => {
    await waitForPendingBackgroundWork();
    await prisma.match.deleteMany({ where: { externalId: { contains: suffix } } });
    await prisma.team.deleteMany({ where: { externalId: { in: [`test-home-${suffix}`, `test-away-${suffix}`] } } });
    await prisma.league.deleteMany({ where: { externalId: `test-league-${suffix}` } });
  });

  it("processing the same externalId twice creates exactly one row", async () => {
    const match = await upsertMatch(fixtureMatch());

    const first = await ingestNormalizedEvent(match.id, fixtureEvent());
    const second = await ingestNormalizedEvent(match.id, fixtureEvent());

    expect(first.isNew).toBe(true);
    expect(second.isNew).toBe(false);
    expect(second.event.id).toBe(first.event.id);

    const rows = await prisma.matchEvent.findMany({
      where: { matchId: match.id, externalId: `test-event-${suffix}` },
    });
    expect(rows).toHaveLength(1);
  });

  it("the same goal from a different source / externalId is deduped, not doubled", async () => {
    const match = await upsertMatch({ ...fixtureMatch(), externalId: `test-match-b-${suffix}` });

    // Same goal (30', same scorer), re-ingested by another source under a
    // different externalId scheme, with the name written slightly differently.
    const espn = await ingestNormalizedEvent(match.id, {
      ...fixtureEvent(),
      externalId: `espn-${suffix}-goal-30-watkins`,
      minute: 30,
      playerName: "Ollie Watkins",
    });
    const mirror = await ingestNormalizedEvent(match.id, {
      ...fixtureEvent(),
      externalId: `reddit-abc123-${suffix}`,
      minute: 30,
      playerName: "O. Watkins",
    });

    expect(mirror.isNew).toBe(false);
    expect(mirror.event.id).toBe(espn.event.id);

    const goals = await prisma.matchEvent.findMany({ where: { matchId: match.id, type: "GOAL" } });
    expect(goals).toHaveLength(1);

    await prisma.matchEvent.deleteMany({ where: { matchId: match.id } });
    await prisma.match.delete({ where: { id: match.id } });
  });

  it("keeps a quick brace — same player scoring again a minute later — as two goals", async () => {
    const match = await upsertMatch({ ...fixtureMatch(), externalId: `test-match-c-${suffix}` });

    await ingestNormalizedEvent(match.id, {
      ...fixtureEvent(),
      externalId: `g1-${suffix}`,
      minute: 30,
      playerName: "Jack Hinshelwood",
    });
    const second = await ingestNormalizedEvent(match.id, {
      ...fixtureEvent(),
      externalId: `g2-${suffix}`,
      minute: 31,
      playerName: "Jack Hinshelwood",
    });

    expect(second.isNew).toBe(true);
    const goals = await prisma.matchEvent.findMany({ where: { matchId: match.id, type: "GOAL" } });
    expect(goals).toHaveLength(2);

    await prisma.matchEvent.deleteMany({ where: { matchId: match.id } });
    await prisma.match.delete({ where: { id: match.id } });
  });

  it("upserting the same match externalId twice does not create a duplicate match", async () => {
    const first = await upsertMatch(fixtureMatch());
    const second = await upsertMatch({ ...fixtureMatch(), homeScore: 1 });

    expect(second.id).toBe(first.id);
    expect(second.homeScore).toBe(1);

    const rows = await prisma.match.findMany({ where: { externalId: `test-match-${suffix}` } });
    expect(rows).toHaveLength(1);
  });
});
