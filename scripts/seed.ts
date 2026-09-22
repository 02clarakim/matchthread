import "dotenv/config";
import bcrypt from "bcryptjs";
import { prisma } from "../lib/db/prisma";
import { redis, redisPublisher } from "../lib/redis/client";
import { upsertMatch, upsertLeague, upsertTeam, ingestNormalizedEvent, waitForPendingBackgroundWork } from "../lib/sports/ingest";
import { attachCommentary } from "../workers/commentary-worker";
import { processEventMatching } from "../workers/event-processor";
import type { NormalizedEvent, NormalizedMatch } from "../lib/sports/types";
import { logger } from "../lib/logger";
import { DEMO_EMAIL, DEMO_DEFAULT_TEAM_NAMES } from "../lib/demo-account";
import { resetDemoFavorites } from "../lib/demo-account-server";

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

/**
 * The rest of each league's clubs — browsable/followable, but with no
 * seeded matches (a team doesn't need a fixture to appear in "Find teams"
 * or a personalized feed; team pages already show an empty state for "no
 * matches yet"). TEAMS above is reserved for clubs the seeded demo matches
 * actually use, since those also need a roster in simulate-event.ts.
 */
// Kept in sync with each league's real current (2026-27) roster —
// confirmed live against ESPN's own team list (lib/sports/espn.ts's
// fetchEspnTeams) on 2026-09-22, not just carried over from whenever this
// was first written. Burnley/West Ham/Wolves, Girona/Mallorca/Real
// Oviedo, and St. Pauli/Heidenheim/Bochum/Wolfsburg were all relegated
// out of their leagues for this season — confirmed by a zero-result sweep
// of ESPN's real scoreboard across an 80-day window, not just their
// absence from this roster list — and replaced below with the real
// promoted sides. A team with no seeded match still needs a spot here so
// "Find teams" / favoriting sees it at all (see the comment above TEAMS).
const EXTRA_PREMIER_LEAGUE_TEAMS = [
  team("seed-team-bournemouth", "Bournemouth", "BOU"),
  team("seed-team-brentford", "Brentford", "BRE"),
  team("seed-team-brighton", "Brighton & Hove Albion", "BHA"),
  team("seed-team-coventry", "Coventry City", "COV"),
  team("seed-team-crystal-palace", "Crystal Palace", "CRY"),
  team("seed-team-everton", "Everton", "EVE"),
  team("seed-team-fulham", "Fulham", "FUL"),
  team("seed-team-hull", "Hull City", "HUL"),
  team("seed-team-ipswich", "Ipswich Town", "IPS"),
  team("seed-team-leeds", "Leeds United", "LEE"),
  team("seed-team-nottm-forest", "Nottingham Forest", "NFO"),
  team("seed-team-sunderland", "Sunderland", "SUN"),
];

const EXTRA_LALIGA_TEAMS = [
  team("seed-team-athletic-bilbao", "Athletic Bilbao", "ATH"),
  team("seed-team-real-betis", "Real Betis", "BET"),
  team("seed-team-celta-vigo", "Celta Vigo", "CEL"),
  team("seed-team-deportivo", "Deportivo", "DEP"),
  team("seed-team-espanyol", "Espanyol", "ESP"),
  team("seed-team-getafe", "Getafe", "GET"),
  team("seed-team-malaga", "Málaga", "MCF"),
  team("seed-team-osasuna", "Osasuna", "OSA"),
  team("seed-team-racing-santander", "Racing Santander", "RAC"),
  team("seed-team-rayo-vallecano", "Rayo Vallecano", "RAY"),
  team("seed-team-real-sociedad", "Real Sociedad", "RSO"),
  team("seed-team-valencia", "Valencia", "VAL"),
  team("seed-team-villarreal", "Villarreal", "VIL"),
  team("seed-team-alaves", "Alavés", "ALA"),
  team("seed-team-levante", "Levante", "LEV"),
  team("seed-team-elche", "Elche", "ELC"),
];

