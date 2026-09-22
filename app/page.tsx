import Link from "next/link";
import { auth } from "@/auth";
import { prisma } from "@/lib/db/prisma";
import { matchWithTeams, serializeMatch, type MatchWithTeams } from "@/lib/db/match-includes";
import { ScoreHeader } from "@/components/match/score-header";
import { EventItem } from "@/components/match/event-item";
import { LiveNowBoard } from "@/components/match/live-now-board";
import { EmptyState } from "@/components/ui/empty-state";
import { buttonClasses } from "@/components/ui/button";
import { HighlightList } from "@/components/social/highlight-list";
import { byClipThenScore } from "@/lib/social/clip-rank";
import { GOAL_EVENT_TYPES } from "@/lib/match-format";
import type { ApiEvent, ApiHighlight } from "@/lib/types/api";

/** A deliberately chosen match to lead with — real, verified data (not fabricated), just a specific pick instead of whatever the "most recent" heuristic below would land on. Unset (null) to always use the dynamic pick. */
const FEATURED_MATCH_SLUG: string | null = "aston-villa-arsenal-083126";

/**
 * Given a candidate match, its FULL goal timeline and EVERY matched Reddit
 * highlight — never invented, and never truncated to "the latest goal" /
 * "the single best-scoring highlight" the way this used to work. The whole
 * point of the preview is to show what a real match thread looks like, so
 * it should look like one: every goal, every reaction, same as the actual
 * match page.
 */
async function resolvePreview(candidate: MatchWithTeams) {
  const [events, highlightRows] = await Promise.all([
    prisma.matchEvent.findMany({
      where: { matchId: candidate.id, type: { in: GOAL_EVENT_TYPES } },
      orderBy: { minute: "desc" },
    }),
    prisma.eventSocialMatch.findMany({
      where: { event: { matchId: candidate.id } },
      include: { socialPost: true },
      orderBy: { score: "desc" },
    }),
  ]);
  if (events.length === 0) return null;
  return { match: candidate, events, highlightRows };
}

/**
 * Finds a real match to preview — FEATURED_MATCH_SLUG if it's set, has a
 * goal, AND already has a matched Reddit highlight, otherwise the most
 * recently finished ESPN-sourced match that does. Never fabricates a score
 * or a clip: on a fresh database (before any backfill/seed has run) this
 * returns null and the page shows an honest empty state instead of a fake
 * "Arsenal 1-0 Chelsea".
 *
 * The highlight check on FEATURED_MATCH_SLUG specifically is deliberate,
 * not incidental: this constant gets hand-picked and changed periodically,
 * and a match chosen without checking whether its clip pipeline actually
 * ran silently showed an empty "What fans are saying" panel more than
 * once — confirmed live. Falling through to the dynamic pick when the
 * featured slug doesn't have one yet means picking a new featured match
 * can no longer reproduce that mistake, on this page at least.
 */
async function findPreviewMatch() {
  if (FEATURED_MATCH_SLUG) {
    const featured = await prisma.match
      .findUnique({ where: { slug: FEATURED_MATCH_SLUG }, include: matchWithTeams })
      .catch(() => null);
    if (featured) {
      const resolved = await resolvePreview(featured);
      if (resolved && resolved.highlightRows.length > 0) return resolved;
    }
  }

  const candidates = await prisma.match
    .findMany({
      where: {
        externalId: { startsWith: "espn-" },
        status: "FINISHED",
        events: { some: { type: { in: GOAL_EVENT_TYPES } } },
      },
      include: matchWithTeams,
      orderBy: { kickoffAt: "desc" },
      take: 5,
    })
    .catch(() => []);

  let fallback: Awaited<ReturnType<typeof resolvePreview>> | null = null;
  for (const candidate of candidates) {
    const resolved = await resolvePreview(candidate);
    if (!resolved) continue;
    if (resolved.highlightRows.length > 0) return resolved;
    if (!fallback) fallback = resolved;
  }
  return fallback;
}

