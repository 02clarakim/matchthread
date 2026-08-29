import "dotenv/config";
import { prisma } from "../lib/db/prisma";
import { redis, redisPublisher } from "../lib/redis/client";
import { upsertMatch, ingestNormalizedEvent, waitForPendingBackgroundWork } from "../lib/sports/ingest";
import { processEventMatching } from "../workers/event-processor";
import { logger } from "../lib/logger";
import type { MatchEventType } from "@prisma/client";
import type { NormalizedEvent } from "../lib/sports/types";

/**
 * Drives a brand-new live event through the *real* pipeline — the same
 * lib/sports/ingest.ts functions the sports-poller calls — so this proves
 * the actual architecture (DB → Redis → WebSocket → browser) rather than
 * pushing fake state into React. Run this while `npm run dev` and
 * `npm run ws-server` are up and a match page is open to watch it arrive
 * live, no refresh needed.
 *
 * Usage:
 *   npm run simulate-event                              goal for Arsenal vs Chelsea (default)
 *   npm run simulate-event -- --type=red                 a red card instead
 *   npm run simulate-event -- --type=var                 a VAR decision
 *   npm run simulate-event -- --match=seed-match-atletico-sevilla
 *                                                         target any seeded match by externalId
 *   npm run simulate-event -- --replay                   re-sends the last simulated event's
 *                                                         exact externalId, to demonstrate
 *                                                         that duplicate ingestion is a no-op
 */

const DEFAULT_MATCH_EXTERNAL_ID = "seed-match-arsenal-chelsea";

type ScenarioType = "goal" | "yellow" | "red" | "var" | "sub";

interface Scenario {
  type: MatchEventType;
  detail: string | null;
  playerName: string;
  assistName: string | null;
  scoreDelta: { home: number; away: number };
}

/**
 * A small pool of plausible player names per seeded team, so a simulated
 * event on any match (not just the default Arsenal vs Chelsea one) reads
 * as realistic rather than showing an Arsenal player scoring for Sevilla.
 * Purely illustrative — see README § Demo Mode.
 */
const TEAM_ROSTERS: Record<string, string[]> = {
  "seed-team-arsenal": ["Kai Havertz", "Declan Rice", "William Saliba"],
  "seed-team-chelsea": ["Cole Palmer", "Enzo Fernández", "Moisés Caicedo"],
  "seed-team-liverpool": ["Mohamed Salah", "Darwin Núñez", "Virgil van Dijk"],
  "seed-team-man-city": ["Erling Haaland", "Kevin De Bruyne", "Phil Foden"],
  "seed-team-man-utd": ["Bruno Fernandes", "Marcus Rashford", "Rasmus Højlund"],
  "seed-team-newcastle": ["Alexander Isak", "Anthony Gordon", "Bruno Guimarães"],
  "seed-team-tottenham": ["Son Heung-min", "James Maddison", "Dejan Kulusevski"],
  "seed-team-aston-villa": ["Ollie Watkins", "Morgan Rogers", "Youri Tielemans"],
  "seed-team-barcelona": ["Robert Lewandowski", "Pedri", "Raphinha"],
  "seed-team-real-madrid": ["Jude Bellingham", "Vinícius Júnior", "Rodrygo"],
  "seed-team-atletico-madrid": ["Antoine Griezmann", "Julián Álvarez", "Rodrigo De Paul"],
  "seed-team-sevilla": ["Isaac Romero", "Dodi Lukébakio", "Saúl Ñíguez"],
  "seed-team-bayern-munich": ["Harry Kane", "Jamal Musiala", "Leroy Sané"],
  "seed-team-dortmund": ["Karim Adeyemi", "Julian Brandt", "Serhou Guirassy"],
};

const GENERIC_ROSTER = ["Home Player", "Home Teammate", "Home Defender"];

function rosterFor(teamExternalId: string): string[] {
  return TEAM_ROSTERS[teamExternalId] ?? GENERIC_ROSTER;
}

