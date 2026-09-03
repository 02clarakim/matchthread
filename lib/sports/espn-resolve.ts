import type { PrismaClient } from "@prisma/client";
import { LEAGUE_NAMES } from "./espn";
import type { NormalizedLeague, NormalizedTeam } from "./types";

/**
 * Bridges ESPN's team/league naming onto the rows already in our DB (the
 * seeded teams) so backfilled/live matches attach to the same Team the
 * /teams pages and favorites use — never a duplicate. Anything ESPN has
 * that we don't gets created under the right league with an `espn-team-*`
 * external id.
 */

/** ESPN displayName -> our seeded Team.name, for the cases a normalized compare doesn't catch. */
const TEAM_NAME_OVERRIDES: Record<string, string> = {
  "afc bournemouth": "Bournemouth",
  "athletic club": "Athletic Bilbao",
  "wolverhampton": "Wolverhampton Wanderers",
  "wolves": "Wolverhampton Wanderers",
  "spurs": "Tottenham Hotspur",
  "man united": "Manchester United",
  "man utd": "Manchester United",
  "man city": "Manchester City",
  "nottm forest": "Nottingham Forest",
  "leeds": "Leeds United",
  "newcastle": "Newcastle United",
  "west ham": "West Ham United",
  "brighton": "Brighton & Hove Albion",
};

export function normTeamName(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\b(fc|afc|cf|sc|sd|ud|cd|club)\b/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}
const norm = normTeamName;

export class EspnResolver {
  private teamCache = new Map<string, NormalizedTeam>();
  private leagueCache = new Map<string, NormalizedLeague>();
  private dbTeams: Array<{ name: string; externalId: string; shortName: string | null }> | null = null;

  constructor(private prisma: PrismaClient) {}

  private async allDbTeams() {
    if (!this.dbTeams) {
      this.dbTeams = await this.prisma.team.findMany({ select: { name: true, externalId: true, shortName: true } });
    }
    return this.dbTeams;
  }

  async league(leagueSlug: string): Promise<NormalizedLeague> {
    const cached = this.leagueCache.get(leagueSlug);
    if (cached) return cached;

    const name = LEAGUE_NAMES[leagueSlug] ?? leagueSlug;
    const existing = await this.prisma.league.findFirst({ where: { name } });
    const league: NormalizedLeague = {
      externalId: existing?.externalId ?? `espn-league-${leagueSlug}`,
      name,
      country: null,
      logoUrl: null,
    };
    this.leagueCache.set(leagueSlug, league);
    return league;
  }

  async team(espn: {
    espnId: string;
    name: string;
    abbreviation: string | null;
    logo?: string | null;
  }): Promise<NormalizedTeam> {
    const cached = this.teamCache.get(espn.espnId);
    if (cached) return cached;

    const n = norm(espn.name);
    const overrideName = TEAM_NAME_OVERRIDES[n];
    const dbTeams = await this.allDbTeams();

    const hit =
      dbTeams.find((t) => t.name === (overrideName ?? espn.name)) ??
      dbTeams.find((t) => norm(t.name) === n) ??
      dbTeams.find((t) => norm(t.name).includes(n) || n.includes(norm(t.name)));

    const team: NormalizedTeam = {
      externalId: hit?.externalId ?? `espn-team-${espn.espnId}`,
      name: hit?.name ?? espn.name,
      shortName: hit?.shortName ?? espn.abbreviation ?? espn.name.slice(0, 3).toUpperCase(),
      // ESPN's crest is authoritative and stable — refresh it every run
      // (upsertTeam only overwrites when a non-undefined logoUrl is passed).
      logoUrl: espn.logo ?? null,
    };
    this.teamCache.set(espn.espnId, team);
    return team;
  }
}
