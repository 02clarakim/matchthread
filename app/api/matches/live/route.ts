import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { matchWithTeams, serializeMatch } from "@/lib/db/match-includes";
import { withCache } from "@/lib/redis/cache";
import { cacheKeys, CACHE_TTL } from "@/lib/redis/keys";

export async function GET() {
  const matches = await withCache(cacheKeys.liveMatches(), CACHE_TTL.MATCHES_BY_DATE, async () => {
    const rows = await prisma.match.findMany({
      where: { status: { in: ["LIVE", "PAUSED"] } },
      include: matchWithTeams,
      orderBy: { kickoffAt: "asc" },
    });
    return rows.map(serializeMatch);
  });

  return NextResponse.json({ matches });
}
