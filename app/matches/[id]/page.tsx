import { notFound } from "next/navigation";
import { prisma } from "@/lib/db/prisma";
import { matchWithTeams, serializeMatch } from "@/lib/db/match-includes";
import { LiveMatchView } from "@/components/match/live-match-view";
import type { ApiEvent, ApiHighlight } from "@/lib/types/api";

export default async function MatchPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const match = await prisma.match.findUnique({ where: { id }, include: matchWithTeams });
  if (!match) notFound();

  const [events, highlightRows] = await Promise.all([
    prisma.matchEvent.findMany({ where: { matchId: id }, orderBy: { minute: "asc" } }),
    prisma.eventSocialMatch.findMany({
      where: { event: { matchId: id } },
      include: { socialPost: true },
      orderBy: { score: "desc" },
      take: 20,
    }),
  ]);

  const apiEvents: ApiEvent[] = events.map((e) => ({
    id: e.id,
    type: e.type,
    detail: e.detail,
    minute: e.minute,
    extraMinute: e.extraMinute,
    teamId: e.teamId,
    playerName: e.playerName,
    assistName: e.assistName,
    commentary: e.commentary,
  }));

  const apiHighlights: ApiHighlight[] = highlightRows.map((h) => ({
    id: h.id,
    score: h.score,
    matchingMethod: h.matchingMethod,
    socialPost: {
      id: h.socialPost.id,
      title: h.socialPost.title,
      url: h.socialPost.url,
      mediaUrl: h.socialPost.mediaUrl,
      mediaType: h.socialPost.mediaType,
      author: h.socialPost.author,
    },
    event: { id: h.eventId },
  }));

  return (
    <div className="mx-auto max-w-5xl px-4 py-6">
      <LiveMatchView
        initialMatch={serializeMatch(match)}
        initialEvents={apiEvents}
        initialHighlights={apiHighlights}
      />
    </div>
  );
}
