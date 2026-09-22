import "dotenv/config";
import { prisma } from "../lib/db/prisma";
import { redis, redisPublisher } from "../lib/redis/client";
import { logger } from "../lib/logger";
import { resolveAndPersistClipMedia } from "../lib/reddit/resolve-social-post-media";

/**
 * Makes every attached r/soccer goal clip playable inline:
 *
 *   1. embed.reddit.com  -> the post's outbound URL (v.redd.it or a mirror
 *      host). Native video keeps the Reddit player; a mirror host is
 *      recorded as clipUrl / clipHost.
 *   2. the mirror watch page -> the direct .mp4 (SocialPost.videoUrl), so
 *      the UI plays a <video> instead of a dead Reddit link card.
 *
 * All plain fetch — no API key, no fetchlayer. Re-runnable; only touches
 * rows that still need a step.
 *
 *   npm run resolve-clips
 *   npm run resolve-clips -- --limit=50
 *   npm run resolve-clips -- --all       # redo rows already resolved
 */

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (!hit) return undefined;
  return hit.includes("=") ? hit.split("=").slice(1).join("=") : "true";
}

async function main() {
  const limit = Number(arg("limit") ?? "300");
  const all = arg("all") === "true";

  const posts = await prisma.socialPost.findMany({
    where: { source: "REDDIT", ...(all ? {} : { videoUrl: null, clipHost: { not: "v.redd.it" } }) },
    select: { id: true, title: true },
    take: limit,
  });

  console.log(`checking ${posts.length} clip${posts.length === 1 ? "" : "s"}\n`);
  let native = 0;
  let inline = 0;
  let stuck = 0;

  for (const p of posts) {
    const outcome = await resolveAndPersistClipMedia(p.id);
    if (outcome === "native") {
      native += 1;
      console.log(`  ● native (v.redd.it)          ${p.title.slice(0, 52)}`);
    } else if (outcome === "inline") {
      inline += 1;
      console.log(`  ✓ resolved to inline .mp4     ${p.title.slice(0, 52)}`);
    } else {
      stuck += 1;
      console.log(`  ✗ couldn't resolve            ${p.title.slice(0, 52)}`);
    }
  }

  console.log(`\ndone — ${inline} inline .mp4, ${native} native Reddit video, ${stuck} still link-only\n`);
  logger.info("resolve_clip_media_done", { inline, native, stuck, checked: posts.length });
}

main()
  .catch((err) => {
    logger.error("resolve_clip_media_failed", { error: String(err) });
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    redis.disconnect();
    redisPublisher.disconnect();
  });
