import { prisma } from "./db/prisma";
import { DEMO_DEFAULT_TEAM_NAMES } from "./demo-account";

/**
 * Wipes and re-seeds the demo user's favorites to the canonical default
 * list (lib/demo-account.ts). Called from auth.ts's authorize() on every
 * demo login. Separated from demo-account.ts (which the client-side
 * DemoLoginButton also imports) because this pulls in Prisma — a
 * "use client" component can't import this without breaking the browser
 * bundle. Silently a no-op for any team name not found in this
 * environment's data.
 */
export async function resetDemoFavorites(userId: string): Promise<void> {
  const teams = await prisma.team.findMany({ where: { name: { in: DEMO_DEFAULT_TEAM_NAMES } } });
  await prisma.$transaction([
    prisma.userFavoriteTeam.deleteMany({ where: { userId } }),
    prisma.userFavoriteTeam.createMany({
      data: teams.map((t) => ({ userId, teamId: t.id })),
      skipDuplicates: true,
    }),
  ]);
}
