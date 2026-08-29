"use client";

import type { MatchStatus } from "@prisma/client";
import { STATUS_META, minuteLabel } from "@/lib/match-format";
import { cn } from "@/lib/utils";
import { useTickingMinute } from "@/lib/hooks/use-ticking-minute";

export function StatusIndicator({ status, minute }: { status: MatchStatus; minute: number | null }) {
  const meta = STATUS_META[status];
  const tickingMinute = useTickingMinute(status === "LIVE", minute);

  if (meta.live) {
    return (
      <span className={cn("inline-flex items-center gap-1.5 text-xs font-semibold", meta.tone)}>
        <span className="h-1.5 w-1.5 rounded-full bg-current animate-live-dot" />
        {status === "LIVE" && tickingMinute ? minuteLabel(tickingMinute) : meta.label}
      </span>
    );
  }

  return <span className={cn("text-xs font-medium", meta.tone)}>{meta.label}</span>;
}
