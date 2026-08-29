import "dotenv/config";
import bcrypt from "bcryptjs";
import { prisma } from "../lib/db/prisma";
import { redis, redisPublisher } from "../lib/redis/client";
import { upsertMatch, ingestNormalizedEvent, waitForPendingBackgroundWork } from "../lib/sports/ingest";
import { attachCommentary } from "../workers/commentary-worker";
import { processEventMatching } from "../workers/event-processor";
import type { NormalizedEvent, NormalizedMatch } from "../lib/sports/types";
import { logger } from "../lib/logger";

/**
 * Builds a fully working demo dataset by driving the exact same ingestion
 * pipeline real events go through (lib/sports/ingest.ts) — not hand-writing
 * rows that bypass it. That means every seeded event gets real generated
 * commentary, and the marquee goal gets matched against seeded Reddit-style
 * posts by the real matching engine, with real transparent scores.
 *
 * Safe to re-run: everything here is upserted or keyed off externalId.
 */

const PL = { externalId: "seed-league-pl", name: "Premier League", country: "England", logoUrl: null };
const LALIGA = { externalId: "seed-league-laliga", name: "La Liga", country: "Spain", logoUrl: null };
const BUNDESLIGA = { externalId: "seed-league-bundesliga", name: "Bundesliga", country: "Germany", logoUrl: null };

function team(externalId: string, name: string, shortName: string) {
  return { externalId, name, shortName, logoUrl: null };
}

const TEAMS = {
  arsenal: team("seed-team-arsenal", "Arsenal", "ARS"),
  chelsea: team("seed-team-chelsea", "Chelsea", "CHE"),
  liverpool: team("seed-team-liverpool", "Liverpool", "LIV"),
  manCity: team("seed-team-man-city", "Manchester City", "MCI"),
  manUtd: team("seed-team-man-utd", "Manchester United", "MUN"),
  newcastle: team("seed-team-newcastle", "Newcastle United", "NEW"),
  tottenham: team("seed-team-tottenham", "Tottenham Hotspur", "TOT"),
  astonVilla: team("seed-team-aston-villa", "Aston Villa", "AVL"),
  barcelona: team("seed-team-barcelona", "Barcelona", "FCB"),
  realMadrid: team("seed-team-real-madrid", "Real Madrid", "RMA"),
  atleticoMadrid: team("seed-team-atletico-madrid", "Atletico Madrid", "ATM"),
  sevilla: team("seed-team-sevilla", "Sevilla", "SEV"),
  bayernMunich: team("seed-team-bayern-munich", "Bayern Munich", "BAY"),
  dortmund: team("seed-team-dortmund", "Borussia Dortmund", "BVB"),
};

function minutesAgo(minutes: number): Date {
  return new Date(Date.now() - minutes * 60 * 1000);
}

/**
 * Resolves "tomorrow at HH:MM in a given IANA time zone" to a real UTC
 * Date, using Intl to derive the correct offset for that date (handles DST
 * automatically — a fixed UTC-7/UTC-8 offset would be wrong half the year).
 */
function tomorrowAtLocalTime(hour: number, minute: number, timeZone: string): Date {
  const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);

  const dateParts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(tomorrow);
  const year = Number(dateParts.find((p) => p.type === "year")!.value);
  const month = Number(dateParts.find((p) => p.type === "month")!.value);
  const day = Number(dateParts.find((p) => p.type === "day")!.value);

  const offsetParts = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "shortOffset" }).formatToParts(
    tomorrow
  );
  const offsetLabel = offsetParts.find((p) => p.type === "timeZoneName")?.value ?? "GMT+0";
  const offsetMatch = offsetLabel.match(/GMT([+-]\d+)(?::(\d+))?/);
  const offsetHours = offsetMatch ? Number(offsetMatch[1]) : 0;
  const offsetMinutes = offsetMatch?.[2] ? Number(offsetMatch[2]) : 0;
  const totalOffsetMinutes = offsetHours * 60 + Math.sign(offsetHours || 1) * offsetMinutes;

  return new Date(Date.UTC(year, month - 1, day, hour, minute) - totalOffsetMinutes * 60_000);
}

