import type { MatchEventType } from "@prisma/client";

/** A raw candidate post from a social source, before matching. */
export interface SocialCandidate {
  externalId: string;
  title: string;
  body?: string | null;
  author?: string | null;
  url: string;
  mediaUrl?: string | null;
  createdAt: Date;
}

/** Structured description of the match event a provider should search for. */
export interface SocialSearchEvent {
  homeTeamName: string;
  awayTeamName: string;
  eventType: MatchEventType;
  playerName?: string | null;
  minute: number;
  commentary?: string | null;
}

/**
 * A community/social source that can find posts plausibly discussing a
 * given match event. Reddit is the only implementation today, but nothing
 * outside lib/social/ knows that — future providers (other platforms,
 * licensed media, a first-party community) plug in here.
 */
export interface SocialProvider {
  name: string;
  searchForEvent(event: SocialSearchEvent): Promise<SocialCandidate[]>;
}
