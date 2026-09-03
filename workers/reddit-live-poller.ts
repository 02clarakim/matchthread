import "dotenv/config";
import { prisma } from "../lib/db/prisma";
import { logger } from "../lib/logger";
import { isRedditConfigured } from "../lib/reddit/client";
import { findGoalClipPosts, findRedCardPosts } from "../lib/reddit/live-detector";
import {
  extractMinute,
  extractPlayerName,
  detectScoringSide,
  resolveGoalEvent,
  type KnownScore,
} from "../lib/reddit/parse-goal-post";
import { extractMedia } from "../lib/reddit/provider";
import type { RedditPost } from "../lib/reddit/client";
import type { MatchEventType } from "@prisma/client";
import { upsertMatch, ingestNormalizedEvent } from "../lib/sports/ingest";
import { toNormalizedMatch, matchWithTeams, type MatchWithTeams } from "../lib/db/match-includes";
import { publishRealtimeMessage } from "../lib/redis/pubsub";
import { invalidateCache } from "../lib/redis/cache";
import { cacheKeys } from "../lib/redis/keys";

/**
 * v1 "Reddit as the live feed" worker — an alternative to
 * workers/sports-poller.ts for when a paid live-scores API isn't in the
 * picture yet. Full tradeoffs are in README § Reddit-Sourced Live
 * Detection; the short version:
 *
 *   - GOALS: high confidence. r/soccer's "Goal Clip" flair is a strong,
 *     purpose-built signal, and the clip is embedded immediately since the
 *     triggering post *is* the source.
 *   - RED CARDS: lower confidence. No dedicated flair, so this is plain
 *     keyword search — can miss one or occasionally match a false positive.
 *   - YELLOW CARDS / SUBSTITUTIONS: not detected at all in v1. There's no
 *     reliable "someone always posts this" signal on Reddit the way there
 *     is for goals. Closing this gap needs an official data source
 *     (workers/sports-poller.ts, free or paid) — until then, demonstrate
 *     them with `npm run simulate-event -- --type=yellow` / `--type=sub`.
 *   - Minute/player-name/scoring-team are parsed from free-text titles
 *     (lib/reddit/parse-goal-post.ts) — best-effort, not authoritative.
 *     When the scoring team can't be confidently resolved, the post is
 *     skipped rather than risking crediting the wrong team's scoreboard.
 *
 * Match status/minute has no official feed to follow either, so this
 * worker also heuristically flips SCHEDULED -> LIVE at kickoff time and
 * LIVE -> FINISHED after an assumed match duration, and refreshes `minute`
 * from elapsed wall-clock time each cycle.
 */

const POLL_INTERVAL_MS = 20_000;
const ASSUMED_MATCH_DURATION_MINUTES = 125; // kickoff + two halves + stoppage + halftime, rough upper bound

function elapsedMinutes(kickoffAt: Date): number {
  return Math.min(90, Math.max(0, Math.floor((Date.now() - kickoffAt.getTime()) / 60_000)));
}

/** Flips SCHEDULED -> LIVE at kickoff, LIVE -> FINISHED after the assumed duration, and keeps `minute` fresh while live. */
async function syncMatchStatus(match: MatchWithTeams) {
  const now = Date.now();
  const kickoff = match.kickoffAt.getTime();

  if (match.status === "SCHEDULED" && kickoff <= now) {
    logger.info("reddit_live_poller_kickoff", { matchId: match.id });
    // Explicitly 0-0, not null — a match that has kicked off has a score,
    // and score-delta scoring-team detection (parse-goal-post.ts) needs a
    // real baseline to compare against.
    return upsertMatch(
      toNormalizedMatch(match, { status: "LIVE", homeScore: 0, awayScore: 0, minute: elapsedMinutes(match.kickoffAt) })
    );
  }

  if (match.status === "LIVE") {
    const minutesSinceKickoff = (now - kickoff) / 60_000;
    if (minutesSinceKickoff >= ASSUMED_MATCH_DURATION_MINUTES) {
      logger.info("reddit_live_poller_assumed_finished", { matchId: match.id });
      return upsertMatch(toNormalizedMatch(match, { status: "FINISHED", minute: 90 }));
    }
    return upsertMatch(toNormalizedMatch(match, { minute: elapsedMinutes(match.kickoffAt) }));
  }

  return match;
}