async function seedMatch(normalized: NormalizedMatch, events: NormalizedEvent[]) {
  const match = await upsertMatch(normalized);
  for (const normalizedEvent of events) {
    const { event, isNew } = await ingestNormalizedEvent(match.id, normalizedEvent);
    // ingestNormalizedEvent fires commentary generation without waiting for it;
    // await it explicitly here so `npm run seed` finishes with commentary in place.
    await attachCommentary(event.id);
    logger.info("seed_event_ingested", { matchId: match.id, eventId: event.id, isNew });
  }
  return match;
}

async function seedArsenalVsChelsea() {
  const match = await seedMatch(
    {
      externalId: "seed-match-arsenal-chelsea",
      league: PL,
      homeTeam: TEAMS.arsenal,
      awayTeam: TEAMS.chelsea,
      status: "LIVE",
      homeScore: 1,
      awayScore: 0,
      minute: 74,
      kickoffAt: minutesAgo(74),
      venue: "Emirates Stadium",
    },
    [
      {
        externalId: "seed-event-ars-che-yellow-1",
        type: "YELLOW_CARD",
        detail: "Foul",
        minute: 23,
        extraMinute: null,
        teamExternalId: TEAMS.chelsea.externalId,
        playerId: null,
        playerName: "Enzo Fernández",
        assistName: null,
        timestamp: minutesAgo(51),
      },
      {
        externalId: "seed-event-ars-che-goal-1",
        type: "GOAL",
        detail: null,
        minute: 67,
        extraMinute: null,
        teamExternalId: TEAMS.arsenal.externalId,
        playerId: null,
        playerName: "Bukayo Saka",
        assistName: "Martin Ødegaard",
        timestamp: minutesAgo(7),
      },
      {
        externalId: "seed-event-ars-che-sub-1",
        type: "SUBSTITUTION",
        detail: null,
        minute: 74,
        extraMinute: null,
        teamExternalId: TEAMS.arsenal.externalId,
        playerId: null,
        playerName: "Gabriel Martinelli",
        assistName: "Leandro Trossard",
        timestamp: minutesAgo(0),
      },
    ]
  );

  const goalEvent = await prisma.matchEvent.findUniqueOrThrow({
    where: { matchId_externalId: { matchId: match.id, externalId: "seed-event-ars-che-goal-1" } },
  });

  // Seeded Reddit-style candidates (source: SEED, not a live API call) —
  // deliberately includes one unrelated post so the deterministic filter
  // has something to correctly reject.
  const posts = [
    {
      externalId: "seed-post-1",
      title: "[Goal] Saka cuts inside and curls it past the keeper! 67'",
      body: null,
      author: "gooner_since_04",
      url: "https://www.reddit.com/r/soccer/comments/seed-post-1",
      mediaUrl: null,
      createdAt: minutesAgo(7),
    },
    {
      externalId: "seed-post-2",
      title: "Saka with an absolute screamer 😭",
      body: "That's his 8th goal of the season, unreal form right now",
      author: "afc_ollie",
      url: "https://www.reddit.com/r/soccer/comments/seed-post-2",
      mediaUrl: null,
      createdAt: minutesAgo(6),
    },
    {
      externalId: "seed-post-3",
      title: "Chelsea defense completely lost Saka there",
      body: null,
      author: "cfc_dan",
      url: "https://www.reddit.com/r/soccer/comments/seed-post-3",
      mediaUrl: null,
      createdAt: minutesAgo(5),
    },
    {
      externalId: "seed-post-4",
      title: "Liverpool player ratings vs Newcastle",
      body: "Salah 8, Van Dijk 7, Alisson 6...",
      author: "kopite_reviews",
      url: "https://www.reddit.com/r/soccer/comments/seed-post-4",
      mediaUrl: null,
      createdAt: minutesAgo(0),
    },
  ];

  for (const post of posts) {
    await prisma.socialPost.upsert({
      where: { source_externalId: { source: "SEED", externalId: post.externalId } },
      create: { ...post, source: "SEED", matchId: match.id },
      update: {},
    });
  }

  // Run the real matching pipeline against the seeded candidates so the
  // marquee match page has genuine, score-transparent community highlights.
  await processEventMatching(goalEvent.id);
}

