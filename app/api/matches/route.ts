import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { matchWithTeams } from "@/lib/db/match-includes";
import { withCache } from "@/lib/redis/cache";
import { cacheKeys, CACHE_TTL } from "@/lib/redis/keys";

const querySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const parsed = querySchema.safeParse({ date: searchParams.get("date") ?? undefined });
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid date — expected YYYY-MM-DD" }, { status: 400 });
  }

  const date = parsed.data.date ?? todayIsoDate();
  const start = new Date(`${date}T00:00:00.000Z`);
  const end = new Date(`${date}T23:59:59.999Z`);

  const matches = await withCache(cacheKeys.matchesByDate(date), CACHE_TTL.MATCHES_BY_DATE, () =>
    prisma.match.findMany({
      where: { kickoffAt: { gte: start, lte: end } },
      include: matchWithTeams,
      orderBy: { kickoffAt: "asc" },
    })
  );

  return NextResponse.json({ date, matches });
}
