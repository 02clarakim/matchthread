import "dotenv/config";
import type { MatchEventType } from "@prisma/client";
import { prisma } from "../lib/db/prisma";
import { redis, redisPublisher } from "../lib/redis/client";
import { logger } from "../lib/logger";

/**
 * One-off repair: collapse duplicate goal / dismissal MatchEvents that
 * predate the semantic dedup in lib/sports/ingest.ts (e.g. rows ingested
 * under two different externalId schemes, or by two pollers).
 *
 * Strict, on purpose — same match + team + goal-or-card class + EXACT
 * minute + same scorer surname. A quick brace (same player, a minute
 * apart) is left alone. Clips from the losers are re-pointed at the
 * keeper, then the losers are deleted.
 *
 *   npm run dedupe-events            # report + fix
 *   npm run dedupe-events -- --dry   # report only
 */

const GOAL_TYPES: MatchEventType[] = ["GOAL", "PENALTY_GOAL", "OWN_GOAL"];
const CARD_TYPES: MatchEventType[] = ["RED_CARD", "SECOND_YELLOW_CARD"];

function classOf(type: MatchEventType): "goal" | "card" | null {
  if (GOAL_TYPES.includes(type)) return "goal";
  if (CARD_TYPES.includes(type)) return "card";
  return null;
}

function surname(name: string | null): string {
  if (!name) return "";
  const toks = name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter((t) => t.length > 1);
  return toks[toks.length - 1] ?? "";
}

async function main() {
  const dry = process.argv.includes("--dry");

  const events = await prisma.matchEvent.findMany({
    where: { type: { in: [...GOAL_TYPES, ...CARD_TYPES] } },
    include: { _count: { select: { socialMatches: true } }, match: { include: { homeTeam: true, awayTeam: true } } },
    orderBy: { createdAt: "asc" },
  });

  const buckets = new Map<string, typeof events>();
  for (const e of events) {
    const cls = classOf(e.type);
    if (!cls || !e.teamId) continue;
    const totalMinute = e.minute + (e.extraMinute ?? 0);
    const k = `${e.matchId}|${e.teamId}|${cls}|${totalMinute}|${surname(e.playerName)}`;
    const bucket = buckets.get(k) ?? [];
    bucket.push(e);
    buckets.set(k, bucket);
  }

  let groups = 0;
  let removed = 0;

  for (const cluster of buckets.values()) {
    if (cluster.length < 2) continue;
    groups += 1;

    // keeper: current fact-derived externalId scheme, then most clips, then
    // has a scorer name, then oldest row
    const canonical = (e: (typeof cluster)[number]) => (/-(goal|card)-\d+(\+\d+)?-/.test(e.externalId) ? 1 : 0);
    const keeper = [...cluster].sort(
      (a, b) =>
        canonical(b) - canonical(a) ||
        b._count.socialMatches - a._count.socialMatches ||
        Number(Boolean(b.playerName)) - Number(Boolean(a.playerName)) ||
        a.createdAt.getTime() - b.createdAt.getTime()
    )[0];
    const losers = cluster.filter((e) => e.id !== keeper.id);
    const m = keeper.match;
    console.log(
      `${m.homeTeam.name} v ${m.awayTeam.name}  ${keeper.minute}' ${keeper.type} ${keeper.playerName ?? "?"}  ` +
        `keep ${keeper.externalId}  drop ${losers.map((l) => l.externalId).join(", ")}`
    );

    if (dry) continue;

    for (const loser of losers) {
      const links = await prisma.eventSocialMatch.findMany({ where: { eventId: loser.id } });
      for (const link of links) {
        await prisma.eventSocialMatch.upsert({
          where: { eventId_socialPostId: { eventId: keeper.id, socialPostId: link.socialPostId } },
          create: {
            eventId: keeper.id,
            socialPostId: link.socialPostId,
            score: link.score,
            matchingMethod: link.matchingMethod,
          },
          update: {},
        });
      }
      await prisma.eventSocialMatch.deleteMany({ where: { eventId: loser.id } });
      await prisma.matchEvent.delete({ where: { id: loser.id } });
      removed += 1;
    }
  }

  console.log(`\n${dry ? "[dry] " : ""}${groups} duplicate group(s), ${dry ? "would remove" : "removed"} ${removed} event(s)\n`);
  logger.info("dedupe_events_done", { groups, removed, dry });
}

main()
  .catch((err) => {
    logger.error("dedupe_events_failed", { error: String(err) });
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    redis?.disconnect();
    redisPublisher?.disconnect();
  });