const EXTRA_BUNDESLIGA_TEAMS = [
  team("seed-team-rb-leipzig", "RB Leipzig", "RBL"),
  team("seed-team-leverkusen", "Bayer Leverkusen", "B04"),
  team("seed-team-cologne", "FC Cologne", "KOE"),
  team("seed-team-frankfurt", "Eintracht Frankfurt", "SGE"),
  team("seed-team-stuttgart", "VfB Stuttgart", "VFB"),
  team("seed-team-gladbach", "Borussia Mönchengladbach", "BMG"),
  team("seed-team-werder-bremen", "Werder Bremen", "SVW"),
  team("seed-team-mainz", "Mainz 05", "M05"),
  team("seed-team-union-berlin", "Union Berlin", "FCU"),
  team("seed-team-freiburg", "SC Freiburg", "SCF"),
  team("seed-team-augsburg", "FC Augsburg", "FCA"),
  team("seed-team-hoffenheim", "TSG Hoffenheim", "TSG"),
  team("seed-team-paderborn", "SC Paderborn 07", "SCP"),
  team("seed-team-elversberg", "SV Elversberg", "ELV"),
  team("seed-team-schalke", "Schalke 04", "S04"),
  team("seed-team-hamburger-sv", "Hamburger SV", "HSV"),
];

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

// Placeholder SCHEDULED fixtures (Barcelona–Real Madrid, Tottenham–Aston
// Villa) used to live here. They're now covered by real ESPN fixtures from
// `npm run backfill`, so seeding them too produced duplicate/stale cards on
// the team pages — removed.

/**
 * The specific fixture requested for a live test run: kicks off tomorrow
 * at 12:30pm Pacific. Sevilla is the home side — this is played at their
 * own ground (Ramón Sánchez Pizjuán), confirmed against real match
 * listings rather than assumed.
 */
async function seedSevillaVsAtleticoMadrid() {
  await upsertMatch({
    externalId: "seed-match-atletico-sevilla",
    league: LALIGA,
    homeTeam: TEAMS.sevilla,
    awayTeam: TEAMS.atleticoMadrid,
    status: "SCHEDULED",
    homeScore: null,
    awayScore: null,
    minute: null,
    kickoffAt: tomorrowAtLocalTime(12, 30, "America/Los_Angeles"),
    venue: "Estadio Ramón Sánchez Pizjuán",
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

/** Fills out the rest of each league's roster so "Find teams" reflects real league sizes (20/20/18), not just the clubs used by seeded matches. */
async function seedFullLeagueRosters() {
  const pl = await upsertLeague(PL);
  const laliga = await upsertLeague(LALIGA);
  const bundesliga = await upsertLeague(BUNDESLIGA);

  for (const t of EXTRA_PREMIER_LEAGUE_TEAMS) await upsertTeam(t, pl.id);
  for (const t of EXTRA_LALIGA_TEAMS) await upsertTeam(t, laliga.id);
  for (const t of EXTRA_BUNDESLIGA_TEAMS) await upsertTeam(t, bundesliga.id);

  logger.info("seed_extra_teams_created", {
    premierLeague: EXTRA_PREMIER_LEAGUE_TEAMS.length,
    laLiga: EXTRA_LALIGA_TEAMS.length,
    bundesliga: EXTRA_BUNDESLIGA_TEAMS.length,
  });
}

async function seedUsers() {
  const passwordHash = await bcrypt.hash("password123", 10);

  const demo = await prisma.user.upsert({
    where: { email: DEMO_EMAIL },
    create: { email: DEMO_EMAIL, name: "Demo Fan", passwordHash },
    update: {},
  });

  const second = await prisma.user.upsert({
    where: { email: "second@example.com" },
    create: { email: "second@example.com", name: "Barca Fan", passwordHash },
    update: {},
  });

  // Same canonical list auth.ts's authorize() resets to on every demo
  // login (lib/demo-account.ts) — one source of truth, so a fresh seed and
  // a fresh login always land on the same defaults.
  await resetDemoFavorites(demo.id);

  const barcaId = (await prisma.team.findFirst({ where: { externalId: TEAMS.barcelona.externalId } }))?.id;
  if (barcaId) {
    await prisma.userFavoriteTeam.upsert({
      where: { userId_teamId: { userId: second.id, teamId: barcaId } },
      create: { userId: second.id, teamId: barcaId },
      update: {},
    });
  }

  logger.info("seed_users_created", {
    demo: demo.email,
    second: second.email,
    demoFavorites: DEMO_DEFAULT_TEAM_NAMES.join(", "),
  });
}

async function main() {
  logger.info("seed_started", {});

  await seedArsenalVsChelsea();
  await seedManCityVsNewcastle();
  await seedLiverpoolVsManUtd();
  await seedSevillaVsAtleticoMadrid();
  await seedBayernVsDortmund();
  await seedFullLeagueRosters();
  await seedUsers();

  logger.info("seed_completed", {});
  console.log("\nSeed complete. Demo accounts (password: password123):");
  console.log(`  demo@example.com    — favorites: ${DEMO_DEFAULT_TEAM_NAMES.join(", ")} (resets on every login)`);
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
