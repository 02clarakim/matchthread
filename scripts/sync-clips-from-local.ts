import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { logger } from "../lib/logger";

/**
 * Copies already-verified Reddit clips from a local database into a
 * remote one (production), matching on the real ESPN-derived externalId
 * scheme both share — zero FetchLayer/OpenAI calls, since every clip here
 * was already searched for, verified against ESPN's own goal list, and
 * resolved to a playable video by a previous run of the real pipeline.
 * Exists because local dev accumulates real clips across a session's
 * testing/backfill work faster than a fresh production database does, and
 * there's no reason to re-spend API credits re-discovering something
 * that's already sitting in local Postgres.
 *
 * Matches by Match.externalId and MatchEvent.externalId, not by id (ids
 * are database-generated and differ between the two databases; the
 * externalId scheme is deterministic from real ESPN data, so it's stable
 * across any two databases backfilled from the same source).
 *
 *   LOCAL_DATABASE_URL=... PROD_DATABASE_URL=... npm run sync-clips-from-local
 */

async function main() {
  const localUrl = process.env.LOCAL_DATABASE_URL;
  const prodUrl = process.env.PROD_DATABASE_URL;
  if (!localUrl || !prodUrl) {
    console.error("Set both LOCAL_DATABASE_URL and PROD_DATABASE_URL.");
    process.exitCode = 1;
    return;
  }

  const local = new PrismaClient({ datasources: { db: { url: localUrl } } });
  const prod = new PrismaClient({ datasources: { db: { url: prodUrl } } });

  const localPosts = await local.socialPost.findMany({
    where: { source: "REDDIT" },
    include: { eventMatches: { include: { event: { include: { match: true } } } } },
  });

  const prodExisting = await prod.socialPost.findMany({
    where: { source: "REDDIT" },
    select: { externalId: true },
  });
  const prodExistingIds = new Set(prodExisting.map((p) => p.externalId));

  let copied = 0;
  let skippedExisting = 0;
  let skippedNoMatch = 0;
  let skippedNoEvent = 0;

  for (const post of localPosts) {
    if (prodExistingIds.has(post.externalId)) {
      skippedExisting += 1;
      continue;
    }

    // A clip can be attached to more than one goal (extraClips) — handle every link.
    for (const link of post.eventMatches) {
      const localMatch = link.event.match;
      const prodMatch = await prod.match.findUnique({ where: { externalId: localMatch.externalId } });
      if (!prodMatch) {
        skippedNoMatch += 1;
        continue;
      }

      const prodEvent = await prod.matchEvent.findFirst({
        where: { matchId: prodMatch.id, externalId: link.event.externalId },
      });
      if (!prodEvent) {
        skippedNoEvent += 1;
        continue;
      }

      const prodPost = await prod.socialPost.upsert({
        where: { source_externalId: { source: "REDDIT", externalId: post.externalId } },
        create: {
          source: "REDDIT",
          externalId: post.externalId,
          matchId: prodMatch.id,
          title: post.title,
          body: post.body,
          author: post.author,
          url: post.url,
          mediaUrl: post.mediaUrl,
          mediaType: post.mediaType,
          clipUrl: post.clipUrl,
          clipHost: post.clipHost,
          videoUrl: post.videoUrl,
          posterUrl: post.posterUrl,
          createdAt: post.createdAt,
        },
        update: {},
      });

      await prod.eventSocialMatch.upsert({
        where: { eventId_socialPostId: { eventId: prodEvent.id, socialPostId: prodPost.id } },
        create: { eventId: prodEvent.id, socialPostId: prodPost.id, score: link.score, matchingMethod: link.matchingMethod },
        update: {},
      });

      console.log(`  ✓ ${post.title}`);
      copied += 1;
    }
  }

  console.log(
    `\ndone — ${copied} clips copied, ${skippedExisting} already present, ${skippedNoMatch} had no matching production match, ${skippedNoEvent} had no matching production event`
  );
  logger.info("sync_clips_from_local_done", { copied, skippedExisting, skippedNoMatch, skippedNoEvent });

  await local.$disconnect();
  await prod.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
