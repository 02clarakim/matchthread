import Link from "next/link";
import { notFound } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/db/prisma";
import { matchWithTeams, serializeMatch } from "@/lib/db/match-includes";
import { TeamBadge } from "@/components/teams/team-badge";
import { FavoriteButton } from "@/components/teams/favorite-button";
import { MatchCard } from "@/components/match/match-card";
import { HighlightFeedItem } from "@/components/social/highlight-feed-item";
import { EmptyState } from "@/components/ui/empty-state";
import { buttonClasses } from "@/components/ui/button";

export default async function TeamPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();

  // `id` may be the profile slug ("tottenham-hotspur") or the raw cuid.
  const team = await prisma.team.findFirst({
    where: { OR: [{ slug: id }, { id }] },
    include: { league: true },
  });
  if (!team) notFound();
  const teamId = team.id;

  const teamFilter = { OR: [{ homeTeamId: teamId }, { awayTeamId: teamId }] };

  const now = new Date();

  const [live, upcoming, recent, finishedForForm, isFavorited, highlightRows] = await Promise.all([
    prisma.match.findMany({
      where: { ...teamFilter, status: { in: ["LIVE", "PAUSED"] } },
      include: matchWithTeams,
      orderBy: { kickoffAt: "asc" },
    }),
    prisma.match.findMany({
      where: { ...teamFilter, status: "SCHEDULED", kickoffAt: { gte: now } },
      include: matchWithTeams,
      orderBy: { kickoffAt: "asc" },
      take: 6,
    }),
    prisma.match.findMany({
      where: { ...teamFilter, status: "FINISHED" },
      include: matchWithTeams,
      orderBy: { kickoffAt: "desc" },
      take: 6,
    }),
    prisma.match.findMany({
      where: { ...teamFilter, status: "FINISHED", homeScore: { not: null }, awayScore: { not: null } },
      select: { homeTeamId: true, homeScore: true, awayScore: true },
      orderBy: { kickoffAt: "desc" },
      take: 30,
    }),
    session?.user?.id
      ? prisma.userFavoriteTeam.findUnique({ where: { userId_teamId: { userId: session.user.id, teamId } } })
      : Promise.resolve(null),
    prisma.eventSocialMatch.findMany({
      where: { event: { match: teamFilter } },
      include: { socialPost: true, event: { include: { match: { include: matchWithTeams } } } },
      orderBy: { createdAt: "desc" },
      take: 5,
    }),
  ]);

  const record = finishedForForm.reduce(
    (acc, m) => {
      const isHome = m.homeTeamId === teamId;
      const gf = (isHome ? m.homeScore : m.awayScore) ?? 0;
      const ga = (isHome ? m.awayScore : m.homeScore) ?? 0;
      acc.gf += gf;
      acc.ga += ga;
      if (gf > ga) acc.w += 1;
      else if (gf < ga) acc.l += 1;
      else acc.d += 1;
      return acc;
    },
    { w: 0, d: 0, l: 0, gf: 0, ga: 0 }
  );

  return (
    <div className="mx-auto max-w-4xl px-4 py-6 space-y-8">
      <div className="flex items-center gap-4">
        <TeamBadge name={team.name} logoUrl={team.logoUrl} size="lg" />
        <div className="flex-1">
          <h1 className="text-xl font-semibold">{team.name}</h1>
          {team.league && <p className="text-sm text-muted">{team.league.name}</p>}
          {finishedForForm.length > 0 && (
            <p className="mt-1 text-xs text-muted tabular-nums">
              Last {finishedForForm.length}: {record.w}W&nbsp;{record.d}D&nbsp;{record.l}L · {record.gf}–{record.ga} GF/GA
            </p>
          )}
        </div>
        {session?.user?.id ? (
          <FavoriteButton teamId={team.id} initiallyFavorited={Boolean(isFavorited)} />
        ) : (
          <Link href="/login" className={buttonClasses("secondary", "sm")}>
            Sign in to follow
          </Link>
        )}
      </div>

      {live.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold text-muted uppercase tracking-wide mb-3">Live Now</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {live.map((m) => (
              <MatchCard key={m.id} match={serializeMatch(m)} />
            ))}
          </div>
        </section>
      )}

      <section>
        <h2 className="text-sm font-semibold text-muted uppercase tracking-wide mb-3">Upcoming</h2>
        {upcoming.length === 0 ? (
          <EmptyState icon="📅">No upcoming matches scheduled.</EmptyState>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {upcoming.map((m) => (
              <MatchCard key={m.id} match={serializeMatch(m)} />
            ))}
          </div>
        )}
      </section>

      <section>
        <h2 className="text-sm font-semibold text-muted uppercase tracking-wide mb-3">Recent Results</h2>
        {recent.length === 0 ? (
          <EmptyState icon="📊">No recent results.</EmptyState>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {recent.map((m) => (
              <MatchCard key={m.id} match={serializeMatch(m)} />
            ))}
          </div>
        )}
      </section>

      <section>
        <h2 className="text-sm font-semibold text-muted uppercase tracking-wide mb-3">Community Highlights</h2>
        {highlightRows.length === 0 ? (
          <EmptyState icon="💬">No community highlights yet.</EmptyState>
        ) : (
          <div className="space-y-2">
            {highlightRows.map((h) => (
              <HighlightFeedItem
                key={h.id}
                highlight={{
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
                  },
                  event: { id: h.eventId },
                }}
                matchId={h.event.match.slug ?? h.event.match.id}
                matchLabel={`${h.event.match.homeTeam.name} vs ${h.event.match.awayTeam.name}`}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
