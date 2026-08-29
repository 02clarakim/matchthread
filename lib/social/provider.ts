import type { MatchEventType, SocialMediaType } from "@prisma/client";

/** A raw candidate post from a social source, before matching. */
export interface SocialCandidate {
  externalId: string;
  title: string;
  body?: string | null;
  author?: string | null;
  url: string;
  /**
   * A directly playable/displayable media URL, if the source legitimately
   * offers one (e.g. Reddit's own v.redd.it video CDN, or a preview image
   * URL) — never a re-hosted copy. Null when no embeddable media exists;
   * the UI falls back to a link to the source post.
   */
  mediaUrl?: string | null;
  mediaType?: SocialMediaType | null;
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