function buildScenario(type: ScenarioType, homeTeamExternalId: string): Scenario {
  const [scorer, assist, thirdPlayer] = rosterFor(homeTeamExternalId);

  switch (type) {
    case "goal":
      return { type: "GOAL", detail: null, playerName: scorer, assistName: assist, scoreDelta: { home: 1, away: 0 } };
    case "yellow":
      return { type: "YELLOW_CARD", detail: "Foul", playerName: assist, assistName: null, scoreDelta: { home: 0, away: 0 } };
    case "red":
      return {
        type: "RED_CARD",
        detail: "Serious foul play",
        playerName: thirdPlayer,
        assistName: null,
        scoreDelta: { home: 0, away: 0 },
      };
    case "var":
      return {
        type: "VAR_DECISION",
        detail: "Goal disallowed for offside",
        playerName: scorer,
        assistName: null,
        scoreDelta: { home: 0, away: 0 },
      };
    case "sub":
      return {
        type: "SUBSTITUTION",
        detail: null,
        playerName: thirdPlayer,
        assistName: scorer,
        scoreDelta: { home: 0, away: 0 },
      };
  }
}

// A couple of Reddit-style candidate posts, keyed by scenario, so a fresh
// event also gets a fresh community highlight — same seeded-data approach
// as scripts/seed.ts (source: SEED, no live Reddit call needed to demo this).
function buildCandidatePosts(scenario: Scenario, minute: number, opponentName: string) {
  const stamp = Date.now();
  return [
    {
      externalId: `simulated-post-${stamp}-1`,
      title: `[${scenario.type === "GOAL" ? "Goal" : scenario.type}] ${scenario.playerName} does it again, ${minute}'`,
      body: null,
      author: "live_thread_bot",
      url: `https://www.reddit.com/r/soccer/comments/simulated-${stamp}-1`,
      mediaUrl: null,
      createdAt: new Date(),
    },
    {
      externalId: `simulated-post-${stamp}-2`,
      title: `${opponentName} fans are not happy right now`,
      body: `${scenario.playerName} has been unplayable today`,
      author: "matchday_takes",
      url: `https://www.reddit.com/r/soccer/comments/simulated-${stamp}-2`,
      mediaUrl: null,
      createdAt: new Date(),
    },
  ];
}

function parseArgs() {
  const args = process.argv.slice(2);
  const typeArg = args.find((a) => a.startsWith("--type="))?.split("=")[1] as ScenarioType | undefined;
  const matchArg = args.find((a) => a.startsWith("--match="))?.split("=")[1];
  const replay = args.includes("--replay");
  return { type: typeArg ?? "goal", match: matchArg ?? DEFAULT_MATCH_EXTERNAL_ID, replay };
}

async function runReplay(matchExternalId: string) {
  const match = await prisma.match.findUniqueOrThrow({ where: { externalId: matchExternalId } });
  const lastSimulated = await prisma.matchEvent.findFirst({
    where: { matchId: match.id, externalId: { startsWith: "simulated-" } },
    orderBy: { createdAt: "desc" },
  });

  if (!lastSimulated) {
    console.log("No previously simulated event found to replay — run without --replay first.");
    return;
  }

  const before = await prisma.matchEvent.count({ where: { matchId: match.id } });

  const { isNew } = await ingestNormalizedEvent(match.id, {
    externalId: lastSimulated.externalId,
    type: lastSimulated.type,
    detail: lastSimulated.detail,
    minute: lastSimulated.minute,
    extraMinute: lastSimulated.extraMinute,
    teamExternalId: null, // re-ingest doesn't need to re-resolve team; existing row already has it
    playerId: lastSimulated.playerId,
    playerName: lastSimulated.playerName,
    assistName: lastSimulated.assistName,
    timestamp: lastSimulated.timestamp,
  });

  const after = await prisma.matchEvent.count({ where: { matchId: match.id } });

  console.log(
    `\nReplayed externalId "${lastSimulated.externalId}": isNew=${isNew}, event count before=${before} after=${after}.`
  );
  console.log(isNew ? "Unexpected: a duplicate was created." : "Idempotency held — no duplicate was created.\n");
}

