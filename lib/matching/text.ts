/** Small, dependency-free string-similarity helpers shared by the matching stages. */

const DIACRITICS_PATTERN = new RegExp("[\\u0300-\\u036f]", "g");

export function normalizeText(input: string): string {
  return input
    .normalize("NFD")
    .replace(DIACRITICS_PATTERN, "") // strip diacritics (e.g. "Barça" -> "Barca")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function tokenize(input: string): string[] {
  return normalizeText(input).split(" ").filter(Boolean);
}

export function containsWord(haystack: string, needle: string): boolean {
  const tokens = new Set(tokenize(haystack));
  const needleTokens = tokenize(needle);
  if (needleTokens.length === 0) return false;
  return needleTokens.every((t) => tokens.has(t));
}

/** Levenshtein edit distance — used for tolerant last-name matching (typos). */
export function editDistance(a: string, b: string): number {
  const dp: number[][] = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = 0; i <= a.length; i++) dp[i][0] = i;
  for (let j = 0; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] =
        a[i - 1] === b[j - 1]
          ? dp[i - 1][j - 1]
          : 1 + Math.min(dp[i - 1][j - 1], dp[i - 1][j], dp[i][j - 1]);
    }
  }
  return dp[a.length][b.length];
}

/** Jaccard similarity between the token sets of two strings. */
export function tokenOverlapScore(a: string, b: string): number {
  const setA = new Set(tokenize(a));
  const setB = new Set(tokenize(b));
  if (setA.size === 0 || setB.size === 0) return 0;
  let intersection = 0;
  for (const t of setA) if (setB.has(t)) intersection += 1;
  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}
