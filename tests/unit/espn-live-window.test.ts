import { describe, expect, it } from "vitest";
import { computeWindowFromKickoffs, isInsideWindow } from "@/workers/espn-live-poller";

describe("computeWindowFromKickoffs", () => {
  it("returns null for no fixtures — most days have none", () => {
    expect(computeWindowFromKickoffs([])).toBeNull();
  });

  it("pads a single kickoff by 5min before / 130min after", () => {
    const kickoff = new Date("2026-09-20T15:00:00Z");
    const window = computeWindowFromKickoffs([kickoff]);
    expect(window?.start.toISOString()).toBe("2026-09-20T14:55:00.000Z");
    expect(window?.end.toISOString()).toBe("2026-09-20T17:10:00.000Z");
    expect(window?.fixtureCount).toBe(1);
  });

  it("takes the union of the earliest and latest kickoff across a full matchday, not the last one only", () => {
    const kickoffs = [
      new Date("2026-09-20T19:00:00Z"), // La Liga late kickoff
      new Date("2026-09-20T11:00:00Z"), // PL early kickoff
      new Date("2026-09-20T14:00:00Z"),
    ];
    const window = computeWindowFromKickoffs(kickoffs);
    expect(window?.start.toISOString()).toBe("2026-09-20T10:55:00.000Z");
    expect(window?.end.toISOString()).toBe("2026-09-20T21:10:00.000Z");
    expect(window?.fixtureCount).toBe(3);
  });
});

describe("isInsideWindow", () => {
  // isInsideWindow reads the real clock, so every case here is built relative
  // to Date.now() rather than a fixed calendar date.
  it("is false when there's no window at all (a non-match day)", () => {
    expect(isInsideWindow(null)).toBe(false);
  });

  it("is false for a window entirely in the past or entirely in the future", () => {
    const past = { start: new Date(Date.now() - 60_000_000), end: new Date(Date.now() - 30_000_000), fixtureCount: 1 };
    const future = { start: new Date(Date.now() + 30_000_000), end: new Date(Date.now() + 60_000_000), fixtureCount: 1 };
    expect(isInsideWindow(past)).toBe(false);
    expect(isInsideWindow(future)).toBe(false);
  });

  it("is true for a window that brackets right now", () => {
    const now = { start: new Date(Date.now() - 60_000), end: new Date(Date.now() + 60_000), fixtureCount: 1 };
    expect(isInsideWindow(now)).toBe(true);
  });
});
