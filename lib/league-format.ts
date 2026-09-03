/** Display order for leagues wherever they're grouped or filtered — not alphabetical, a deliberate ranking. */
export const LEAGUE_ORDER = ["Premier League", "La Liga", "Bundesliga"];

export function leagueSortIndex(leagueName: string): number {
  const index = LEAGUE_ORDER.indexOf(leagueName);
  return index === -1 ? LEAGUE_ORDER.length : index;
}

/** Distinct, on-brand-ish colors per league so they're recognizable as pills at a glance. Unlisted leagues fall back to a neutral pill. */
const LEAGUE_COLORS: Record<string, string> = {
  "Premier League": "bg-violet-500/15 text-violet-300 border-violet-500/30",
  "La Liga": "bg-orange-500/15 text-orange-300 border-orange-500/30",
  Bundesliga: "bg-red-500/15 text-red-300 border-red-500/30",
};

const DEFAULT_LEAGUE_COLOR = "bg-surface-2 text-muted border-border";

export function leagueColorClasses(leagueName: string): string {
  return LEAGUE_COLORS[leagueName] ?? DEFAULT_LEAGUE_COLOR;
}
