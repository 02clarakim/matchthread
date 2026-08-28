import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { matchWithTeams } from "@/lib/db/match-includes";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const team = await prisma.team.findUnique({ where: { id }, include: { league: true } });
  if (!team) {
    return NextResponse.json({ error: "Team not found" }, { status: 404 });
  }

  const teamFilter = { OR: [{ homeTeamId: id }, { awayTeamId: id }] };

  const [live, upcoming, recent] = await Promise.all([
    prisma.match.findMany({
      where: { ...teamFilter, status: { in: ["LIVE", "PAUSED"] } },
      include: matchWithTeams,
      orderBy: { kickoffAt: "asc" },
    }),
    prisma.match.findMany({
      where: { ...teamFilter, status: "SCHEDULED" },
      include: matchWithTeams,
      orderBy: { kickoffAt: "asc" },
      take: 5,
    }),
    prisma.match.findMany({
      where: { ...teamFilter, status: "FINISHED" },
      include: matchWithTeams,
      orderBy: { kickoffAt: "desc" },
      take: 5,
    }),
  ]);

  return NextResponse.json({ team, live, upcoming, recent });
}
