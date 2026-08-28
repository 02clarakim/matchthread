import type { MatchStatus } from "@prisma/client";
import { STATUS_META, minuteLabel } from "@/lib/match-format";
import { cn } from "@/lib/utils";

export function StatusIndicator({ status, minute }: { status: MatchStatus; minute: number | null }) {
  const meta = STATUS_META[status];

  if (meta.live) {
    return (
      <span className={cn("inline-flex items-center gap-1.5 text-xs font-semibold", meta.tone)}>
        <span className="h-1.5 w-1.5 rounded-full bg-current animate-live-dot" />
        {status === "LIVE" && minute ? minuteLabel(minute) : meta.label}
      </span>
    );
  }

  return <span className={cn("text-xs font-medium", meta.tone)}>{meta.label}</span>;
}
