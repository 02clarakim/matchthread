import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { matchWithTeams } from "@/lib/db/match-includes";
import { withCache } from "@/lib/redis/cache";
import { cacheKeys, CACHE_TTL } from "@/lib/redis/keys";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const match = await withCache(cacheKeys.matchDetail(id), CACHE_TTL.MATCH_DETAIL, () =>
    prisma.match.findUnique({ where: { id }, include: matchWithTeams } )
  );

  if (!match) {
    return NextResponse.json({ error: "Match not found" }, { status: 404 });
  }

  return NextResponse.json({ match });
}
