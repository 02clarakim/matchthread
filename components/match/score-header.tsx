import type { ApiMatch } from "@/lib/types/api";
import { TeamBadge } from "@/components/teams/team-badge";
import { StatusIndicator } from "@/components/match/live-badge";
import { kickoffDateLabel, kickoffTimeLabel } from "@/lib/match-format";

export function ScoreHeader({ match }: { match: ApiMatch }) {
  const hasScore = match.homeScore !== null && match.awayScore !== null;

  return (
    <div className="rounded-xl border border-border bg-surface p-6">
      <div className="flex items-center justify-between text-xs text-muted mb-4">
        <span>{match.league.name}</span>
        <StatusIndicator status={match.status} minute={match.minute} />
      </div>

      <div className="grid grid-cols-3 items-center gap-4">
        <div className="flex flex-col items-center gap-2 text-center">
          <TeamBadge name={match.homeTeam.name} logoUrl={match.homeTeam.logoUrl} size="lg" />
          <span className="text-sm font-medium">{match.homeTeam.name}</span>
        </div>

        <div className="text-center">
          {hasScore ? (
            <div className="text-4xl font-bold tabular-nums font-mono">
              {match.homeScore} – {match.awayScore}
            </div>
          ) : (
            <div className="text-lg text-muted">
              {kickoffTimeLabel(match.kickoffAt)}
              <div className="text-xs">{kickoffDateLabel(match.kickoffAt)}</div>
            </div>
          )}
          {match.venue && <div className="mt-1 text-xs text-muted">{match.venue}</div>}
        </div>

        <div className="flex flex-col items-center gap-2 text-center">
          <TeamBadge name={match.awayTeam.name} logoUrl={match.awayTeam.logoUrl} size="lg" />
          <span className="text-sm font-medium">{match.awayTeam.name}</span>
        </div>
      </div>
    </div>
  );
}
