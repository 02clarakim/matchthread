import type { ApiHighlight } from "@/lib/types/api";

type Clip = ApiHighlight["socialPost"];

/**
 * How "watchable right here" a clip is, lower = better. When one goal has
 * several clips (mirrors / alternate angles), the UI shows them in this
 * order so the one that just plays — no external hop, no dead frame —
 * comes first.
 *
 *  0  native Reddit video (v.redd.it) — inline, with sound
 *  1  external host resolved to a direct .mp4 — inline, with sound
 *  2  external host, link-out only (streamff / streamin / …)
 *  3  image, or nothing playable
 */
export function clipRank(sp: Clip): number {
  const nativeReddit =
    sp.clipHost === "v.redd.it" ||
    (sp.mediaType === "VIDEO" && Boolean(sp.mediaUrl?.includes("redditmedia.com")) && !sp.clipUrl && !sp.clipHost);
  if (nativeReddit) return 0;
  if (sp.videoUrl) return 1;
  if (sp.clipUrl) return 2;
  return 3;
}

/** Sort comparator: best clip first, then strongest match score. */
export function byClipThenScore(a: ApiHighlight, b: ApiHighlight): number {
  return clipRank(a.socialPost) - clipRank(b.socialPost) || b.score - a.score;
}
