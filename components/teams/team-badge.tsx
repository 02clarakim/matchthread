"use client";

import { initials } from "@/lib/match-format";
import { cn } from "@/lib/utils";

interface TeamBadgeProps {
  name: string;
  logoUrl?: string | null;
  size?: "sm" | "md" | "lg";
}

const sizeClasses = {
  sm: "h-6 w-6 text-[10px]",
  md: "h-9 w-9 text-xs",
  lg: "h-14 w-14 text-lg",
};

/**
 * Renders a team's crest if we have one, otherwise a deterministic
 * initials badge — never a broken image icon. Team logos come from
 * third-party sources, so this is also the one place that needs to
 * tolerate a bad/missing URL gracefully.
 *
 * Decorative by design: every call site pairs this with the team's name as
 * visible text right next to it, so the badge carries no accessible name of
 * its own (`alt=""` / `aria-hidden`) — otherwise a screen reader, or a
 * naive text-extraction of the page, announces the name twice.
 */
export function TeamBadge({ name, logoUrl, size = "md" }: TeamBadgeProps) {
  if (logoUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={logoUrl}
        alt=""
        className={cn("rounded-full object-contain bg-surface-2", sizeClasses[size])}
        onError={(e) => {
          e.currentTarget.style.display = "none";
        }}
      />
    );
  }

  return (
    <div
      aria-hidden="true"
      className={cn(
        "flex items-center justify-center rounded-full bg-surface-2 border border-border font-semibold text-muted",
        sizeClasses[size]
      )}
    >
      {initials(name)}
    </div>
  );
}
