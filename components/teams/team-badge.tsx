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
 */
export function TeamBadge({ name, logoUrl, size = "md" }: TeamBadgeProps) {
  if (logoUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={logoUrl}
        alt={name}
        className={cn("rounded-full object-contain bg-surface-2", sizeClasses[size])}
        onError={(e) => {
          e.currentTarget.style.display = "none";
        }}
      />
    );
  }

  return (
    <div
      className={cn(
        "flex items-center justify-center rounded-full bg-surface-2 border border-border font-semibold text-muted",
        sizeClasses[size]
      )}
      aria-label={name}
    >
      {initials(name)}
    </div>
  );
}
