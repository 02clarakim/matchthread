import { prisma } from "../db/prisma";
import { verifyGoals, type ClipInput } from "./verify-goals";
import { goalExternalId } from "../sports/espn-ingest";
import type { EspnGoal } from "../sports/espn";

/**
 * Writes one verified Reddit clip as a SocialPost + EventSocialMatch pair.
 * Shared by scripts/backfill.ts (static fetchlayer-scraped snapshots) and
 * workers/reddit-clip-poller.ts (live FetchLayer search) — both feed the
 * same verified `ClipInput` shape in here, so there's exactly one place
 * that decides how a clip is stored.
 */
export async function attachClip(
  matchId: string,
  eventId: string,
  clip: ClipInput,
  media?: { url: string; host: string }
): Promise<void> {
  const embedUrl = `https://www.redditmedia.com${clip.permalink}?ref_source=embed&ref=share&embed=true`;
  // Native Reddit video embeds inline; an external clip host (streamin.link,
  // streamff, …) can't be framed cleanly, so record its direct URL and the
  // UI offers a one-click "watch" straight to it instead of a nested card.
  const isExternalHost = Boolean(media && media.host !== "v.redd.it");
  const fields = {
    mediaUrl: embedUrl,
    mediaType: "VIDEO" as const,
    clipUrl: isExternalHost ? media!.url : null,
    clipHost: media?.host ?? null,
  };

  const socialPost = await prisma.socialPost.upsert({
    where: { source_externalId: { source: "REDDIT", externalId: clip.postId } },
    create: {
      source: "REDDIT",
      externalId: clip.postId,
      matchId,
      title: clip.title,
      body: null,
      author: clip.author,
      url: `https://www.reddit.com${clip.permalink}`,
      createdAt: new Date(clip.createdAt),
      ...fields,
    },
    update: { matchId, ...fields },
  });
  await prisma.eventSocialMatch.upsert({
    where: { eventId_socialPostId: { eventId, socialPostId: socialPost.id } },
    create: { eventId, socialPostId: socialPost.id, score: 1, matchingMethod: "DETERMINISTIC" },
    update: {},
  });
}

export interface VerifyAndAttachResult {
  attached: number;
  verified: boolean;
  discrepancy: string | null;
}

/**
 * Runs a pool of candidate clips through verifyGoals() for one match and
 * attaches whatever's safe to attach (verified, or a mismatch when
 * `force` is set) — the exact policy scripts/backfill.ts always used,
 * now shared with the automated poller.
 */
export async function verifyAndAttachClips(
  matchId: string,
  espnEventId: string,
  espnGoals: EspnGoal[],
  matchClips: ClipInput[],
  goalEventIdByExternalId: Map<string, string>,
  clipMedia: Record<string, { url: string; host: string }>,
  opts: { force?: boolean } = {}
): Promise<VerifyAndAttachResult> {
  const result = verifyGoals(espnGoals, matchClips);
  let attached = 0;
  for (const gv of result.goals) {
    const attachable = gv.status === "verified" || (gv.status === "clip-mismatch" && opts.force);
    if (!attachable || !gv.clip) continue;
    const eventId = goalEventIdByExternalId.get(goalExternalId(espnEventId, gv.espn));
    if (!eventId) continue;
    for (const clip of [gv.clip, ...gv.extraClips]) {
      await attachClip(matchId, eventId, clip, clipMedia[clip.postId]);
      attached += 1;
    }
  }
  return {
    attached,
    verified: result.verified,
    discrepancy: result.verified ? null : (result.discrepancies[0] ?? "discrepancy"),
  };
}