export default async function LandingPage() {
  const [session, preview, liveMatches] = await Promise.all([
    auth(),
    findPreviewMatch(),
    prisma.match
      .findMany({
        where: { status: { in: ["LIVE", "PAUSED"] } },
        include: matchWithTeams,
        orderBy: { kickoffAt: "asc" },
      })
      .catch(() => []),
  ]);
  const isSignedIn = Boolean(session?.user?.id);

  const previewEvents: ApiEvent[] =
    preview?.events.map((event) => ({
      id: event.id,
      type: event.type,
      detail: event.detail,
      minute: event.minute,
      extraMinute: event.extraMinute,
      teamId: event.teamId,
      playerName: event.playerName,
      assistName: event.assistName,
      commentary: event.commentary,
    })) ?? [];

  const previewHighlights: ApiHighlight[] =
    preview?.highlightRows
      .map((h) => ({
        id: h.id,
        score: h.score,
        matchingMethod: h.matchingMethod,
        socialPost: {
          id: h.socialPost.id,
          title: h.socialPost.title,
          url: h.socialPost.url,
          mediaUrl: h.socialPost.mediaUrl,
          mediaType: h.socialPost.mediaType,
          author: h.socialPost.author,
          clipUrl: h.socialPost.clipUrl,
          clipHost: h.socialPost.clipHost,
          videoUrl: h.socialPost.videoUrl,
          posterUrl: h.socialPost.posterUrl,
        },
        event: { id: h.eventId },
      }))
      .sort(byClipThenScore) ?? [];

  return (
    <div className="mx-auto max-w-4xl px-4 py-16 space-y-16">
      <section className="relative text-center space-y-5">
        <div
          aria-hidden="true"
          className="animate-drift pointer-events-none absolute left-1/2 top-1/2 -z-10 h-[28rem] w-[28rem] -translate-x-1/2 -translate-y-1/2 rounded-full opacity-70"
          style={{ background: "radial-gradient(circle, var(--accent) 0%, transparent 70%)" }}
        />
        <h1 className="animate-fade-in-up text-3xl sm:text-4xl font-bold tracking-tight">
          Your team scores.
          <br />
          <span className="text-accent">The thread starts.</span>
        </h1>
        <p
          className="animate-fade-in-up mx-auto max-w-xl text-muted"
          style={{ animationDelay: "120ms" }}
        >
          Watch the goal land live, then relive it — the clip, play-by-play commentary on how it
          happened, and the community&apos;s reaction, all in one thread. No more tab-switching
          between X, Reddit, and YouTube.
        </p>
        {!isSignedIn && (
          <div
            className="animate-fade-in-up flex items-center justify-center gap-3"
            style={{ animationDelay: "240ms" }}
          >
            <Link href="/register" className={buttonClasses("primary")}>
              Get started
            </Link>
            <Link href="/login" className={buttonClasses("secondary")}>
              Sign in
            </Link>
          </div>
        )}
      </section>

      <section className="animate-fade-in-up space-y-3" style={{ animationDelay: "320ms" }}>
        <div className="flex items-center gap-2">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-accent" />
          </span>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">Live now</h2>
        </div>
        <LiveNowBoard initial={liveMatches.map(serializeMatch)} />
      </section>

      <section className="animate-fade-in-up space-y-4" style={{ animationDelay: "420ms" }}>
        {preview ? (
          <>
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">
                A real match thread
              </h2>
              <Link
                href={`/matches/${preview.match.slug ?? preview.match.id}`}
                className="text-xs font-medium text-accent hover:underline underline-offset-2"
              >
                Open this thread →
              </Link>
            </div>

            <ScoreHeader match={serializeMatch(preview.match)} />

            {/* Every goal, every matched reaction — same components the
                actual match page uses, just not wired to the realtime
                websocket (this is always a finished match, so there's
                nothing live to stream in). No longer just the latest goal
                and the single top-scoring clip. Plain two-column grid —
                each side just grows to fit its own content. */}
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="rounded-xl border border-border bg-surface p-4 transition-all duration-200 hover:-translate-y-0.5 hover:border-accent/40 hover:shadow-lg">
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">
                  What happened
                </h3>
                <div className="divide-y divide-border">
                  {previewEvents.map((event) => (
                    <EventItem key={event.id} event={event} />
                  ))}
                </div>
              </div>

              <div className="rounded-xl border border-border bg-surface p-4 transition-all duration-200 hover:-translate-y-0.5 hover:border-accent/40 hover:shadow-lg">
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">
                  What fans are saying
                </h3>
                <HighlightList highlights={previewHighlights} />
              </div>
            </div>
          </>
        ) : (
          <EmptyState icon="⚽">
            No finished matches yet — scores, commentary, and reactions will show up here the
            moment a real match wraps up.
          </EmptyState>
        )}
      </section>
    </div>
  );
}
