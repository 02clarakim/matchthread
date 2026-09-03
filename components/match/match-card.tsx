import Link from "next/link";
import type { ApiMatch } from "@/lib/types/api";
import { TeamBadge } from "@/components/teams/team-badge";
import { StatusIndicator } from "@/components/match/live-badge";
import { Card } from "@/components/ui/card";
import { kickoffDateLabel, kickoffTimeLabel } from "@/lib/match-format";

export function MatchCard({ match }: { match: ApiMatch }) {
  const hasScore = match.homeScore !== null && match.awayScore !== null;

  return (
    <Link href={`/matches/${match.slug ?? match.id}`}>
      <Card className="p-3 hover:border-accent/50 transition-colors">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs text-muted truncate">{match.league.name}</span>
          <StatusIndicator status={match.status} minute={match.minute} />
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <TeamBadge name={match.homeTeam.name} logoUrl={match.homeTeam.logoUrl} size="sm" />
              <span className="truncate text-sm">{match.homeTeam.name}</span>
            </div>
            <span className="font-mono text-sm font-semibold tabular-nums">
              {hasScore ? match.homeScore : ""}
            </span>
          </div>
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <TeamBadge name={match.awayTeam.name} logoUrl={match.awayTeam.logoUrl} size="sm" />
              <span className="truncate text-sm">{match.awayTeam.name}</span>
            </div>
            <span className="font-mono text-sm font-semibold tabular-nums">
              {hasScore ? match.awayScore : ""}
            </span>
          </div>
        </div>

        {!hasScore && (
          <div className="mt-2 text-xs text-muted">
            {kickoffDateLabel(match.kickoffAt)} · {kickoffTimeLabel(match.kickoffAt)}
          </div>
        )}
      </Card>
    </Link>
  );
}
