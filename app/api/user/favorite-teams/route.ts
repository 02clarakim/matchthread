import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/db/prisma";
import { logger } from "@/lib/logger";

const addFavoriteSchema = z.object({ teamId: z.string().min(1) });

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const favorites = await prisma.userFavoriteTeam.findMany({
    where: { userId: session.user.id },
    include: { team: true },
    orderBy: { createdAt: "asc" },
  });

  return NextResponse.json({ teams: favorites.map((f) => f.team) });
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const parsed = addFavoriteSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }

  const team = await prisma.team.findUnique({ where: { id: parsed.data.teamId } });
  if (!team) {
    return NextResponse.json({ error: "Team not found" }, { status: 404 });
  }

  await prisma.userFavoriteTeam.upsert({
    where: { userId_teamId: { userId: session.user.id, teamId: team.id } },
    create: { userId: session.user.id, teamId: team.id },
    update: {},
  });

  logger.info("favorite_team_added", { userId: session.user.id, teamId: team.id });

  return NextResponse.json({ team }, { status: 201 });
}
