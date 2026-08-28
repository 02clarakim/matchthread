import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db/prisma";
import { logger } from "@/lib/logger";

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ teamId: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { teamId } = await params;

  // Scoped to the authenticated user's own userId — a user can never
  // touch another user's favorites, regardless of what teamId is passed.
  await prisma.userFavoriteTeam.deleteMany({
    where: { userId: session.user.id, teamId },
  });

  logger.info("favorite_team_removed", { userId: session.user.id, teamId });

  return new NextResponse(null, { status: 204 });
}
