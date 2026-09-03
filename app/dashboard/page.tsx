import Link from "next/link";
import { auth } from "@/auth";
import { prisma } from "@/lib/db/prisma";
import { matchWithTeams, serializeMatch } from "@/lib/db/match-includes";
import { TeamCard } from "@/components/teams/team-card";
import { MatchCard } from "@/components/match/match-card";
import { LiveFavoritesFeed } from "@/components/feed/live-favorites-feed";
import { HighlightFeedItem } from "@/components/social/highlight-feed-item";
import { EmptyState } from "@/components/ui/empty-state";
import { Card, CardBody } from "@/components/ui/card";
import { buttonClasses } from "@/components/ui/button";

export default async function DashboardPage() {
  const session = await auth();
  const userId = session!.user.id;

  const favorites = await prisma.userFavoriteTeam.findMany({
    where: { userId },
    include: { team: true },
    orderBy: { createdAt: "asc" },
  });
  const favoriteTeamIds = favorites.map((f) => f.teamId);
  const teamFilter = favoriteTeamIds.length > 0
    ? { OR: [{ homeTeamId: { in: favoriteTeamIds } }, { awayTeamId: { in: favoriteTeamIds } }] }
    : {};

  const [liveMatches, recentMatches, highlightRows] = await Promise.all([
    prisma.match.findMany({
      where: { ...teamFilter, status: { in: ["LIVE", "PAUSED"] } },
      include: matchWithTeams,
      orderBy: { kickoffAt: "asc" },
    }),
    prisma.match.findMany({
      where: { ...teamFilter, status: "FINISHED" },
      include: matchWithTeams,
      orderBy: { kickoffAt: "desc" },
      take: 4,
    }),
    prisma.eventSocialMatch.findMany({
      where: favoriteTeamIds.length > 0 ? { event: { match: teamFilter } } : {},
      include: { socialPost: true, event: { include: { match: { include: matchWithTeams } } } },
      orderBy: { createdAt: "desc" },
      take: 5,
    }),
  ]);

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 space-y-8">
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-muted uppercase tracking-wide">My Teams</h2>
          <Link href="/teams" className={buttonClasses("ghost", "sm")}>
            Find teams
          </Link>
        </div>
        {favorites.length === 0 ? (
          <Card>
            <CardBody>
              <EmptyState icon="⭐">
                You haven&apos;t followed any teams yet.{" "}
                <Link href="/teams" className="text-accent underline underline-offset-2">
                  Browse teams
                </Link>
                {" "}to build your personalized feed.
              </EmptyState>
            </CardBody>
          </Card>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {favorites.map((f) => (
              <TeamCard key={f.teamId} team={f.team} />
            ))}
          </div>
        )}
      </section>

      <section>
        <h2 className="text-sm font-semibold text-muted uppercase tracking-wide mb-3">
          {favoriteTeamIds.length > 0 ? "Live For You" : "Live Matches"}
        </h2>
        <LiveFavoritesFeed initialLiveMatches={liveMatches.map(serializeMatch)} />
      </section>

      <section>
        <h2 className="text-sm font-semibold text-muted uppercase tracking-wide mb-3">Recent Matches</h2>
        {recentMatches.length === 0 ? (
          <EmptyState icon="📅">No recent matches yet.</EmptyState>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {recentMatches.map((m) => (
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