async function seedManCityVsNewcastle() {
  await seedMatch(
    {
      externalId: "seed-match-mancity-newcastle",
      league: PL,
      homeTeam: TEAMS.manCity,
      awayTeam: TEAMS.newcastle,
      status: "LIVE",
      homeScore: 1,
      awayScore: 0,
      minute: 51,
      kickoffAt: minutesAgo(51),
      venue: "Etihad Stadium",
    },
    [
      {
        externalId: "seed-event-mci-new-goal-1",
        type: "GOAL",
        detail: null,
        minute: 12,
        extraMinute: null,
        teamExternalId: TEAMS.manCity.externalId,
        playerId: null,
        playerName: "Erling Haaland",
        assistName: "Kevin De Bruyne",
        timestamp: minutesAgo(39),
      },
    ]
  );
}

async function seedLiverpoolVsManUtd() {
  await seedMatch(
    {
      externalId: "seed-match-liverpool-manutd",
      league: PL,
      homeTeam: TEAMS.liverpool,
      awayTeam: TEAMS.manUtd,
      status: "FINISHED",
      homeScore: 2,
      awayScore: 0,
      minute: 90,
      kickoffAt: minutesAgo(24 * 60),
      venue: "Anfield",
    },
    [
      {
        externalId: "seed-event-liv-mun-goal-1",
        type: "GOAL",
        detail: null,
        minute: 15,
        extraMinute: null,
        teamExternalId: TEAMS.liverpool.externalId,
        playerId: null,
        playerName: "Mohamed Salah",
        assistName: null,
        timestamp: minutesAgo(24 * 60 - 15),
      },
      {
        externalId: "seed-event-liv-mun-yellow-1",
        type: "YELLOW_CARD",
        detail: "Foul",
        minute: 39,
        extraMinute: null,
        teamExternalId: TEAMS.manUtd.externalId,
        playerId: null,
        playerName: "Bruno Fernandes",
        assistName: null,
        timestamp: minutesAgo(24 * 60 - 39),
      },
      {
        externalId: "seed-event-liv-mun-goal-2",
        type: "GOAL",
        detail: null,
        minute: 78,
        extraMinute: null,
        teamExternalId: TEAMS.liverpool.externalId,
        playerId: null,
        playerName: "Darwin Núñez",
        assistName: "Mohamed Salah",
        timestamp: minutesAgo(24 * 60 - 78),
      },
    ]
  );
}

async function seedBarcelonaVsRealMadrid() {
  await upsertMatch({
    externalId: "seed-match-barcelona-real-madrid",
    league: LALIGA,
    homeTeam: TEAMS.barcelona,
    awayTeam: TEAMS.realMadrid,
    status: "SCHEDULED",
    homeScore: null,
    awayScore: null,
    minute: null,
    kickoffAt: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000),
    venue: "Spotify Camp Nou",
  });
}

async function seedTottenhamVsAstonVilla() {
  await upsertMatch({
    externalId: "seed-match-tottenham-aston-villa",
    league: PL,
    homeTeam: TEAMS.tottenham,
    awayTeam: TEAMS.astonVilla,
    status: "SCHEDULED",
    homeScore: null,
    awayScore: null,
    minute: null,
    kickoffAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
    venue: "Tottenham Hotspur Stadium",
  });
}

/** The specific fixture requested for a live test run: kicks off tomorrow at 12:30pm Pacific. */
async function seedAtleticoMadridVsSevilla() {
  await upsertMatch({
    externalId: "seed-match-atletico-sevilla",
    league: LALIGA,
    homeTeam: TEAMS.atleticoMadrid,
    awayTeam: TEAMS.sevilla,
    status: "SCHEDULED",
    homeScore: null,
    awayScore: null,
    minute: null,
    kickoffAt: tomorrowAtLocalTime(12, 30, "America/Los_Angeles"),
    venue: "Estadio Metropolitano",
  });
}