async function runNewEvent(matchExternalId: string, scenarioType: ScenarioType) {
  const match = await prisma.match.findUnique({
    where: { externalId: matchExternalId },
    include: { homeTeam: true, awayTeam: true, league: true },
  });

  if (!match) {
    console.error(`Match "${matchExternalId}" not found — run "npm run seed" first, or check the externalId.`);
    process.exitCode = 1;
    return;
  }

  const scenario = buildScenario(scenarioType, match.homeTeam.externalId);
  const minute = Math.min(90, (match.minute ?? 60) + Math.floor(Math.random() * 5) + 1);

  const updatedMatch = await upsertMatch({
    externalId: match.externalId,
    league: {
      externalId: match.league.externalId,
      name: match.league.name,
      country: match.league.country,
      logoUrl: match.league.logoUrl,
    },
    homeTeam: {
      externalId: match.homeTeam.externalId,
      name: match.homeTeam.name,
      shortName: match.homeTeam.shortName,
      logoUrl: match.homeTeam.logoUrl,
    },
    awayTeam: {
      externalId: match.awayTeam.externalId,
      name: match.awayTeam.name,
      shortName: match.awayTeam.shortName,
      logoUrl: match.awayTeam.logoUrl,
    },
    status: "LIVE",
    homeScore: (match.homeScore ?? 0) + scenario.scoreDelta.home,
    awayScore: (match.awayScore ?? 0) + scenario.scoreDelta.away,
    minute,
    kickoffAt: match.kickoffAt,
    venue: match.venue,
  });

  const normalizedEvent: NormalizedEvent = {
    externalId: `simulated-${scenario.type.toLowerCase()}-${Date.now()}`,
    type: scenario.type,
    detail: scenario.detail,
    minute,
    extraMinute: null,
    teamExternalId: match.homeTeam.externalId,
    playerId: null,
    playerName: scenario.playerName,
    assistName: scenario.assistName,
    timestamp: new Date(),
  };

  console.log(`\nSimulating ${scenario.type} — ${scenario.playerName}, ${minute}' (${match.homeTeam.name} vs ${match.awayTeam.name})`);

  const { event, isNew } = await ingestNormalizedEvent(updatedMatch.id, normalizedEvent);
  console.log(`Event ingested (isNew=${isNew}). Commentary and social ingestion are running in the background —`);
  console.log("check the match page (WebSocket) or re-run this script's logs to see them land.\n");

  if (scenario.type === "GOAL") {
    // give the async commentary/social triggers a moment, then add seeded
    // candidates so the live demo also shows a community highlight arrive.
    await new Promise((resolve) => setTimeout(resolve, 500));

    const posts = buildCandidatePosts(scenario, minute, match.awayTeam.name);
    for (const post of posts) {
      await prisma.socialPost.upsert({
        where: { source_externalId: { source: "SEED", externalId: post.externalId } },
        create: { ...post, source: "SEED", matchId: updatedMatch.id },
        update: {},
      });
    }
    await processEventMatching(event.id);
    console.log("Seeded community reactions and ran the matching pipeline for this goal.\n");
  }
}

async function main() {
  const { type, match, replay } = parseArgs();
  if (replay) {
    await runReplay(match);
  } else {
    await runNewEvent(match, type);
  }
}

main()
  .catch((err) => {
    logger.error("simulate_event_failed", { error: String(err) });
    process.exitCode = 1;
  })
  .finally(async () => {
    // let fire-and-forget commentary/social work finish before tearing down
    // the DB/Redis connections it's still using (see waitForPendingBackgroundWork).
    await waitForPendingBackgroundWork();
    await prisma.$disconnect();
    redis.disconnect();
    redisPublisher.disconnect();
  });
