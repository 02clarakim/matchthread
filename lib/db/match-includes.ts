import { Prisma } from "@prisma/client";
import type { ApiMatch } from "../types/api";
import type { NormalizedMatch } from "../sports/types";

/** Shared include shape for "match card" style responses — list/detail/dashboard all want the same team+league info. */
export const matchWithTeams = {
  league: true,
  homeTeam: true,
  awayTeam: true,
} satisfies Prisma.MatchInclude;

export type MatchWithTeams = Prisma.MatchGetPayload<{ include: typeof matchWithTeams }>;

/** Converts a Prisma match (with Date fields) into the JSON-safe shape client components expect. */
export function serializeMatch(match: MatchWithTeams): ApiMatch {
  return {
    id: match.id,
    status: match.status,
    homeScore: match.homeScore,
    awayScore: match.awayScore,
    minute: match.minute,
    kickoffAt: match.kickoffAt.toISOString(),
    venue: match.venue,
    homeTeam: match.homeTeam,
    awayTeam: match.awayTeam,
    league: match.league,
  };
}

/**
 * Converts a Prisma match (with team/league relations) back into the
 * provider-agnostic NormalizedMatch shape lib/sports/ingest.ts#upsertMatch
 * expects — used by callers that need to re-upsert a match they already
 * loaded from the DB with a few fields changed (e.g. score/minute/status),
 * without hand-repeating the field mapping at every call site.
 */
export function toNormalizedMatch(match: MatchWithTeams, overrides: Partial<NormalizedMatch> = {}): NormalizedMatch {
  return {
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
    status: match.status,
    homeScore: match.homeScore,
    awayScore: match.awayScore,
    minute: match.minute,
    kickoffAt: match.kickoffAt,
    venue: match.venue,
    ...overrides,
  };
}
