import "dotenv/config";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { prisma } from "../lib/db/prisma";
import { redis, redisPublisher } from "../lib/redis/client";
import { logger } from "../lib/logger";
import { fetchEspnScoreboard, fetchEspnMatch, isLeagueFixture } from "../lib/sports/espn";
import { EspnResolver } from "../lib/sports/espn-resolve";
import { upsertEspnMatch, ingestEspnMatchDetail } from "../lib/sports/espn-ingest";
import { waitForPendingBackgroundWork } from "../lib/sports/ingest";
import { clipsForMatch, type ClipInput } from "../lib/matching/verify-goals";
import { verifyAndAttachClips } from "../lib/matching/attach-clip";

/**
 * On-demand backfill of finished + upcoming fixtures for whole leagues,
 * straight from ESPN's free scoreboard API (no key). Optionally attaches
 * verified r/soccer goal clips from the snapshots in data/reddit-clips/.
 *
 *   npm run backfill                          # eng.1,esp.1 · past 35d + next 21d
 *   npm run backfill -- --leagues=eng.1
 *   npm run backfill -- --past=45 --future=30
 *   npm run backfill -- --clips              # + attach Reddit goal clips
 *   npm run backfill -- --dry-run            # fetch only, write nothing
 *   npm run backfill -- --clips --force      # attach clips even if a match fails verification
 */

function arg(name: string, fallback?: string): string | undefined {
  const hit = process.argv.find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (!hit) return fallback;
  return hit.includes("=") ? hit.split("=").slice(1).join("=") : "true";
}

function yyyymmdd(d: Date): string {
  return d.toISOString().slice(0, 10).replace(/-/g, "");
}

/**
 * ESPN's multi-day range query (`dates=YYYYMMDD-YYYYMMDD`) started
 * returning 400 for any span (even 2 days) as of 2026-09-21 — confirmed by
 * hand against the live API. Loop single-day calls instead; slower, but
 * each date is a call this endpoint still actually accepts.
 */
async function fetchRangeByDay(league: string, from: Date, to: Date) {
  const out: Awaited<ReturnType<typeof fetchEspnScoreboard>> = [];
  for (let d = new Date(from); d <= to; d = new Date(d.getTime() + 86_400_000)) {
    try {
      out.push(...(await fetchEspnScoreboard(league, yyyymmdd(d))));
    } catch (err) {
      logger.warn("backfill_day_fetch_failed", { league, date: yyyymmdd(d), error: String(err) });
    }
    await sleep(80);
  }
  return out;
}

interface ClipSnapshot {
  league: string;
  label?: string;
  clips: Array<Pick<ClipInput, "postId" | "title" | "permalink" | "author" | "createdAt">>;
}

function loadClipSnapshots(): ClipSnapshot[] {
  const dir = resolve(process.cwd(), "data/reddit-clips");
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => JSON.parse(readFileSync(resolve(dir, f), "utf8")) as ClipSnapshot);
}

