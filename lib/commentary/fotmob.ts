import type { CommentaryProvider, CommentaryInput, Commentary } from "./provider";

/**
 * FotMob investigation (see README § Commentary Architecture for the full
 * write-up):
 *
 * FotMob's website is backed by an internal JSON API that its own frontend
 * calls (undocumented, no public developer program, no published terms for
 * third-party use). Using it would mean depending on an endpoint that:
 *   - isn't documented or versioned, so it can change or break without notice
 *   - isn't covered by any published API terms permitting third-party use
 *   - would likely require reverse-engineering request signing / headers
 *     that change over time, which drifts into "circumventing technical
 *     protections" territory this project explicitly avoids
 *
 * Conclusion: FotMob is not used as a commentary source. This provider is
 * kept as a real slot in the fallback chain (per the provider abstraction)
 * so a legitimate, documented commentary API could be dropped in here later
 * without touching any other code — but it always returns null today, and
 * the application is fully functional without it (falls through to
 * generated commentary).
 */
export const fotmobCommentaryProvider: CommentaryProvider = {
  name: "fotmob",
  async getCommentary(_input: CommentaryInput): Promise<Commentary | null> {
    return null;
  },
};