async function seedBayernVsDortmund() {
  await seedMatch(
    {
      externalId: "seed-match-bayern-dortmund",
      league: BUNDESLIGA,
      homeTeam: TEAMS.bayernMunich,
      awayTeam: TEAMS.dortmund,
      status: "FINISHED",
      homeScore: 3,
      awayScore: 1,
      minute: 90,
      kickoffAt: minutesAgo(2 * 24 * 60),
      venue: "Allianz Arena",
    },
    [
      {
        externalId: "seed-event-bay-bvb-goal-1",
        type: "GOAL",
        detail: null,
        minute: 18,
        extraMinute: null,
        teamExternalId: TEAMS.bayernMunich.externalId,
        playerId: null,
        playerName: "Harry Kane",
        assistName: null,
        timestamp: minutesAgo(2 * 24 * 60 - 18),
      },
      {
        externalId: "seed-event-bay-bvb-goal-2",
        type: "GOAL",
        detail: null,
        minute: 44,
        extraMinute: null,
        teamExternalId: TEAMS.dortmund.externalId,
        playerId: null,
        playerName: "Karim Adeyemi",
        assistName: null,
        timestamp: minutesAgo(2 * 24 * 60 - 44),
      },
      {
        externalId: "seed-event-bay-bvb-goal-3",
        type: "GOAL",
        detail: null,
        minute: 71,
        extraMinute: null,
        teamExternalId: TEAMS.bayernMunich.externalId,
        playerId: null,
        playerName: "Jamal Musiala",
        assistName: "Harry Kane",
        timestamp: minutesAgo(2 * 24 * 60 - 71),
      },
      {
        externalId: "seed-event-bay-bvb-goal-4",
        type: "GOAL",
        detail: null,
        minute: 85,
        extraMinute: null,
        teamExternalId: TEAMS.bayernMunich.externalId,
        playerId: null,
        playerName: "Leroy Sané",
        assistName: null,
        timestamp: minutesAgo(2 * 24 * 60 - 85),
      },
    ]
  );
}

async function seedUsers() {
  const passwordHash = await bcrypt.hash("password123", 10);

  const demo = await prisma.user.upsert({
    where: { email: "demo@example.com" },
    create: { email: "demo@example.com", name: "Demo Fan", passwordHash },
    update: {},
  });

  const second = await prisma.user.upsert({
    where: { email: "second@example.com" },
    create: { email: "second@example.com", name: "Barca Fan", passwordHash },
    update: {},
  });

  const teamsByExternalId = await prisma.team.findMany({
    where: {
      externalId: {
        in: [TEAMS.arsenal.externalId, TEAMS.liverpool.externalId, TEAMS.barcelona.externalId],
      },
    },
  });
  const teamId = (externalId: string) =>
    teamsByExternalId.find((t) => t.externalId === externalId)?.id;

  const demoFavorites = [TEAMS.arsenal.externalId, TEAMS.liverpool.externalId, TEAMS.barcelona.externalId]
    .map(teamId)
    .filter((id): id is string => Boolean(id));

  for (const tid of demoFavorites) {
    await prisma.userFavoriteTeam.upsert({
      where: { userId_teamId: { userId: demo.id, teamId: tid } },
      create: { userId: demo.id, teamId: tid },
      update: {},
    });
  }

  const barcaId = teamId(TEAMS.barcelona.externalId);
  if (barcaId) {
    await prisma.userFavoriteTeam.upsert({
      where: { userId_teamId: { userId: second.id, teamId: barcaId } },
      create: { userId: second.id, teamId: barcaId },
      update: {},
    });
  }

  logger.info("seed_users_created", { demo: demo.email, second: second.email });
}

async function main() {
  logger.info("seed_started", {});

  await seedArsenalVsChelsea();
  await seedManCityVsNewcastle();
  await seedLiverpoolVsManUtd();
  await seedBarcelonaVsRealMadrid();
  await seedTottenhamVsAstonVilla();
  await seedAtleticoMadridVsSevilla();
  await seedBayernVsDortmund();
  await seedUsers();

  logger.info("seed_completed", {});
  console.log("\nSeed complete. Demo accounts (password: password123):");
  console.log("  demo@example.com    — favorites: Arsenal, Liverpool, Barcelona");
  console.log("  second@example.com  — favorites: Barcelona\n");
}

main()
  .catch((err) => {
    logger.error("seed_failed", { error: String(err) });
    process.exitCode = 1;
  })
  .finally(async () => {
    await waitForPendingBackgroundWork();
    await prisma.$disconnect();
    redis.disconnect();
    redisPublisher.disconnect();
  });
