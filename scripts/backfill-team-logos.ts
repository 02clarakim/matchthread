import "dotenv/config";
import { prisma } from "../lib/db/prisma";
import { redis, redisPublisher } from "../lib/redis/client";
import { logger } from "../lib/logger";
import { fetchEspnTeams } from "../lib/sports/espn";
import { normTeamName } from "../lib/sports/espn-resolve";

/**
 * Fills Team.logoUrl for any team that still has none, by name-matching
 * against ESPN's per-league team lists. Covers second divisions too, so
 * clubs relegated in ESPN's data (Burnley, Wolves, West Ham → eng.2;
 * Girona, Mallorca, Oviedo → esp.2) still get a crest.
 *
 *   npm run backfill:logos
 *   npm run backfill:logos -- --force   # also overwrite existing logos
 */

const LEAGUES = ["eng.1", "eng.2", "esp.1", "esp.2", "ger.1", "ger.2", "ita.1", "fra.1"];

async function main() {
  const force = process.argv.includes("--force");

  const espnByName = new Map<string, string>();
  for (const league of LEAGUES) {
    try {
      for (const t of await fetchEspnTeams(league)) {
        if (t.logo && !espnByName.has(normTeamName(t.name))) espnByName.set(normTeamName(t.name), t.logo);
      }
    } catch (err) {
      logger.warn("espn_teams_failed", { league, error: String(err) });
    }
  }
  console.log(`ESPN crest index: ${espnByName.size} teams across ${LEAGUES.length} leagues\n`);

  const teams = await prisma.team.findMany({
    where: force ? {} : { logoUrl: null },
    select: { id: true, name: true, logoUrl: true },
  });

  let filled = 0;
  const misses: string[] = [];
  for (const team of teams) {
    const n = normTeamName(team.name);
    const logo =
      espnByName.get(n) ??
      [...espnByName].find(([k]) => k.includes(n) || n.includes(k))?.[1] ??
      null;
    if (!logo || logo === team.logoUrl) {
      if (!logo) misses.push(team.name);
      continue;
    }
    await prisma.team.update({ where: { id: team.id }, data: { logoUrl: logo } });
    filled += 1;
    console.log(`  ✓ ${team.name}  →  ${logo}`);
  }

  console.log(`\ndone — ${filled} crest${filled === 1 ? "" : "s"} filled` + (misses.length ? `, no ESPN match for: ${misses.join(", ")}` : "") + "\n");
}

main()
  .catch((err) => {
    logger.error("backfill_team_logos_failed", { error: String(err) });
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    redis.disconnect();
    redisPublisher.disconnect();
  });
