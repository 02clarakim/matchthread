import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withCache } from "@/lib/redis/cache";
import { cacheKeys, CACHE_TTL } from "@/lib/redis/keys";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const events = await withCache(cacheKeys.matchEvents(id), CACHE_TTL.MATCH_EVENTS, () =>
    prisma.matchEvent.findMany({
      where: { matchId: id },
      include: { team: true },
      orderBy: [{ minute: "asc" }, { createdAt: "asc" }],
    })
  );

  return NextResponse.json({ events });
}
