import { describe, it, expect } from "vitest";
import { GET as getMatches } from "@/app/api/matches/route";
import { GET as getLiveMatches } from "@/app/api/matches/live/route";

describe("matches API (real Postgres)", () => {
  it("rejects an invalid date format", async () => {
    const res = await getMatches(new Request("http://test/api/matches?date=not-a-date"));
    expect(res.status).toBe(400);
  });

  it("accepts a well-formed date and returns a matches array", async () => {
    const res = await getMatches(new Request("http://test/api/matches?date=2026-01-01"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.date).toBe("2026-01-01");
    expect(Array.isArray(body.matches)).toBe(true);
  });

  it("defaults to today when no date is given", async () => {
    const res = await getMatches(new Request("http://test/api/matches"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.date).toBe(new Date().toISOString().slice(0, 10));
  });

  it("live matches endpoint returns only LIVE/PAUSED matches", async () => {
    const res = await getLiveMatches();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.matches)).toBe(true);
    for (const match of body.matches) {
      expect(["LIVE", "PAUSED"]).toContain(match.status);
    }
  });
});
