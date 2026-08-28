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
    await prisma.match.deleteMany({ where: { externalId: `test-match-${suffix}` } });
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

  it("upserting the same match externalId twice does not create a duplicate match", async () => {
    const first = await upsertMatch(fixtureMatch());
    const second = await upsertMatch({ ...fixtureMatch(), homeScore: 1 });

    expect(second.id).toBe(first.id);
    expect(second.homeScore).toBe(1);

    const rows = await prisma.match.findMany({ where: { externalId: `test-match-${suffix}` } });
    expect(rows).toHaveLength(1);
  });
});
