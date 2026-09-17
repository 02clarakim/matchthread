import "dotenv/config";
import { prisma } from "../lib/db/prisma";
import { redis, redisPublisher } from "../lib/redis/client";
import { logger } from "../lib/logger";
import { fetchEspnMatch, LEAGUE_NAMES } from "../lib/sports/espn";
import { ingestEspnMatchDetail } from "../lib/sports/espn-ingest";
import { attachCommentary } from "../workers/commentary-worker";
import { waitForPendingBackgroundWork } from "../lib/sports/ingest";

/**
 * One-time (and re-runnable) backfill for the LLM commentary provider
 * (lib/commentary/llm-provider.ts):
 *
 *   1. Re-fetches each ESPN-sourced match's summary and re-runs
 *      ingestEspnMatchDetail — idempotent, so this only *adds* what didn't
 *      exist before: `sourceText` on goals/cards backfilled from matches
 *      ingested before that field existed, and substitution/VAR events
 *      that weren't ingested at all before this feature.
 *   2. Runs commentary generation for every goal/card/sub/VAR event that
 *      doesn't already have an LLM sentence. Events already on
 *      commentarySource=LLM are skipped by default — attachCommentary()
 *      overwrites unconditionally, and a transient failure (rate limit,
 *      timeout) falls through to the template, so re-running without this
 *      guard would silently downgrade already-good sentences back to the
 *      template the moment OpenAI hiccups. Pass --redo-llm to force a full
 *      re-pass anyway (e.g. after a prompt change).
 *
 *   OpenAI's per-day request cap (not the same as account balance) is real
 *   and easy to hit backfilling ~1500 events — if >15 events in a row come
 *   back non-LLM while a key is configured, this assumes the cap is hit and
 *   stops rather than grinding through guaranteed failures. Just re-run
 *   later; already-LLM events are skipped so it resumes where it left off.
 *
 *   npm run regenerate-commentary
 *   npm run regenerate-commentary -- --dry-run
 *   npm run regenerate-commentary -- --limit=10
 *   npm run regenerate-commentary -- --events-only     # skip the ESPN re-fetch, just re-run commentary
 *   npm run regenerate-commentary -- --concurrency=12  # default 8 — OpenAI calls run this many at a time
 *   npm run regenerate-commentary -- --redo-llm        # also re-generate events that already have LLM commentary
 */

const EVENT_TYPES = ["GOAL", "PENALTY_GOAL", "OWN_GOAL", "YELLOW_CARD", "RED_CARD", "SECOND_YELLOW_CARD", "SUBSTITUTION", "VAR_DECISION"] as const;

