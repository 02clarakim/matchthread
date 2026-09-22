import Link from "next/link";
import type { ApiEvent, ApiMatch, ApiTeam } from "@/lib/types/api";
import { TeamBadge } from "@/components/teams/team-badge";
import { StatusIndicator } from "@/components/match/live-badge";
import { kickoffDateLabel, kickoffTimeLabel, goalLineLabel } from "@/lib/match-format";

function TeamColumn({ team, goals }: { team: ApiTeam; goals: ApiEvent[] }) {
  return (
    <div className="flex flex-col items-center gap-2 text-center">
      <Link
        href={`/teams/${team.slug ?? team.id}`}
        className="flex flex-col items-center gap-2 rounded-lg p-2 -m-2 hover:bg-surface-2 transition-colors"
      >
        <TeamBadge name={team.name} logoUrl={team.logoUrl} size="lg" />
        <span className="text-sm font-medium">{team.name}</span>
      </Link>
      {goals.length > 0 && (
        <ul className="space-y-0.5">
          {goals.map((g) => (
            <li key={g.id} className="text-xs text-muted tabular-nums">
              {goalLineLabel(g)}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

interface ScoreHeaderProps {
  match: ApiMatch;
  /** Goal-type events for each side, oldest first — rendered as a scoreboard-style scorer list under the team name. Omit to show none (e.g. the homepage preview). */
  homeGoals?: ApiEvent[];
  awayGoals?: ApiEvent[];
}

export function ScoreHeader({ match, homeGoals = [], awayGoals = [] }: ScoreHeaderProps) {
  const hasScore = match.homeScore !== null && match.awayScore !== null;

  return (
    <div className="rounded-xl border border-border bg-surface p-6">
      <div className="flex items-center justify-between text-xs text-muted mb-4 gap-2">
        <span className="truncate">
          {match.league.name} · {kickoffDateLabel(match.kickoffAt)}
        </span>
        <StatusIndicator status={match.status} minute={match.minute} />
      </div>

      <div className="grid grid-cols-3 items-start gap-4">
        <TeamColumn team={match.homeTeam} goals={homeGoals} />

        <div className="text-center">
          {hasScore ? (
            <div className="text-4xl font-bold tabular-nums font-mono">
              {match.homeScore} – {match.awayScore}
            </div>
          ) : (
            <div className="text-lg text-muted">{kickoffTimeLabel(match.kickoffAt)}</div>
          )}
          {match.venue && <div className="mt-1 text-xs text-muted">{match.venue}</div>}
        </div>

        <TeamColumn team={match.awayTeam} goals={awayGoals} />
      </div>
    </div>
  );
}
