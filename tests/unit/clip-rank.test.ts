import { describe, expect, it } from "vitest";
import { clipRank, byClipThenScore } from "@/lib/social/clip-rank";
import type { ApiHighlight } from "@/lib/types/api";

function sp(over: Partial<ApiHighlight["socialPost"]>): ApiHighlight["socialPost"] {
  return {
    id: "x",
    title: "t",
    url: "u",
    mediaUrl: null,
    mediaType: null,
    author: null,
    clipUrl: null,
    clipHost: null,
    videoUrl: null,
    posterUrl: null,
    ...over,
  };
}

const NATIVE = sp({ mediaType: "VIDEO", mediaUrl: "https://www.redditmedia.com/r/soccer/comments/x/?embed=true" });
const INLINE_MP4 = sp({ mediaType: "VIDEO", clipUrl: "https://streamin.link/v/x", clipHost: "streamin.link", videoUrl: "https://c-cdn.streamin.top/uploads/x.mp4" });
const LINK_ONLY = sp({ mediaType: "VIDEO", clipUrl: "https://streamff.pro/v/x", clipHost: "streamff.pro" });
const NOTHING = sp({});

describe("clipRank", () => {
  it("ranks native Reddit video best, then resolved mp4, then link-out, then nothing", () => {
    expect(clipRank(NATIVE)).toBe(0);
    expect(clipRank(INLINE_MP4)).toBe(1);
    expect(clipRank(LINK_ONLY)).toBe(2);
    expect(clipRank(NOTHING)).toBe(3);
  });
});

describe("byClipThenScore", () => {
  const hl = (socialPost: ApiHighlight["socialPost"], score: number): ApiHighlight => ({
    id: socialPost.id,
    score,
    matchingMethod: "DETERMINISTIC",
    socialPost,
    event: { id: "e" },
  });

  it("puts the self-contained clip first even when a link-out clip scored higher", () => {
    const ordered = [hl(LINK_ONLY, 1), hl(NATIVE, 0.8)].sort(byClipThenScore);
    expect(ordered[0].socialPost).toBe(NATIVE);
  });

  it("falls back to score within the same rank", () => {
    const a = hl(sp({ mediaType: "VIDEO", clipUrl: "https://streamin.link/v/a", videoUrl: "https://x/a.mp4" }), 0.5);
    const b = hl(sp({ mediaType: "VIDEO", clipUrl: "https://streamin.link/v/b", videoUrl: "https://x/b.mp4" }), 0.9);
    expect([a, b].sort(byClipThenScore)[0]).toBe(b);
  });
});
