import Link from "next/link";
import type { ApiMatch, ApiTeam } from "@/lib/types/api";
import { TeamBadge } from "@/components/teams/team-badge";
import { StatusIndicator } from "@/components/match/live-badge";
import { kickoffDateLabel, kickoffTimeLabel } from "@/lib/match-format";

function TeamColumn({ team }: { team: ApiTeam }) {
  return (
    <Link
      href={`/teams/${team.slug ?? team.id}`}
      className="flex flex-col items-center gap-2 text-center rounded-lg p-2 -m-2 hover:bg-surface-2 transition-colors"
    >
      <TeamBadge name={team.name} logoUrl={team.logoUrl} size="lg" />
      <span className="text-sm font-medium">{team.name}</span>
    </Link>
  );
}

export function ScoreHeader({ match }: { match: ApiMatch }) {
  const hasScore = match.homeScore !== null && match.awayScore !== null;

  return (
    <div className="rounded-xl border border-border bg-surface p-6">
      <div className="flex items-center justify-between text-xs text-muted mb-4">
        <span>{match.league.name}</span>
        <StatusIndicator status={match.status} minute={match.minute} />
      </div>

      <div className="grid grid-cols-3 items-center gap-4">
        <TeamColumn team={match.homeTeam} />

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

        <TeamColumn team={match.awayTeam} />
      </div>
    </div>
  );
}
