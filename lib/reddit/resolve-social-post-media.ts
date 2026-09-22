import { prisma } from "../db/prisma";
import { resolveRedditPostOutbound } from "./resolve-post-media";
import { resolveClip } from "./resolve-clip";

/**
 * Two-step resolution (embed.reddit.com -> outbound URL -> direct .mp4,
 * see resolve-post-media.ts / resolve-clip.ts) for one already-attached
 * SocialPost row, persisted directly. Shared by scripts/resolve-clip-media.ts
 * (batch, for rows attached via the static fetchlayer snapshot) and
 * workers/reddit-clip-poller.ts (one row at a time, right after attaching
 * it) — exactly the same two network calls either way, no API key needed
 * for either step.
 */
export type ResolveOutcome = "native" | "inline" | "stuck";

function permalinkFromUrl(url: string): string | null {
  const m = url.match(/reddit\.com(\/r\/[^?#]+)/i);
  return m ? m[1] : null;
}

export async function resolveAndPersistClipMedia(postId: string): Promise<ResolveOutcome> {
  const p = await prisma.socialPost.findUnique({
    where: { id: postId },
    select: { id: true, url: true, clipUrl: true, clipHost: true },
  });
  if (!p) return "stuck";

  let clipUrl = p.clipUrl;
  let clipHost = p.clipHost;

  if (!clipUrl) {
    const permalink = permalinkFromUrl(p.url);
    const outbound = permalink ? await resolveRedditPostOutbound(permalink) : null;
    if (!outbound) return "stuck";
    if (outbound.isNativeVideo) {
      await prisma.socialPost.update({ where: { id: p.id }, data: { clipHost: "v.redd.it" } });
      return "native";
    }
    clipUrl = outbound.outboundUrl;
    clipHost = outbound.host;
  }

  const resolved = await resolveClip(clipUrl);
  if (!resolved) {
    await prisma.socialPost.update({ where: { id: p.id }, data: { clipUrl, clipHost } });
    return "stuck";
  }
  await prisma.socialPost.update({
    where: { id: p.id },
    data: { clipUrl, clipHost, videoUrl: resolved.videoUrl, posterUrl: resolved.posterUrl },
  });
  return "inline";
}
