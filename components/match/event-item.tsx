import type { ApiEvent } from "@/lib/types/api";
import { EVENT_TYPE_META, minuteLabel } from "@/lib/match-format";
import { cn } from "@/lib/utils";

export function EventItem({ event, isNew }: { event: ApiEvent; isNew?: boolean }) {
  const meta = EVENT_TYPE_META[event.type];

  return (
    <div className={cn("flex gap-3 py-3", isNew && "animate-slide-in")}>
      <div className="w-10 shrink-0 text-right font-mono text-xs text-muted pt-0.5">
        {minuteLabel(event.minute, event.extraMinute)}
      </div>
      <div className="min-w-0 flex-1">
        <div className={cn("flex items-center gap-1.5 text-sm font-semibold", meta.tone)}>
          <span>{meta.icon}</span>
          <span>{meta.label}</span>
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
