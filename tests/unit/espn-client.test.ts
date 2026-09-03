import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { normalizeEspnSummary, parseEspnClock, mapEspnStatus } from "@/lib/sports/espn";

// Captured from site.api.espn.com/.../summary?event=401879312 on 2026-09-03,
// trimmed to the fields lib/sports/espn.ts reads.
const summary = JSON.parse(
  readFileSync(resolve(__dirname, "../fixtures/espn-summary-tot-new.json"), "utf8")
);

describe("parseEspnClock", () => {
  it("parses a plain minute", () => {
    expect(parseEspnClock("62'")).toEqual({ minute: 62, extraMinute: null });
  });

  it("parses stoppage time", () => {
    expect(parseEspnClock("90'+5'")).toEqual({ minute: 90, extraMinute: 5 });
    expect(parseEspnClock("45+2'")).toEqual({ minute: 45, extraMinute: 2 });
  });

  it("rejects junk and out-of-range values", () => {
    expect(parseEspnClock(undefined)).toBeNull();
    expect(parseEspnClock("Kickoff")).toBeNull();
    expect(parseEspnClock("200'")).toBeNull();
  });
});

describe("mapEspnStatus", () => {
  it("maps ESPN status names onto our MatchStatus", () => {
    expect(mapEspnStatus("STATUS_SCHEDULED")).toBe("SCHEDULED");
    expect(mapEspnStatus("STATUS_FIRST_HALF")).toBe("LIVE");
    expect(mapEspnStatus("STATUS_SECOND_HALF")).toBe("LIVE");
    expect(mapEspnStatus("STATUS_HALFTIME")).toBe("PAUSED");
    expect(mapEspnStatus("STATUS_FULL_TIME")).toBe("FINISHED");
    expect(mapEspnStatus("STATUS_POSTPONED")).toBe("POSTPONED");
    expect(mapEspnStatus("STATUS_SOMETHING_NEW")).toBe("LIVE"); // unknown in-play -> LIVE
  });
});

describe("normalizeEspnSummary", () => {
  const match = normalizeEspnSummary(summary);

  it("reads the final score and home/away designation", () => {
    expect(match.home.name).toBe("Tottenham Hotspur");
    expect(match.away.name).toBe("Newcastle United");
    expect(match.home.score).toBe(0);
    expect(match.away.score).toBe(2);
    expect(match.completed).toBe(true);
    expect(match.venue).toBe("Tottenham Hotspur Stadium");
  });

  it("extracts only the goals from keyEvents, in order, with scorer + assist", () => {
    expect(match.goals).toHaveLength(2);
    expect(match.goals[0]).toMatchObject({
      minute: 62,
      extraMinute: null,
      scorer: "Anthony Elanga",
      assist: "Amar Dedic",
      teamName: "Newcastle United",
      type: "GOAL",
    });
    expect(match.goals[1]).toMatchObject({
      minute: 72,
      scorer: "Yoane Wissa",
      assist: "Nick Woltemade",
      teamName: "Newcastle United",
      type: "GOAL",
    });
  });

  it("extracts bookings as cards, not goals", () => {
    expect(match.cards.length).toBeGreaterThanOrEqual(3);
    expect(match.cards.every((c) => c.type === "YELLOW_CARD")).toBe(true);
    expect(match.cards[0]).toMatchObject({ minute: 3, player: "Micky van de Ven", teamName: "Tottenham Hotspur" });
    expect(match.cards.map((c) => c.player)).toContain("Sven Botman");
  });

  it("does not pick up cards, subs, or period markers as goals", () => {
    expect(match.goals.every((g) => g.scorer)).toBe(true);
  });
});
