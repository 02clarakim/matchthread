/**
 * Human-readable match URL keys: "manchester-united-ipswich-083026"
 * (home-away-MMDDYY). Not guaranteed unique on its own — upsertMatch adds a
 * numeric suffix on the rare collision (same two teams, same day).
 */

// Filler words safe to drop without making two real clubs collide.
// NB: "united" / "city" are kept — dropping them merges Man Utd/Man City etc.
const DROP_WORDS = new Set([
  "fc",
  "afc",
  "cf",
  "sc",
  "hotspur",
  "wanderers",
  "albion",
  "hove",
  "and",
  "town",
  "county",
]);

export function teamSlug(name: string): string {
  const words = name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter((w) => w && !DROP_WORDS.has(w));

  const slug = (words.length ? words : name.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().split(/\s+/)).join("-");
  return slug || "team";
}

function mmddyy(date: Date): string {
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(date.getUTCDate()).padStart(2, "0");
  const yy = String(date.getUTCFullYear()).slice(-2);
  return `${mm}${dd}${yy}`;
}

export function matchSlug(homeTeamName: string, awayTeamName: string, kickoffAt: Date): string {
  return `${teamSlug(homeTeamName)}-${teamSlug(awayTeamName)}-${mmddyy(kickoffAt)}`;
}

/**
 * Slug for a team *profile* URL — the full club name, just tidied:
 * "Tottenham Hotspur" → "tottenham-hotspur", "Brighton & Hove Albion" →
 * "brighton-hove-albion", "Atlético Madrid" → "atletico-madrid". Keeps
 * every word (unlike teamSlug, which trims filler for compact match URLs).
 */
export function teamProfileSlug(name: string): string {
  const slug = name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "team";
}
