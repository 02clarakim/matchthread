import Link from "next/link";
import { prisma } from "@/lib/db/prisma";
import { matchWithTeams, serializeMatch } from "@/lib/db/match-includes";
import { ScoreHeader } from "@/components/match/score-header";
import { EventItem } from "@/components/match/event-item";
import { LiveNowBoard } from "@/components/match/live-now-board";
import { EmptyState } from "@/components/ui/empty-state";
import { buttonClasses } from "@/components/ui/button";
import { GOAL_EVENT_TYPES } from "@/lib/match-format";
import type { ApiEvent } from "@/lib/types/api";

/**
 * Finds a real match to preview — the most recently finished ESPN-sourced
 * match that has a goal, preferring one that also has a matched Reddit
 * highlight. Never fabricates a score or a clip: on a fresh database
 * (before any backfill/seed has run) this returns nulls and the page
 * shows an honest empty state instead of a fake "Arsenal 1-0 Chelsea".
 */
async function findPreviewMatch() {
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

  let fallback: (typeof candidates)[number] | null = null;
  let fallbackEvent: Awaited<ReturnType<typeof prisma.matchEvent.findFirst>> | null = null;

  for (const candidate of candidates) {
    const [event, highlight] = await Promise.all([
      prisma.matchEvent.findFirst({
        where: { matchId: candidate.id, type: { in: GOAL_EVENT_TYPES } },
        orderBy: { minute: "desc" },
      }),
      prisma.eventSocialMatch.findFirst({
        where: { event: { matchId: candidate.id } },
        include: { socialPost: true },
        orderBy: { score: "desc" },
      }),
    ]);
    if (event && highlight) return { match: candidate, event, highlight };
    if (event && !fallback) {
      fallback = candidate;
      fallbackEvent = event;
    }
  }
  return fallback ? { match: fallback, event: fallbackEvent, highlight: null } : null;
}

export default async function LandingPage() {
  const [preview, liveMatches] = await Promise.all([
    findPreviewMatch(),
    prisma.match
      .findMany({
        where: { status: { in: ["LIVE", "PAUSED"] } },
        include: matchWithTeams,
        orderBy: { kickoffAt: "asc" },
      })
      .catch(() => []),
  ]);

  const previewEvent: ApiEvent | null = preview?.event
    ? {
        id: preview.event.id,
        type: preview.event.type,
        detail: preview.event.detail,
        minute: preview.event.minute,
        extraMinute: preview.event.extraMinute,
        teamId: preview.event.teamId,
        playerName: preview.event.playerName,
        assistName: preview.event.assistName,
        commentary: preview.event.commentary,
      }
    : null;

  return (
    <div className="mx-auto max-w-4xl px-4 py-16 space-y-16">
      <section className="relative text-center space-y-5 overflow-hidden">
        <div
          aria-hidden="true"
          className="animate-drift pointer-events-none absolute left-1/2 top-0 -z-10 h-72 w-72 rounded-full bg-accent/20 blur-3xl"
        />
        <h1 className="animate-fade-in-up text-3xl sm:text-4xl font-bold tracking-tight">
          Something happens.
          <br />
          <span className="text-accent">See what, see the reaction, find the clip.</span>
        </h1>
        <p
          className="animate-fade-in-up mx-auto max-w-xl text-muted"
          style={{ animationDelay: "120ms" }}
        >
          MatchThread follows your teams live — real match events, plain-English commentary, and
          the community&apos;s reaction, arriving together in one feed. No more tab-switching
          between a score app, X, Reddit, and YouTube.
        </p>
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
            <ScoreHeader match={serializeMatch(preview.match)} />

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="rounded-xl border border-border bg-surface p-4 transition-all duration-200 hover:-translate-y-0.5 hover:border-accent/40 hover:shadow-lg">
                <h2 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">
                  What happened
                </h2>
                {previewEvent && <EventItem event={previewEvent} />}
              </div>

              <div className="rounded-xl border border-border bg-surface p-4 transition-all duration-200 hover:-translate-y-0.5 hover:border-accent/40 hover:shadow-lg">
                <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">
                  What fans are saying
                </h2>
                {preview.highlight ? (
                  <div className="rounded-lg border border-border bg-surface-2 p-3">
                    <span className="text-xs font-medium text-accent">🔥 Best reaction</span>
                    <p className="mt-1.5 text-sm leading-snug">{preview.highlight.socialPost.title}</p>
                    <span className="mt-1.5 block text-xs text-muted">View on Reddit →</span>
                  </div>
                ) : (
                  <p className="text-sm text-muted">No matched community reaction for this goal yet.</p>
                )}
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
