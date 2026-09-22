import { describe, expect, it } from "vitest";
import { shouldRunNow } from "@/workers/reddit-clip-poller";

const window = { start: new Date("2026-09-20T11:00:00Z"), end: new Date("2026-09-20T21:00:00Z"), fixtureCount: 5 };
const POLL_INTERVAL_MS = 30 * 60 * 1000;

describe("shouldRunNow", () => {
  it("never runs on a day with no fixtures at all", () => {
    expect(shouldRunNow(null, Date.parse("2026-09-20T15:00:00Z"), null, POLL_INTERVAL_MS)).toBe(false);
  });

  it("runs immediately on the first check of the day, even inside the window", () => {
    const now = Date.parse("2026-09-20T12:00:00Z");
    expect(shouldRunNow(window, now, null, POLL_INTERVAL_MS)).toBe(true);
  });

  it("does not run before the window has started", () => {
    const now = Date.parse("2026-09-20T10:00:00Z");
    expect(shouldRunNow(window, now, null, POLL_INTERVAL_MS)).toBe(false);
  });

  it("does not run after the window has ended", () => {
    const now = Date.parse("2026-09-20T22:00:00Z");
    expect(shouldRunNow(window, now, null, POLL_INTERVAL_MS)).toBe(false);
  });

  it("does not re-run before a full interval has elapsed since the last run", () => {
    const lastRunAt = Date.parse("2026-09-20T12:00:00Z");
    const now = Date.parse("2026-09-20T12:15:00Z"); // only 15min later, interval is 30min
    expect(shouldRunNow(window, now, lastRunAt, POLL_INTERVAL_MS)).toBe(false);
  });

  it("runs again once a full interval has elapsed", () => {
    const lastRunAt = Date.parse("2026-09-20T12:00:00Z");
    const now = Date.parse("2026-09-20T12:30:00Z"); // exactly one interval later
    expect(shouldRunNow(window, now, lastRunAt, POLL_INTERVAL_MS)).toBe(true);
  });

  it("still runs once more right at window end even if due, to catch the last match's clip", () => {
    const lastRunAt = Date.parse("2026-09-20T20:30:00Z");
    const now = window.end.getTime(); // exactly at end, one interval later
    expect(shouldRunNow(window, now, lastRunAt, POLL_INTERVAL_MS)).toBe(true);
  });
});