async function handleDetectedPost(
  match: MatchWithTeams,
  post: RedditPost,
  eventType: "GOAL" | "RED_CARD",
  currentScore: KnownScore
): Promise<KnownScore | null> {
  const externalId = `reddit-${post.id}`;

  // MatchEvent existence (not just SocialPost) is the dedup gate here,
  // checked *before* any score increment — otherwise a retry after a
  // partial failure (event ingested, then a later step errored) could
  // double-count a goal. ingestNormalizedEvent's own idempotency is a
  // second, independent backstop, not the only guard.
  const existingEvent = await prisma.matchEvent.findUnique({
    where: { matchId_externalId: { matchId: match.id, externalId } },
  });
  if (existingEvent) return null;

  // Goals get the high-confidence structured "Goal Clip" parse (bracket
  // convention, see parse-goal-post.ts) with a fallback baked in; red
  // cards have no equivalent convention, so they use the generic
  // score/alias heuristics directly.
  const resolved =
    eventType === "GOAL"
      ? resolveGoalEvent(post.title, match.homeTeam.name, match.awayTeam.name, currentScore)
      : (() => {
          const side = detectScoringSide(post.title, match.homeTeam.name, match.awayTeam.name, currentScore);
          return side
            ? {
                side,
                playerName: extractPlayerName(post.title),
                minute: extractMinute(post.title),
                extraMinute: null,
                isPenalty: false,
                isOwnGoal: false,
              }
            : null;
        })();

  if (!resolved) {
    logger.info("reddit_live_event_team_ambiguous", { matchId: match.id, type: eventType, title: post.title });
    return null;
  }

  const { side, playerName, extraMinute, isPenalty } = resolved;
  const minute = resolved.minute ?? elapsedMinutes(match.kickoffAt);
  const team = side === "home" ? match.homeTeam : match.awayTeam;
  const matchEventType: MatchEventType = eventType === "GOAL" && isPenalty ? "PENALTY_GOAL" : eventType;

  let nextScore = currentScore;

  if (eventType === "GOAL") {
    const homeScore = side === "home" ? (currentScore.homeScore ?? 0) + 1 : currentScore.homeScore;
    const awayScore = side === "away" ? (currentScore.awayScore ?? 0) + 1 : currentScore.awayScore;
    const updated = await upsertMatch(toNormalizedMatch(match, { status: "LIVE", homeScore, awayScore, minute }));
    nextScore = { homeScore: updated.homeScore, awayScore: updated.awayScore };
  }

  const { event } = await ingestNormalizedEvent(match.id, {
    externalId,
    type: matchEventType,
    detail: null,
    minute,
    extraMinute,
    teamExternalId: team.externalId,
    playerId: null,
    playerName,
    assistName: null,
    timestamp: new Date(post.created_utc * 1000),
  });

  const { mediaUrl, mediaType } = extractMedia(post);
  const socialPost = await prisma.socialPost.upsert({
    where: { source_externalId: { source: "REDDIT", externalId: post.id } },
    create: {
      source: "REDDIT",
      externalId: post.id,
      matchId: match.id,
      title: post.title,
      body: post.selftext || null,
      author: post.author,
      url: `https://www.reddit.com${post.permalink}`,
      mediaUrl,
      mediaType,
      createdAt: new Date(post.created_utc * 1000),
    },
    update: {},
  });

  // The triggering post *is* the source here (it caused the event, rather
  // than being found by searching after the fact), so it's attached as a
  // highlight directly with full confidence — no separate matching pass.
  await prisma.eventSocialMatch.upsert({
    where: { eventId_socialPostId: { eventId: event.id, socialPostId: socialPost.id } },
    create: { eventId: event.id, socialPostId: socialPost.id, score: 1, matchingMethod: "DETERMINISTIC" },
    update: {},
  });

  await invalidateCache(cacheKeys.matchHighlights(match.id));

  await publishRealtimeMessage({
    type: "highlight_update",
    matchId: match.id,
    teamIds: [match.homeTeamId, match.awayTeamId],
    eventId: event.id,
    highlight: {
      socialPostId: socialPost.id,
      title: socialPost.title,
      url: socialPost.url,
      mediaUrl: socialPost.mediaUrl,
      mediaType: socialPost.mediaType,
      author: socialPost.author,
      score: 1,
      matchingMethod: "DETERMINISTIC",
    },
  });

  logger.info("reddit_live_event_detected", { matchId: match.id, type: matchEventType, postId: post.id, playerName, minute });

  return nextScore;
}

async function processMatch(match: MatchWithTeams): Promise<void> {
  const synced = await syncMatchStatus(match);
  if (synced.status === "FINISHED" || synced.status === "SCHEDULED") return;

  const [goalPosts, redCardPosts] = await Promise.all([
    findGoalClipPosts(match.homeTeam.name, match.awayTeam.name),
    findRedCardPosts(match.homeTeam.name, match.awayTeam.name),
  ]);

  let currentScore: KnownScore = { homeScore: synced.homeScore, awayScore: synced.awayScore };

  for (const post of goalPosts) {
    const updatedScore = await handleDetectedPost(match, post, "GOAL", currentScore);
    if (updatedScore) currentScore = updatedScore;
  }
  for (const post of redCardPosts) {
    await handleDetectedPost(match, post, "RED_CARD", currentScore);
  }
}

export async function pollOnce(): Promise<void> {
  if (!isRedditConfigured()) {
    logger.warn("reddit_live_poller_skipped_not_configured", {});
    return;
  }

  const now = new Date();
  const matches = await prisma.match.findMany({
    where: { OR: [{ status: "LIVE" }, { status: "SCHEDULED", kickoffAt: { lte: now } }] },
    include: matchWithTeams,
  });

  logger.info("reddit_live_poller_cycle_started", { trackedMatches: matches.length });

  for (const match of matches) {
    try {
      await processMatch(match);
    } catch (err) {
      logger.error("reddit_live_poller_match_failed", { matchId: match.id, error: String(err) });
    }
  }
}

async function startPolling() {
  logger.info("reddit_live_poller_started", { intervalMs: POLL_INTERVAL_MS });
  while (true) {
    try {
      await pollOnce();
    } catch (err) {
      logger.error("reddit_live_poller_cycle_failed", { error: String(err) });
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
}

if (require.main === module) {
  startPolling();
}
