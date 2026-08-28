import type { MatchEventType, MatchStatus } from "@prisma/client";

export interface NormalizedLeague {
  externalId: string;
  name: string;
  country: string | null;
  logoUrl: string | null;
}

export interface NormalizedTeam {
  externalId: string;
  name: string;
  shortName: string | null;
  logoUrl: string | null;
}

export interface NormalizedMatch {
  externalId: string;
  league: NormalizedLeague;
  homeTeam: NormalizedTeam;
  awayTeam: NormalizedTeam;
  status: MatchStatus;
  homeScore: number | null;
  awayScore: number | null;
  minute: number | null;
  kickoffAt: Date;
  venue: string | null;
}

export interface NormalizedEvent {
  externalId: string;
  type: MatchEventType;
  detail: string | null;
  minute: number;
  extraMinute: number | null;
  /** External team ID — resolved to our internal Team.id at ingest time. */
  teamExternalId: string | null;
  playerId: string | null;
  playerName: string | null;
  assistName: string | null;
  timestamp: Date;
}

export interface MatchWithEvents {
  match: NormalizedMatch;
  events: NormalizedEvent[];
}

/** Provider-agnostic interface for a live sports data source. */
export interface SportsApiProvider {
  name: string;
  getMatchesByDate(date: string): Promise<NormalizedMatch[]>;
  getMatchDetail(externalMatchId: string): Promise<MatchWithEvents>;
}
