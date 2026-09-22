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

/**
 * Home vs away text color for the team tag on a timeline row — deliberately
 * distinct from the event-tone palette above (accent/info/warning/danger)
 * so "which team" never reads as "what kind of event".
 */
export const TEAM_SIDE_TONE: Record<"home" | "away", string> = {
  home: "text-sky-600 dark:text-sky-400",
  away: "text-fuchsia-600 dark:text-fuchsia-400",
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

export const GOAL_EVENT_TYPES: MatchEventType[] = ["GOAL", "PENALTY_GOAL", "OWN_GOAL"];

/** "Saka 59'", "Elanga 62' (pen.)", "Greaves 90' (OG)" — the scoreboard-style line under a team's name. */
export function goalLineLabel(event: { playerName: string | null; minute: number; extraMinute?: number | null; type: MatchEventType }): string {
  const suffix = event.type === "PENALTY_GOAL" ? " (pen.)" : event.type === "OWN_GOAL" ? " (OG)" : "";
  return `${event.playerName ?? "Unknown"} ${minuteLabel(event.minute, event.extraMinute)}${suffix}`;
}

export function kickoffTimeLabel(kickoffAt: string | Date): string {
  const date = typeof kickoffAt === "string" ? new Date(kickoffAt) : kickoffAt;
  return date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

/** Same calendar day in the viewer's local timezone, not a raw 24h difference. */
function isSameLocalDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/** "Today" / "Yesterday" for a nearby date, else "Wed, Sep 16". */
export function kickoffDateLabel(kickoffAt: string | Date): string {
  const date = typeof kickoffAt === "string" ? new Date(kickoffAt) : kickoffAt;
  const now = new Date();
  if (isSameLocalDay(date, now)) return "Today";
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (isSameLocalDay(date, yesterday)) return "Yesterday";
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
