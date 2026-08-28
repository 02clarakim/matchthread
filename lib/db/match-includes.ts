import { Prisma } from "@prisma/client";
import type { ApiMatch } from "../types/api";

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
