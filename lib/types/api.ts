import type { MatchEventType, MatchStatus, MatchingMethod } from "@prisma/client";

/**
 * JSON-safe shapes returned by our own API routes (Dates arrive as ISO
 * strings once they've been through NextResponse.json). Kept separate from
 * the Prisma types so client components don't need Prisma imported at all.
 */

export interface ApiTeam {
  id: string;
  externalId: string;
  name: string;
  shortName: string | null;
  logoUrl: string | null;
}

export interface ApiLeague {
  id: string;
  name: string;
  country: string | null;
}

export interface ApiMatch {
  id: string;
  status: MatchStatus;
  homeScore: number | null;
  awayScore: number | null;
  minute: number | null;
  kickoffAt: string;
  venue: string | null;
  homeTeam: ApiTeam;
  awayTeam: ApiTeam;
  league: ApiLeague;
}

export interface ApiEvent {
  id: string;
  type: MatchEventType;
  detail: string | null;
  minute: number;
  extraMinute: number | null;
  teamId: string | null;
  playerName: string | null;
  assistName: string | null;
  commentary: string | null;
}

export interface ApiHighlight {
  id: string;
  score: number;
  matchingMethod: MatchingMethod;
  socialPost: {
    id: string;
    title: string;
    url: string;
    mediaUrl: string | null;
    author: string | null;
  };
  event: { id: string };
}
