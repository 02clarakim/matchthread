import { describe, expect, it } from "vitest";
import { verifyGoals, clipsForMatch, type ClipInput } from "@/lib/matching/verify-goals";
import type { EspnGoal } from "@/lib/sports/espn";

const ESPN_GOALS: EspnGoal[] = [
  { minute: 62, extraMinute: null, scorer: "Anthony Elanga", assist: "Amar Dedic", teamEspnId: "361", teamName: "Newcastle United", type: "GOAL", sourceText: null },
  { minute: 72, extraMinute: null, scorer: "Yoane Wissa", assist: "Nick Woltemade", teamEspnId: "361", teamName: "Newcastle United", type: "GOAL", sourceText: null },
];

function clip(over: Partial<ClipInput>): ClipInput {
  return {
    postId: "x",
    title: "Tottenham 0-[1] Newcastle - Someone 1'",
    permalink: "/r/soccer/comments/x/",
    author: "u",
    createdAt: "2026-08-29T18:00:00.000Z",
    sourceUrl: "https://v.redd.it/x",
    sourceHost: "v.redd.it",
    ...over,
  };
}

describe("clipsForMatch", () => {
  const pool = [
    clip({ postId: "a", title: "Tottenham 0 - [1] Newcastle - Anthony Elanga 62'" }),
    clip({ postId: "b", title: "Tottenham 0-[2] Newcastle United - Yoane Wissa 72'" }),
    clip({ postId: "c", title: "Nottingham Forest 0 - [2] Leeds United - James Justin 75'" }),
    clip({ postId: "d", title: "Liverpool [1] - 1 Nottingham - A. Isak 60'" }),
  ];

  it("keeps only clips naming both of the given teams, in either order", () => {
    const got = clipsForMatch(pool, "Tottenham Hotspur", "Newcastle United").map((c) => c.postId);
    expect(got.sort()).toEqual(["a", "b"]);
  });

  it("resolves nicknames/short forms via team aliases", () => {
    // "Nottingham" in the title -> "Nottingham Forest"
    const got = clipsForMatch(pool, "Liverpool", "Nottingham Forest").map((c) => c.postId);
    expect(got).toEqual(["d"]);
  });

  it("excludes a clip for a different fixture involving one shared team", () => {
    const got = clipsForMatch(pool, "Nottingham Forest", "Leeds United").map((c) => c.postId);
    expect(got).toEqual(["c"]);
  });

  // Confirmed live against a real r/soccer post ("Atleti 2 - [1] Real Madrid
  // - Toni Rudiger") that r/soccer posters commonly use "Atleti" instead of
  // the full name — this must keep matching "Atletico Madrid" specifically,
  // not just team aliases in general.
  it("resolves 'Atleti' to Atletico Madrid", () => {
    // Real title (r/soccer/comments/1wll4fp) — no minute marker at all,
    // see the verifyGoals "scorer-only fallback" test below for why that
    // still needs to resolve.
    const atletiPool = [clip({ postId: "e", title: "Atleti 2 - [1] Real Madrid -  Toni Rudiger" })];
    const got = clipsForMatch(atletiPool, "Atletico Madrid", "Real Madrid").map((c) => c.postId);
    expect(got).toEqual(["e"]);
  });
});

