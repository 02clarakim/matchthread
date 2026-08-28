import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withCache } from "@/lib/redis/cache";
import { cacheKeys, CACHE_TTL } from "@/lib/redis/keys";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const highlights = await withCache(cacheKeys.matchHighlights(id), CACHE_TTL.MATCH_HIGHLIGHTS, () =>
    prisma.eventSocialMatch.findMany({
      where: { event: { matchId: id } },
      include: { socialPost: true, event: true },
      orderBy: { score: "desc" },
      take: 20,
    })
  );

  return NextResponse.json({ highlights });
}
