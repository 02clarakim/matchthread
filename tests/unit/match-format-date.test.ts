import { describe, expect, it } from "vitest";
import { kickoffDateLabel } from "@/lib/match-format";

describe("kickoffDateLabel", () => {
  it("returns 'Today' for a kickoff earlier today", () => {
    const today = new Date();
    today.setHours(9, 0, 0, 0);
    expect(kickoffDateLabel(today)).toBe("Today");
  });

  it("returns 'Yesterday' for a kickoff exactly one calendar day back", () => {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    yesterday.setHours(20, 0, 0, 0);
    expect(kickoffDateLabel(yesterday)).toBe("Yesterday");
  });

  it("falls back to a 'Wed, Sep 16' style date for anything further out", () => {
    const twoWeeksAgo = new Date();
    twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 14);
    const label = kickoffDateLabel(twoWeeksAgo);
    expect(label).not.toBe("Today");
    expect(label).not.toBe("Yesterday");
    // e.g. "Wed, Sep 16" — weekday + month + day, no year
    expect(label).toMatch(/^[A-Za-z]{3}, [A-Za-z]{3} \d{1,2}$/);
  });

  it("compares calendar days, not a raw 24h difference — 11pm today and 1am tomorrow are different days", () => {
    const lateTonight = new Date();
    lateTonight.setHours(23, 30, 0, 0);
    expect(kickoffDateLabel(lateTonight)).toBe("Today");
  });
});
