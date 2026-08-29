/**
 * Common nicknames/abbreviations fans actually use in post titles and
 * search queries (e.g. "Gunners", "ARS") that don't fuzzy-match a team's
 * official name by string similarity alone. Used both to build Reddit
 * search queries and as a matching signal in the fuzzy stage.
 *
 * Small and hand-curated on purpose — this is exactly the kind of lookup
 * table that would move to the database (or a data provider) once the
 * team roster grows past a demo-sized set. See README § Future Improvements.
 */
export const TEAM_ALIASES: Record<string, string[]> = {
  Arsenal: ["Arsenal", "Gunners", "ARS", "AFC"],
  Chelsea: ["Chelsea", "Blues", "CHE", "CFC"],
  Liverpool: ["Liverpool", "Reds", "LIV", "LFC"],
  "Manchester City": ["Manchester City", "Man City", "City", "MCI", "MCFC"],
  "Manchester United": ["Manchester United", "Man United", "Man Utd", "United", "MUN", "MUFC"],
  "Tottenham Hotspur": ["Tottenham Hotspur", "Tottenham", "Spurs", "TOT"],
  Barcelona: ["Barcelona", "Barca", "Barça", "FCB"],
  "Real Madrid": ["Real Madrid", "Madrid", "Los Blancos", "RMA"],
  "Atletico Madrid": ["Atletico Madrid", "Atleti", "ATM"],
  "Bayern Munich": ["Bayern Munich", "Bayern", "FCB", "Munich"],
  "Newcastle United": ["Newcastle United", "Newcastle", "Magpies", "NEW"],
  "Aston Villa": ["Aston Villa", "Villa", "AVL"],
  Sevilla: ["Sevilla", "SEV"],
  "Borussia Dortmund": ["Borussia Dortmund", "Dortmund", "BVB"],
};

export function aliasesFor(teamName: string): string[] {
  return TEAM_ALIASES[teamName] ?? [teamName];
}
