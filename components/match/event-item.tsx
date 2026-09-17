import type { ApiEvent, ApiTeam } from "@/lib/types/api";
import { EVENT_TYPE_META, TEAM_SIDE_TONE, minuteLabel } from "@/lib/match-format";
import { TeamBadge } from "@/components/teams/team-badge";
import { cn } from "@/lib/utils";

interface EventItemProps {
  event: ApiEvent;
  isNew?: boolean;
  /** Which team the event belongs to, and its side in *this* match — omit when unknown (e.g. the homepage preview). */
  team?: ApiTeam | null;
  side?: "home" | "away" | null;
}

export function EventItem({ event, isNew, team, side }: EventItemProps) {
  const meta = EVENT_TYPE_META[event.type];

  return (
    <div className={cn("flex gap-3 py-3", isNew && "animate-slide-in")}>
      <div className="w-10 shrink-0 text-right font-mono text-xs text-muted pt-0.5">
        {minuteLabel(event.minute, event.extraMinute)}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <div className={cn("flex items-center gap-1.5 text-sm font-semibold", meta.tone)}>
            <span>{meta.icon}</span>
            <span>{meta.label}</span>
          </div>
          {team && side && (
            <div className={cn("flex min-w-0 shrink-0 items-center gap-1.5", TEAM_SIDE_TONE[side])}>
              <TeamBadge name={team.name} logoUrl={team.logoUrl} size="sm" />
              <span className="truncate text-[11px] font-semibold uppercase tracking-wide">{team.name}</span>
            </div>
          )}
        </div>
        {event.playerName && (
          <div className="mt-0.5 text-sm font-medium">
            {event.playerName}
            {event.type === "SUBSTITUTION" && event.assistName && (
              <span className="text-muted font-normal"> replaces {event.assistName}</span>
            )}
          </div>
        )}
        {event.commentary && (
          <p className="mt-1 text-sm text-muted leading-snug">{event.commentary}</p>
        )}
      </div>
    </div>
  );
}
