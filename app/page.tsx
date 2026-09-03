import Link from "next/link";
import { prisma } from "@/lib/db/prisma";
import { matchWithTeams, serializeMatch } from "@/lib/db/match-includes";
import { ScoreHeader } from "@/components/match/score-header";
import { EventItem } from "@/components/match/event-item";
import { LiveNowBoard } from "@/components/match/live-now-board";
import { buttonClasses } from "@/components/ui/button";
import type { ApiEvent } from "@/lib/types/api";

const FALLBACK_EVENT: ApiEvent = {
  id: "fallback",
  type: "GOAL",
  detail: null,
  minute: 67,
  extraMinute: null,
  teamId: null,
  playerName: "Bukayo Saka",
  assistName: "Martin Ødegaard",
  commentary: "Saka cuts inside from the right and fires a low shot into the far corner.",
};

const FALLBACK_HIGHLIGHT_TITLE = "[Goal] Saka cuts inside and curls it past the keeper! 67'";

export default async function LandingPage() {
  const [match, liveMatches] = await Promise.all([
    prisma.match
      .findUnique({ where: { externalId: "seed-match-arsenal-chelsea" }, include: matchWithTeams })
      .catch(() => null),
    prisma.match
      .findMany({
        where: { status: { in: ["LIVE", "PAUSED"] } },
        include: matchWithTeams,
        orderBy: { kickoffAt: "asc" },
      })
      .catch(() => []),
  ]);

  const [event, highlight] = match
    ? await Promise.all([
        prisma.matchEvent.findFirst({
          where: { matchId: match.id, type: "GOAL" },
          orderBy: { minute: "desc" },
        }),
        prisma.eventSocialMatch.findFirst({
          where: { event: { matchId: match.id } },
          include: { socialPost: true },
          orderBy: { score: "desc" },
        }),
      ])
    : [null, null];

  const previewEvent: ApiEvent = event
    ? {
        id: event.id,
        type: event.type,
        detail: event.detail,
        minute: event.minute,
        extraMinute: event.extraMinute,
        teamId: event.teamId,
        playerName: event.playerName,
        assistName: event.assistName,
        commentary: event.commentary,
      }
    : FALLBACK_EVENT;

  const previewHighlightTitle = highlight?.socialPost.title ?? FALLBACK_HIGHLIGHT_TITLE;

  return (
    <div className="mx-auto max-w-4xl px-4 py-16 space-y-16">
      <section className="text-center space-y-5">
        <h1 className="text-3xl sm:text-4xl font-bold tracking-tight">
          Something happens.
          <br />
          <span className="text-accent">See what, see the reaction, find the clip.</span>
        </h1>
        <p className="mx-auto max-w-xl text-muted">
          MatchPulse follows your teams live — real match events, plain-English commentary, and the
          community&apos;s reaction, arriving together in one feed. No more tab-switching between a
          score app, X, Reddit, and YouTube.
        </p>
        <div className="flex items-center justify-center gap-3">
          <Link href="/register" className={buttonClasses("primary")}>
            Get started
          </Link>
          <Link href="/login" className={buttonClasses("secondary")}>
            Sign in
          </Link>
        </div>
      </section>

      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-accent" />
          </span>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">Live now</h2>
        </div>
        <LiveNowBoard initial={liveMatches.map(serializeMatch)} />
      </section>

      <section className="space-y-4">
        {match ? (
          <ScoreHeader match={serializeMatch(match)} />
        ) : (
          <div className="rounded-xl border border-border bg-surface p-6 text-center text-sm text-muted">
            Arsenal 1 – 0 Chelsea · 67&apos;
          </div>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="rounded-xl border border-border bg-surface p-4">
            <h2 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">
              What happened
            </h2>
            <EventItem event={previewEvent} />
          </div>

          <div className="rounded-xl border border-border bg-surface p-4">
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">
              What fans are saying
            </h2>
            <div className="rounded-lg border border-border bg-surface-2 p-3">
              <span className="text-xs font-medium text-accent">🔥 Best reaction</span>
              <p className="mt-1.5 text-sm leading-snug">{previewHighlightTitle}</p>
              <span className="mt-1.5 block text-xs text-muted">View on Reddit →</span>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