const LEAGUE_SLUG_BY_NAME = Object.fromEntries(Object.entries(LEAGUE_NAMES).map(([slug, name]) => [name, slug]));

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (!hit) return undefined;
  return hit.includes("=") ? hit.split("=").slice(1).join("=") : "true";
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const dryRun = arg("dry-run") === "true";
  const eventsOnly = arg("events-only") === "true";
  const redoLlm = arg("redo-llm") === "true";
  const limit = Number(arg("limit") ?? "500");
  const concurrency = Number(arg("concurrency") ?? "8");

  const hasKey = Boolean(process.env.OPENAI_API_KEY);
  console.log(hasKey ? "OPENAI_API_KEY set — will write LLM commentary.\n" : "OPENAI_API_KEY not set — commentary will fall back to the template (no cost, no LLM text yet).\n");

  const matches = await prisma.match.findMany({
    where: { externalId: { startsWith: "espn-" }, status: "FINISHED" },
    include: { homeTeam: true, awayTeam: true, league: true },
    take: limit,
  });
  console.log(`${matches.length} finished ESPN-sourced matches\n`);

  let reingested = 0;
  let subsAdded = 0;
  let varsAdded = 0;

  if (!eventsOnly) {
    for (const m of matches) {
      const espnEventId = m.externalId.replace(/^espn-/, "");
      const leagueSlug = LEAGUE_SLUG_BY_NAME[m.league.name] ?? "eng.1";
      if (dryRun) {
        console.log(`  · would re-ingest ${m.homeTeam.name} v ${m.awayTeam.name} (${espnEventId})`);
        continue;
      }
      try {
        const summary = await fetchEspnMatch(espnEventId, leagueSlug);
        const teamExternalIdByEspnId = new Map([
          [summary.home.espnId, m.homeTeam.externalId],
          [summary.away.espnId, m.awayTeam.externalId],
        ]);
        const { subCount, varCount } = await ingestEspnMatchDetail(m.id, espnEventId, summary, teamExternalIdByEspnId);
        reingested += 1;
        subsAdded += subCount;
        varsAdded += varCount;
      } catch (err) {
        logger.warn("regenerate_commentary_reingest_failed", { matchId: m.id, error: String(err) });
      }
      await sleep(120);
    }
    console.log(
      `\nre-ingested ${reingested}/${matches.length} matches — ${subsAdded} substitutions, ${varsAdded} VAR incidents seen ` +
        `(new ones created, existing ones left alone; sourceText backfilled onto existing goals/cards either way)\n`
    );
  }

  if (dryRun) {
    console.log("[dry-run] stopping before commentary generation.\n");
    return;
  }

  const matchIds = matches.map((m) => m.id);
  const events = await prisma.matchEvent.findMany({
    where: {
      matchId: { in: matchIds },
      type: { in: [...EVENT_TYPES] },
      ...(redoLlm ? {} : { commentarySource: { not: "LLM" } }),
    },
    select: { id: true },
  });
  const skipped = redoLlm ? 0 : await prisma.matchEvent.count({
    where: { matchId: { in: matchIds }, type: { in: [...EVENT_TYPES] }, commentarySource: "LLM" },
  });
  console.log(
    `regenerating commentary for ${events.length} events (${concurrency} at a time)` +
      (skipped ? ` — skipping ${skipped} that already have LLM commentary\n` : "\n")
  );

  let done = 0;
  let next = 0;
  let consecutiveNonLlm = 0;
  let stopped = false;

  async function worker() {
    for (;;) {
      if (stopped) return;
      const i = next++;
      if (i >= events.length) return;

      try {
        await attachCommentary(events[i].id);
        const updated = await prisma.matchEvent.findUnique({
          where: { id: events[i].id },
          select: { commentarySource: true },
        });
        if (hasKey && updated?.commentarySource !== "LLM") {
          consecutiveNonLlm += 1;
          if (consecutiveNonLlm >= 15 && !stopped) {
            stopped = true;
            console.log(
              `\nstopping early — ${consecutiveNonLlm} events in a row fell back to the template even with a key ` +
                `configured. This is almost always OpenAI's per-day request cap, not the account balance — check ` +
                `https://platform.openai.com/account/rate-limits and re-run later; already-LLM events are skipped, ` +
                `so it resumes where it left off.\n`
            );
          }
        } else {
          consecutiveNonLlm = 0;
        }
      } catch (err) {
        logger.warn("regenerate_commentary_attach_failed", { eventId: events[i].id, error: String(err) });
      }
      done += 1;
      if (done % 50 === 0) console.log(`  ...${done}/${events.length}`);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, events.length || 1) }, worker));

  const bySource = await prisma.matchEvent.groupBy({
    by: ["commentarySource"],
    where: { matchId: { in: matchIds }, type: { in: [...EVENT_TYPES] } },
    _count: true,
  });
  console.log(`\ndone — ${done} events processed. By source: ${bySource.map((b) => `${b.commentarySource}:${b._count}`).join("  ")}\n`);
}

main()
  .catch((err) => {
    logger.error("regenerate_commentary_failed", { error: String(err) });
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await waitForPendingBackgroundWork();
    await prisma.$disconnect();
    redis.disconnect();
    redisPublisher.disconnect();
  });
