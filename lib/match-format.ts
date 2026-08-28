import type { MatchEventType, MatchStatus } from "@prisma/client";

export const EVENT_TYPE_META: Record<MatchEventType, { icon: string; label: string; tone: string }> = {
  GOAL: { icon: "⚽", label: "Goal", tone: "text-accent" },
  OWN_GOAL: { icon: "⚽", label: "Own Goal", tone: "text-danger" },
  PENALTY_GOAL: { icon: "⚽", label: "Penalty", tone: "text-accent" },
  PENALTY_MISSED: { icon: "🚫", label: "Penalty Missed", tone: "text-muted" },
  YELLOW_CARD: { icon: "🟨", label: "Yellow Card", tone: "text-warning" },
  RED_CARD: { icon: "🟥", label: "Red Card", tone: "text-danger" },
  SECOND_YELLOW_CARD: { icon: "🟥", label: "Second Yellow", tone: "text-danger" },
  SUBSTITUTION: { icon: "🔄", label: "Substitution", tone: "text-info" },
  VAR_DECISION: { icon: "📺", label: "VAR Review", tone: "text-info" },
  KICKOFF: { icon: "🏁", label: "Kick-off", tone: "text-muted" },
  HALFTIME: { icon: "⏸", label: "Half-time", tone: "text-muted" },
  FULLTIME: { icon: "🏆", label: "Full-time", tone: "text-muted" },
  OTHER: { icon: "ℹ", label: "Event", tone: "text-muted" },
};

export const STATUS_META: Record<MatchStatus, { label: string; tone: string; live: boolean }> = {
  SCHEDULED: { label: "Scheduled", tone: "text-muted", live: false },
  LIVE: { label: "Live", tone: "text-accent", live: true },
  PAUSED: { label: "Half-time", tone: "text-warning", live: true },
  FINISHED: { label: "Full-time", tone: "text-muted", live: false },
  POSTPONED: { label: "Postponed", tone: "text-warning", live: false },
  CANCELLED: { label: "Cancelled", tone: "text-danger", live: false },
};

export function minuteLabel(minute: number, extraMinute?: number | null): string {
  return extraMinute ? `${minute}+${extraMinute}'` : `${minute}'`;
}

export function kickoffTimeLabel(kickoffAt: string | Date): string {
  const date = typeof kickoffAt === "string" ? new Date(kickoffAt) : kickoffAt;
  return date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

export function kickoffDateLabel(kickoffAt: string | Date): string {
  const date = typeof kickoffAt === "string" ? new Date(kickoffAt) : kickoffAt;
  return date.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

export function initials(name: string): string {
  return name
    .split(" ")
    .map((part) => part[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}
