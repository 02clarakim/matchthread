import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { matchWithTeams } from "@/lib/db/match-includes";
import { withCache } from "@/lib/redis/cache";
import { cacheKeys, CACHE_TTL } from "@/lib/redis/keys";

export async function GET() {
  const matches = await withCache(cacheKeys.liveMatches(), CACHE_TTL.MATCHES_BY_DATE, () =>
    prisma.match.findMany({
      where: { status: { in: ["LIVE", "PAUSED"] } },
      include: matchWithTeams,
      orderBy: { kickoffAt: "asc" },
    })
  );

  return NextResponse.json({ matches });
}