function toClipInput(c: ClipSnapshot["clips"][number]): ClipInput {
  return { ...c, sourceUrl: `https://www.reddit.com${c.permalink}`, sourceHost: "reddit" };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface ClipMedia {
  posts: Record<string, { url: string; host: string }>;
}

function loadClipMedia(): Record<string, { url: string; host: string }> {
  try {
    const raw = readFileSync(resolve(process.cwd(), "data/reddit-clips/clip-media.json"), "utf8");
    return (JSON.parse(raw) as ClipMedia).posts ?? {};
  } catch {
    return {};
  }
}

async function main() {
  const leagues = (arg("leagues", "eng.1,esp.1") as string).split(",").map((s) => s.trim());
  const past = Number(arg("past", "35"));
  const future = Number(arg("future", "21"));
  const withClips = arg("clips") === "true";
  const dryRun = arg("dry-run") === "true";
  const force = arg("force") === "true";
  const summaryCap = Number(arg("limit-summaries", "80"));

  const now = new Date();
  const from = new Date(now.getTime() - past * 86_400_000);
  const to = new Date(now.getTime() + future * 86_400_000);

  const resolver = new EspnResolver(prisma);
  const clipSnapshots = withClips ? loadClipSnapshots() : [];
  const clipMedia = withClips ? loadClipMedia() : {};
  logger.info("backfill_started", {
    leagues: leagues.join(","),
    from: yyyymmdd(from),
    to: yyyymmdd(to),
    withClips,
    dryRun,
  });

  let summaryBudget = summaryCap;
  const tally = { matches: 0, scheduled: 0, finished: 0, goals: 0, cards: 0, subs: 0, vars: 0, clipsAttached: 0, clipFailures: 0 };

  for (const league of leagues) {
    const fixtures = (await fetchRangeByDay(league, from, to)).filter(isLeagueFixture);
    const leagueClips = clipSnapshots.filter((s) => s.league === league).flatMap((s) => s.clips.map(toClipInput));
    console.log(`\n=== ${league}  (${fixtures.length} fixtures, ${leagueClips.length} clip candidates) ===`);

    for (const sb of fixtures) {
      tally.matches += 1;
      const line = `${sb.kickoffAt.toISOString().slice(0, 10)}  ${sb.status.padEnd(9)}  ${sb.home.name} ${sb.home.score ?? "-"}-${sb.away.score ?? "-"} ${sb.away.name}`;

      if (dryRun) {
        console.log(`  · ${line}`);
        if (sb.status === "SCHEDULED") tally.scheduled += 1;
        else if (sb.status === "FINISHED") tally.finished += 1;
        continue;
      }

      const m = await upsertEspnMatch(resolver, sb);

      const wantsDetail = sb.status === "FINISHED" || sb.status === "PAUSED" || sb.status === "LIVE";
      if (!wantsDetail) {
        tally.scheduled += 1;
        console.log(`  · ${line}`);
        continue;
      }
      tally.finished += sb.status === "FINISHED" ? 1 : 0;

      if (summaryBudget <= 0) {
        console.log(`  · ${line}   (summary budget exhausted — score only)`);
        continue;
      }
      summaryBudget -= 1;

      const summary = await fetchEspnMatch(sb.espnEventId, league);
      const { goalEventIdByExternalId, goalCount, cardCount, subCount, varCount } = await ingestEspnMatchDetail(
        m.matchId,
        sb.espnEventId,
        summary,
        m.teamExternalIdByEspnId
      );
      tally.goals += goalCount;
      tally.cards += cardCount;
      tally.subs += subCount;
      tally.vars += varCount;

      let clipNote = "";
      if (withClips && leagueClips.length && sb.status === "FINISHED") {
        const matchClips = clipsForMatch(leagueClips, m.homeTeamName, m.awayTeamName);
        if (matchClips.length) {
          // Attach clips that agree with ESPN. A clip that *contradicts* ESPN
          // (wrong scorer near the right minute) is only attached with --force;
          // its discrepancy is always reported.
          const { attached, verified, discrepancy } = await verifyAndAttachClips(
            m.matchId,
            sb.espnEventId,
            summary.goals,
            matchClips,
            goalEventIdByExternalId,
            clipMedia,
            { force }
          );
          tally.clipsAttached += attached;
          if (!verified) {
            tally.clipFailures += 1;
            clipNote = `   ▶ ${attached}/${summary.goals.length} clips · ⚠ ${discrepancy}`;
          } else {
            clipNote = `   ▶ ${attached}/${summary.goals.length} clips`;
          }
        }
      }

      console.log(`  · ${line}   [${goalCount}g ${cardCount}c ${subCount}s ${varCount}v]${clipNote}`);
      await sleep(120);
    }
  }

  if (!dryRun) await waitForPendingBackgroundWork();
  console.log(
    `\ndone — ${tally.matches} matches (${tally.finished} finished, ${tally.scheduled} upcoming), ` +
      `${tally.goals} goals, ${tally.cards} cards, ${tally.subs} subs, ${tally.vars} VAR, ${tally.clipsAttached} clips attached` +
      (tally.clipFailures ? `, ${tally.clipFailures} matches with unverified clips` : "") +
      `\n`
  );
}

main()
  .catch((err) => {
    logger.error("backfill_failed", { error: String(err) });
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await waitForPendingBackgroundWork();
    await prisma.$disconnect();
    redis.disconnect();
    redisPublisher.disconnect();
  });