describe("verifyGoals", () => {
  it("verifies real r/soccer Goal Clip titles against the matching ESPN goals", () => {
    const clips: ClipInput[] = [
      clip({ postId: "1w1t1am", title: "Tottenham 0 - [1] Newcastle - Anthony Elanga 62'", sourceHost: "streamff.pro" }),
      clip({ postId: "1w1taym", title: "Tottenham 0-[2] Newcastle United - Yoane Wissa 72'", sourceHost: "v.redd.it" }),
    ];

    const result = verifyGoals(ESPN_GOALS, clips);

    expect(result.verified).toBe(true);
    expect(result.scoreConsistent).toBe(true);
    expect(result.allGoalsHaveClip).toBe(true);
    expect(result.orphanClips).toHaveLength(0);
    expect(result.goals.map((g) => g.status)).toEqual(["verified", "verified"]);
    expect(result.goals[0].clip?.postId).toBe("1w1t1am");
    expect(result.goals[1].clip?.postId).toBe("1w1taym");
  });

  it("tolerates a one-minute discrepancy but records a note", () => {
    const clips = [clip({ postId: "a", title: "Tottenham 0 - [1] Newcastle - Anthony Elanga 63'" })];
    const result = verifyGoals([ESPN_GOALS[0]], clips);
    expect(result.goals[0].status).toBe("verified");
    expect(result.goals[0].notes.join(" ")).toMatch(/off by one/);
  });

  it("flags a clip whose scorer contradicts ESPN as a mismatch, not a match", () => {
    const clips = [clip({ postId: "b", title: "Tottenham 0 - [1] Newcastle - Bruno Guimaraes 62'" })];
    const result = verifyGoals([ESPN_GOALS[0]], clips);

    expect(result.verified).toBe(false);
    expect(result.goals[0].status).toBe("clip-mismatch");
    expect(result.discrepancies.join(" ")).toMatch(/Elanga.*Guimaraes|Guimaraes.*Elanga/);
  });

  it("does not fail verification for an ESPN goal that simply has no clip", () => {
    const clips = [clip({ postId: "c", title: "Tottenham 0 - [1] Newcastle - Anthony Elanga 62'" })];
    const result = verifyGoals(ESPN_GOALS, clips); // second goal (Wissa) has no clip

    expect(result.goals[0].status).toBe("verified");
    expect(result.goals[1].status).toBe("clip-missing");
    expect(result.allGoalsHaveClip).toBe(false);
    expect(result.verified).toBe(true); // a gap is not a contradiction
  });

  it("treats a second post for the same goal as a mirror, not an orphan", () => {
    const clips = [
      clip({ postId: "m1", title: "Tottenham 0 - [1] Newcastle - Anthony Elanga 62'" }),
      clip({ postId: "m2", title: "Tottenham 0-[1] Newcastle - A. Elanga 63' (better angle)" }),
    ];
    const result = verifyGoals([ESPN_GOALS[0]], clips);

    expect(result.verified).toBe(true);
    expect(result.orphanClips).toHaveLength(0);
    expect(result.goals[0].clip?.postId).toBe("m1");
    expect(result.goals[0].extraClips.map((c) => c.postId)).toEqual(["m2"]);
  });

  it("fails verification on an orphan clip — Reddit asserting a goal ESPN doesn't list", () => {
    const clips = [
      clip({ postId: "d", title: "Tottenham 0 - [1] Newcastle - Anthony Elanga 62'" }),
      clip({ postId: "e", title: "Tottenham [1] - 2 Newcastle - Richarlison 88'" }),
    ];
    const result = verifyGoals(ESPN_GOALS, clips);

    expect(result.orphanClips.map((c) => c.postId)).toEqual(["e"]);
    expect(result.verified).toBe(false);
    expect(result.discrepancies.join(" ")).toMatch(/Richarlison/);
  });

  it("matches a real post that omits the minute by scorer surname alone", () => {
    // Real match, real titles (r/soccer/comments/1wll4fp for the Rüdiger
    // one) — genuinely has no minute marker. minutesClose() never matches
    // it in the main pass (by design), so this only succeeds via the
    // dedicated fallback pass. All 3 real goals included so the bracketed
    // "2-[1]" scoreline in the Rüdiger post (the 3rd goal) stays consistent
    // with ESPN's own count.
    const espnGoals = [
      { minute: 53, extraMinute: null, scorer: "Alejandro Grimaldo", assist: null, teamEspnId: "1068", teamName: "Atletico Madrid", type: "PENALTY_GOAL" as const, sourceText: null },
      { minute: 59, extraMinute: null, scorer: "Jonathan David", assist: null, teamEspnId: "1068", teamName: "Atletico Madrid", type: "GOAL" as const, sourceText: null },
      { minute: 89, extraMinute: null, scorer: "Antonio Rüdiger", assist: null, teamEspnId: "86", teamName: "Real Madrid", type: "GOAL" as const, sourceText: null },
    ];
    const clips = [
      clip({ postId: "grimaldo", title: "Atletico Madrid [1] - 0 Real Madrid - Alex Grimaldo (penalty) 53'" }),
      clip({ postId: "david", title: "Atletico Madrid [2] - 0 Real Madrid - Jonathan David 59'" }),
      clip({ postId: "rudiger", title: "Atleti 2 - [1] Real Madrid -  Toni Rudiger" }),
    ];

    const result = verifyGoals(espnGoals, clips);

    const rudigerGoal = result.goals.find((g) => g.espn.scorer === "Antonio Rüdiger");
    expect(rudigerGoal?.status).toBe("verified");
    expect(rudigerGoal?.clip?.postId).toBe("rudiger");
    expect(rudigerGoal?.notes.join(" ")).toMatch(/no minute/);
    expect(result.orphanClips).toHaveLength(0);
    expect(result.verified).toBe(true);
  });

  it("never lets a minute-less clip fill a gap for the wrong scorer", () => {
    const espnGoals = [{ minute: 10, extraMinute: null, scorer: "Someone Else", assist: null, teamEspnId: "1", teamName: "Home", type: "GOAL" as const, sourceText: null }];
    const clips = [clip({ postId: "x", title: "Home 1 - [0] Away -  Toni Rudiger" })];

    const result = verifyGoals(espnGoals, clips);

    expect(result.goals[0].status).toBe("clip-missing");
    expect(result.orphanClips.map((c) => c.postId)).toEqual(["x"]);
  });

  // Real bug, confirmed live: ESPN stores this player family-name-first
  // ("Lee Kang-In", the Korean convention), but the real r/soccer post
  // (r/soccer/comments/1wi55rm) uses the Western given-name-first order
  // ("Kang-in Lee") — a plain "last token = surname" comparison picks the
  // wrong fragment on ESPN's side ("in" instead of "lee"), so the two
  // never matched despite being the correct goal.
  it("matches a scorer name ESPN stores family-name-first against a real post using the Western order", () => {
    const espnGoals = [
      { minute: 54, extraMinute: null, scorer: "Lee Kang-In", assist: null, teamEspnId: "1068", teamName: "Atletico Madrid", type: "GOAL" as const, sourceText: null },
    ];
    const clips = [clip({ postId: "1wi55rm", title: "Atletico Madrid [2]-0 Osasuna - Kang-in Lee 54'" })];

    const result = verifyGoals(espnGoals, clips);

    expect(result.goals[0].status).toBe("verified");
    expect(result.goals[0].clip?.postId).toBe("1wi55rm");
  });
});
