import Link from "next/link";
import { auth } from "@/auth";
import { prisma } from "@/lib/db/prisma";
import { TeamBadge } from "@/components/teams/team-badge";
import { LeaguePill } from "@/components/teams/league-pill";
import { FavoriteButton } from "@/components/teams/favorite-button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { buttonClasses } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { LEAGUE_ORDER, leagueColorClasses, leagueSortIndex } from "@/lib/league-format";

function filterHref(league: string | null, q: string | undefined) {
  const params = new URLSearchParams();
  if (q) params.set("q", q);
  if (league) params.set("league", league);
  const qs = params.toString();
  return `/teams${qs ? `?${qs}` : ""}`;
}

export default async function TeamsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; league?: string }>;
}) {
  const { q, league } = await searchParams;
  const session = await auth();

  const [teams, favoriteTeamIds] = await Promise.all([
    prisma.team.findMany({
      where: {
        ...(q ? { name: { contains: q, mode: "insensitive" } } : {}),
        ...(league ? { league: { name: league } } : {}),
      },
      include: { league: true },
      take: 100,
    }),
    session?.user?.id
      ? prisma.userFavoriteTeam
          .findMany({ where: { userId: session.user.id }, select: { teamId: true } })
          .then((rows) => new Set(rows.map((r) => r.teamId)))
      : Promise.resolve(new Set<string>()),
  ]);

  // Premier League -> La Liga -> Bundesliga, alphabetical within each league.
  const sortedTeams = [...teams].sort((a, b) => {
    const leagueDiff = leagueSortIndex(a.league?.name ?? "") - leagueSortIndex(b.league?.name ?? "");
    return leagueDiff !== 0 ? leagueDiff : a.name.localeCompare(b.name);
  });

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 space-y-6">
      <div className="space-y-4">
        <h1 className="text-xl font-semibold">Find teams to follow</h1>

        <div className="flex flex-wrap gap-2">
          <Link
            href={filterHref(null, q)}
            className={cn(
              "inline-flex items-center rounded-full border px-3 py-1 text-xs font-medium transition-opacity",
              "bg-surface-2 text-foreground border-border",
              !league ? "opacity-100 ring-1 ring-accent" : "opacity-60 hover:opacity-100"
            )}
          >
            All
          </Link>
          {LEAGUE_ORDER.map((name) => (
            <Link
              key={name}
              href={filterHref(name, q)}
              className={cn(
                "inline-flex items-center rounded-full border px-3 py-1 text-xs font-medium transition-opacity",
                leagueColorClasses(name),
                league === name ? "opacity-100 ring-1 ring-accent" : "opacity-60 hover:opacity-100"
              )}
            >
              {name}
            </Link>
          ))}
        </div>

        <form action="/teams" method="GET">
          <input type="hidden" name="league" value={league ?? ""} />
          <input
            type="text"
            name="q"
            defaultValue={q ?? ""}
            placeholder="Search teams…"
            className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-accent"
          />
        </form>
      </div>

      {sortedTeams.length === 0 ? (
        <EmptyState icon="🔍">No teams found{q ? ` for "${q}"` : ""}.</EmptyState>
      ) : (
        <Card className="divide-y divide-border">
          {sortedTeams.map((team) => (
            <div key={team.id} className="flex items-center gap-3 p-3">
              <Link href={`/teams/${team.id}`} className="flex items-center gap-3 flex-1 min-w-0">
                <TeamBadge name={team.name} logoUrl={team.logoUrl} />
                <div className="min-w-0">
                  <div className="text-sm font-medium truncate">{team.name}</div>
                  {team.league && (
                    <div className="mt-0.5">
                      <LeaguePill name={team.league.name} />
                    </div>
                  )}
                </div>
              </Link>
              {session?.user?.id ? (
                <FavoriteButton teamId={team.id} initiallyFavorited={favoriteTeamIds.has(team.id)} />
              ) : (
                <Link href="/login" className={buttonClasses("secondary", "sm")}>
                  Sign in to follow
                </Link>
              )}
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}
