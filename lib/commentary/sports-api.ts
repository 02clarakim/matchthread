import type { CommentaryProvider, CommentaryInput, Commentary } from "./provider";
import { normalizeCommentaryText } from "./normalizer";

/**
 * First choice in the fallback chain: use whatever textual detail the
 * sports data provider already gave us in the raw event payload (e.g. a
 * "Yellow card - Foul by X" style detail string). football-data.org's free
 * tier does not expose a dedicated live-commentary/ticker feed, but some
 * event payloads do carry a short free-text `detail` field alongside the
 * structured type/minute/player fields — when present, that's a genuine
 * "official" description rather than something we invented, so it's worth
 * preferring over the generated template.
 *
 * If a future/paid provider exposes a real commentary field, wire it in
 * here — the rest of the app only depends on the CommentaryProvider
 * interface, not on this provider's internals.
 */
export const sportsApiCommentaryProvider: CommentaryProvider = {
  name: "sports-api",
  async getCommentary(input: CommentaryInput): Promise<Commentary | null> {
    const text = normalizeCommentaryText(input.detail);
    if (!text) return null;
    // A bare detail string like "Foul" isn't a real sentence — not worth
    // surfacing as "commentary" over the generated template.
    if (text.split(" ").length < 4) return null;
    return { text, source: "SPORTS_API" };
  },
};
