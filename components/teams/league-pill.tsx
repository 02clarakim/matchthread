import { cn } from "@/lib/utils";
import { leagueColorClasses } from "@/lib/league-format";

export function LeaguePill({ name, className }: { name: string; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap",
        leagueColorClasses(name),
        className
      )}
    >
      {name}
    </span>
  );
}
