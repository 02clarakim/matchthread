import Link from "next/link";
import { auth } from "@/auth";
import { prisma } from "@/lib/db/prisma";
import { TeamBadge } from "@/components/teams/team-badge";
import { FavoriteButton } from "@/components/teams/favorite-button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { buttonClasses } from "@/components/ui/button";

export default async function TeamsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  const session = await auth();

  const [teams, favoriteTeamIds] = await Promise.all([
    prisma.team.findMany({
      where: q ? { name: { contains: q, mode: "insensitive" } } : undefined,
      include: { league: true },
      orderBy: { name: "asc" },
      take: 50,
    }),
    session?.user?.id
      ? prisma.userFavoriteTeam
          .findMany({ where: { userId: session.user.id }, select: { teamId: true } })
          .then((rows) => new Set(rows.map((r) => r.teamId)))
      : Promise.resolve(new Set<string>()),
  ]);

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 space-y-6">
      <div>
        <h1 className="text-xl font-semibold mb-4">Find teams to follow</h1>
        <form action="/teams" method="GET">
          <input
            type="text"
            name="q"
            defaultValue={q ?? ""}
            placeholder="Search teams…"
            className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-accent"
          />
        </form>
      </div>

      {teams.length === 0 ? (
        <EmptyState icon="🔍">No teams found{q ? ` for "${q}"` : ""}.</EmptyState>
      ) : (
        <Card className="divide-y divide-border">
          {teams.map((team) => (
            <div key={team.id} className="flex items-center gap-3 p-3">
              <Link href={`/teams/${team.id}`} className="flex items-center gap-3 flex-1 min-w-0">
                <TeamBadge name={team.name} logoUrl={team.logoUrl} />
                <div className="min-w-0">
                  <div className="text-sm font-medium truncate">{team.name}</div>
                  {team.league && <div className="text-xs text-muted truncate">{team.league.name}</div>}
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
