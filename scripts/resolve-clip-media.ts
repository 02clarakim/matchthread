import "dotenv/config";
import { prisma } from "../lib/db/prisma";
import { redis, redisPublisher } from "../lib/redis/client";
import { logger } from "../lib/logger";
import { resolveClip } from "../lib/reddit/resolve-clip";

/**
 * Fills SocialPost.videoUrl / posterUrl for Reddit goal-clip posts that
 * link out to a mirror host, so the UI can play them inline instead of
 * showing a "watch elsewhere" link. Re-runnable; only touches rows that
 * have a clipUrl and no videoUrl yet.
 *
 *   npm run resolve-clips
 *   npm run resolve-clips -- --limit=10
 *   npm run resolve-clips -- --all      # re-resolve even rows that already have a videoUrl
 */

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (!hit) return undefined;
  return hit.includes("=") ? hit.split("=").slice(1).join("=") : "true";
}

async function main() {
  const limit = Number(arg("limit") ?? "200");
  const all = arg("all") === "true";

  const posts = await prisma.socialPost.findMany({
    where: { clipUrl: { not: null }, ...(all ? {} : { videoUrl: null }) },
    select: { id: true, clipUrl: true, clipHost: true, title: true },
    take: limit,
  });

  console.log(`resolving ${posts.length} clip${posts.length === 1 ? "" : "s"}\n`);
  let ok = 0;
  for (const p of posts) {
    const resolved = await resolveClip(p.clipUrl!);
    if (!resolved) {
      console.log(`  ✗ ${p.clipHost}   ${p.title.slice(0, 50)}`);
      logger.warn("clip_resolve_failed", { socialPostId: p.id, clipUrl: p.clipUrl });
      continue;
    }
    await prisma.socialPost.update({
      where: { id: p.id },
      data: { videoUrl: resolved.videoUrl, posterUrl: resolved.posterUrl },
    });
    ok += 1;
    console.log(`  ✓ ${resolved.videoUrl}`);
  }
  console.log(`\ndone — ${ok}/${posts.length} resolved to an inline .mp4\n`);
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
