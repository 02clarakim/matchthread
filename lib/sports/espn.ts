import { fetchWithRetry } from "../http/fetch-with-retry";
import { logger } from "../logger";
import type { MatchEventType, MatchStatus } from "@prisma/client";

/**
 * ESPN's public site API (`site.api.espn.com`) — the same endpoints
 * espn.com's own web frontend calls. No key, no published rate limit, no
 * developer program. We use it for two things, both low-volume:
 *
 *  - `fetchEspnScoreboard` — one call per league returns every fixture in a
 *    date range with status + score. Backs both the on-demand backfill
 *    (scripts/backfill.ts) and the live poller (workers/espn-live-poller.ts,
 *    which only fetches the full summary on a half-time / full-time
 *    transition, not every cycle).
 *  - `fetchEspnMatch` — one match summary with goalscorers + cards, the
 *    authoritative record the Reddit-sourced data is verified against
 *    (lib/matching/verify-goals.ts).
 */

const BASE = "https://site.api.espn.com/apis/site/v2/sports/soccer";

export const LEAGUE_NAMES: Record<string, string> = {
  "eng.1": "Premier League",
  "esp.1": "La Liga",
  "ger.1": "Bundesliga",
  "ita.1": "Serie A",
  "fra.1": "Ligue 1",
};

/** ESPN's `season.slug` for the league fixtures we ingest — used to reject cup ties / wrong-competition rows that ESPN mixes into a league scoreboard. */
export const LEAGUE_SEASON_SLUG_HINT: Record<string, string> = {
  "eng.1": "premier-league",
  "esp.1": "laliga",
  "ger.1": "bundesliga",
  "ita.1": "serie-a",
  "fra.1": "ligue-1",
};

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

/** Maps an ESPN `status.type.name` onto our MatchStatus. Unknown in-play states default to LIVE. */
export function mapEspnStatus(name: string | undefined): MatchStatus {
  switch (name) {
    case "STATUS_SCHEDULED":
    case "STATUS_PRE_MATCH":
      return "SCHEDULED";
    case "STATUS_HALFTIME":
      return "PAUSED";
    case "STATUS_FULL_TIME":
    case "STATUS_FINAL":
    case "STATUS_FINAL_AET":
    case "STATUS_FINAL_PEN":
      return "FINISHED";
    case "STATUS_POSTPONED":
      return "POSTPONED";
    case "STATUS_CANCELED":
    case "STATUS_CANCELLED":
      return "CANCELLED";
    case "STATUS_ABANDONED":
      return "FINISHED";
    default:
      // STATUS_FIRST_HALF, STATUS_SECOND_HALF, STATUS_EXTRA_TIME,
      // STATUS_FIRST_EXTRA, STATUS_SECOND_EXTRA, STATUS_SHOOTOUT, STATUS_IN_PROGRESS…
      return "LIVE";
  }
}

// ---------------------------------------------------------------------------
// Scoreboard (list)
// ---------------------------------------------------------------------------

export interface EspnScoreboardMatch {
  espnEventId: string;
  league: string;
  leagueName: string;
  seasonSlug: string | null;
  kickoffAt: Date;
  venue: string | null;
  status: MatchStatus;
  statusName: string;
  /** ESPN's own displayed clock, e.g. "62'", "HT", "FT" — informational. */
  displayClock: string | null;
  minute: number | null;
  home: EspnScoreboardTeam;
  away: EspnScoreboardTeam;
}

export interface EspnScoreboardTeam {
  espnId: string;
  name: string;
  abbreviation: string | null;
  score: number | null;
  logo: string | null;
}

interface RawCompetitor {
  homeAway: "home" | "away";
  score?: string | number;
  team?: {
    id?: string;
    displayName?: string;
    abbreviation?: string;
    shortDisplayName?: string;
    logo?: string;
    logos?: Array<{ href?: string }>;
  };
}

interface RawScoreboard {
  events?: Array<{
    id: string;
    date: string;
    season?: { slug?: string };
    status?: { type?: { name?: string }; displayClock?: string; clock?: number };
    competitions?: Array<{
      venue?: { fullName?: string };
      status?: { type?: { name?: string }; displayClock?: string };
      competitors?: RawCompetitor[];
    }>;
  }>;
}

function toScoreboardTeam(c: RawCompetitor): EspnScoreboardTeam {
  const id = c.team?.id ?? "";
  return {
    espnId: id,
    name: c.team?.displayName ?? c.team?.shortDisplayName ?? "Unknown",
    abbreviation: c.team?.abbreviation ?? null,
    score: c.score === undefined || c.score === null || c.score === "" ? null : Number(c.score),
    logo:
      c.team?.logo ??
      c.team?.logos?.[0]?.href ??
      (id ? `https://a.espncdn.com/i/teamlogos/soccer/500/${id}.png` : null),
  };
}

/**
 * Every fixture for a league within a date window. `dates` is an ESPN range
 * string: "YYYYMMDD" or "YYYYMMDD-YYYYMMDD".
 */
export async function fetchEspnScoreboard(league: string, dates: string): Promise<EspnScoreboardMatch[]> {
  const url = `${BASE}/${league}/scoreboard?dates=${dates}`;
  const res = await fetchWithRetry(url, {}, { label: "espn_scoreboard", retries: 3, timeoutMs: 10000 });
  if (!res.ok) throw new Error(`espn_scoreboard responded ${res.status} for ${league} ${dates}`);

  const raw = (await res.json()) as RawScoreboard;
  const out: EspnScoreboardMatch[] = [];

  for (const e of raw.events ?? []) {
    const comp = e.competitions?.[0];
    const competitors = comp?.competitors ?? [];
    const home = competitors.find((c) => c.homeAway === "home");
    const away = competitors.find((c) => c.homeAway === "away");
    if (!home || !away) continue;

    const statusName = e.status?.type?.name ?? comp?.status?.type?.name ?? "STATUS_SCHEDULED";
    const clockSeconds = e.status?.clock;

    out.push({
      espnEventId: e.id,
      league,
      leagueName: LEAGUE_NAMES[league] ?? league,
      seasonSlug: e.season?.slug ?? null,
      kickoffAt: new Date(e.date),
      venue: comp?.venue?.fullName ?? null,
      status: mapEspnStatus(statusName),
      statusName,
      displayClock: e.status?.displayClock ?? comp?.status?.displayClock ?? null,
      minute:
        typeof clockSeconds === "number" && clockSeconds > 0 ? Math.min(130, Math.round(clockSeconds / 60)) : null,
      home: toScoreboardTeam(home),
      away: toScoreboardTeam(away),
    });
  }

  logger.info("espn_scoreboard_fetched", { league, dates, matches: out.length });
  return out;
}

export interface EspnTeamInfo {
  espnId: string;
  name: string;
  abbreviation: string | null;
  logo: string | null;
}

/** Every team in a league, with crest URLs — used to backfill logos for clubs that have no fixtures in the current window. */
export async function fetchEspnTeams(league: string): Promise<EspnTeamInfo[]> {
  const url = `${BASE}/${league}/teams`;
  const res = await fetchWithRetry(url, {}, { label: "espn_teams", retries: 2, timeoutMs: 10000 });
  if (!res.ok) throw new Error(`espn_teams responded ${res.status} for ${league}`);
  const raw = (await res.json()) as {
    sports?: Array<{ leagues?: Array<{ teams?: Array<{ team?: RawTeamInfo } | RawTeamInfo> }> }>;
  };
  const rows = raw.sports?.[0]?.leagues?.[0]?.teams ?? [];
  return rows.map((row) => {
    const t = ("team" in row ? row.team : row) as RawTeamInfo;
    return {
      espnId: t.id ?? "",
      name: t.displayName ?? t.name ?? "Unknown",
      abbreviation: t.abbreviation ?? null,
      logo: t.logos?.[0]?.href ?? t.logo ?? (t.id ? `https://a.espncdn.com/i/teamlogos/soccer/500/${t.id}.png` : null),
    };
  });
}

interface RawTeamInfo {
  id?: string;
  displayName?: string;
  name?: string;
  abbreviation?: string;
  logo?: string;
  logos?: Array<{ href?: string }>;
}

/** Keeps only rows that are genuinely this league's competition (ESPN mixes cup ties into a league scoreboard). */
export function isLeagueFixture(m: EspnScoreboardMatch): boolean {
  const hint = LEAGUE_SEASON_SLUG_HINT[m.league];
  if (!hint) return true;
  return m.seasonSlug ? m.seasonSlug.includes(hint) : true;
}

// ---------------------------------------------------------------------------
// Match summary (detail: goals + cards)
// ---------------------------------------------------------------------------

export interface EspnGoal {
  minute: number;
  extraMinute: number | null;
  scorer: string | null;
  assist: string | null;
  teamEspnId: string;
  teamName: string;
  type: Extract<MatchEventType, "GOAL" | "PENALTY_GOAL" | "OWN_GOAL">;
  /** ESPN's own play-by-play sentence for this moment — grounding for the LLM commentary provider, never shown verbatim. */
  sourceText: string | null;
}

export interface EspnCard {
  minute: number;
  extraMinute: number | null;
  player: string | null;
  teamEspnId: string;
  teamName: string;
  type: Extract<MatchEventType, "YELLOW_CARD" | "RED_CARD" | "SECOND_YELLOW_CARD">;
  sourceText: string | null;
}

export interface EspnSubstitution {
  minute: number;
  extraMinute: number | null;
  /** Player coming on. */
  playerOn: string | null;
  /** Player coming off. */
  playerOff: string | null;
  teamEspnId: string;
  teamName: string;
  sourceText: string | null;
}

export interface EspnVarEvent {
  minute: number;
  extraMinute: number | null;
  player: string | null;
  teamEspnId: string;
  teamName: string;
  sourceText: string | null;
}

export interface EspnMatch {
  espnEventId: string;
  leagueName: string;
  kickoffAt: Date;
  venue: string | null;
  completed: boolean;
  statusName: string;
  home: { espnId: string; name: string; abbreviation: string | null; score: number };
  away: { espnId: string; name: string; abbreviation: string | null; score: number };
  goals: EspnGoal[];
  cards: EspnCard[];
  substitutions: EspnSubstitution[];
  varEvents: EspnVarEvent[];
}

interface EspnCompetitor {
  homeAway: "home" | "away";
  score: string | number;
  team: { id: string; displayName: string; abbreviation?: string };
}

interface EspnKeyEvent {
  scoringPlay?: boolean;
  shootout?: boolean;
  clock?: { displayValue?: string };
  type?: { text?: string };
  team?: { id: string; displayName: string };
  participants?: Array<{ athlete?: { displayName?: string } }>;
  /** ESPN's play-by-play sentence for this moment, e.g. "Goal! ... left footed shot ... Assisted by ... with a headed pass." */
  text?: string;
}

interface EspnSummary {
  header: {
    id: string;
    competitions: Array<{
      date: string;
      competitors: EspnCompetitor[];
      status?: { type?: { completed?: boolean; name?: string } };
    }>;
  };
  gameInfo?: { venue?: { fullName?: string } };
  keyEvents?: EspnKeyEvent[];
}

/** "62'" -> {minute:62, extra:null}; "90'+5'" / "90+5'" -> {minute:90, extra:5}. */
export function parseEspnClock(displayValue: string | undefined): { minute: number; extraMinute: number | null } | null {
  if (!displayValue) return null;
  const match = displayValue.match(/(\d{1,3})\s*'?\s*(?:\+\s*(\d{1,2}))?/);
  if (!match) return null;
  const minute = Number(match[1]);
  if (!Number.isFinite(minute) || minute < 1 || minute > 130) return null;
  return { minute, extraMinute: match[2] ? Number(match[2]) : null };
}

function goalTypeFromText(text: string | undefined): EspnGoal["type"] {
  const t = (text ?? "").toLowerCase();
  if (t.includes("own goal")) return "OWN_GOAL";
  if (t.includes("penalty")) return "PENALTY_GOAL";
  return "GOAL";
}

function cardTypeFromText(text: string): EspnCard["type"] | null {
  const t = text.toLowerCase();
  if (!t.includes("card")) return null;
  if (t.includes("red")) return "RED_CARD";
  if (t.includes("second") || t.includes("2nd")) return "SECOND_YELLOW_CARD";
  if (t.includes("yellow")) return "YELLOW_CARD";
  return null;
}

function isVarText(text: string): boolean {
  return /\bvar\b|video (assistant )?referee|video review/i.test(text);
}

function extractGoals(keyEvents: EspnKeyEvent[]): EspnGoal[] {
  const goals: EspnGoal[] = [];
  for (const e of keyEvents) {
    const isGoal = e.scoringPlay === true || /goal/i.test(e.type?.text ?? "");
    if (!isGoal || e.shootout || !e.team) continue;
    const clock = parseEspnClock(e.clock?.displayValue);
    if (!clock) continue; // shootout "goals" have no minute
    goals.push({
      minute: clock.minute,
      extraMinute: clock.extraMinute,
      scorer: e.participants?.[0]?.athlete?.displayName ?? null,
      assist: e.participants?.[1]?.athlete?.displayName ?? null,
      teamEspnId: e.team.id,
      teamName: e.team.displayName,
      type: goalTypeFromText(e.type?.text),
      sourceText: e.text ?? null,
    });
  }
  return goals.sort(byClock);
}

function extractCards(keyEvents: EspnKeyEvent[]): EspnCard[] {
  const cards: EspnCard[] = [];
  for (const e of keyEvents) {
    if (!e.team) continue;
    const type = cardTypeFromText(e.type?.text ?? "");
    if (!type) continue;
    const clock = parseEspnClock(e.clock?.displayValue);
    if (!clock) continue;
    cards.push({
      minute: clock.minute,
      extraMinute: clock.extraMinute,
      player: e.participants?.[0]?.athlete?.displayName ?? null,
      teamEspnId: e.team.id,
      teamName: e.team.displayName,
      type,
      sourceText: e.text ?? null,
    });
  }
  return cards.sort(byClock);
}

/** ESPN lists a sub as "Player On" then "Player Off" in participants, matching the text: "X replaces Y." */
function extractSubstitutions(keyEvents: EspnKeyEvent[]): EspnSubstitution[] {
  const subs: EspnSubstitution[] = [];
  for (const e of keyEvents) {
    if (!e.team || !/substitution/i.test(e.type?.text ?? "")) continue;
    const clock = parseEspnClock(e.clock?.displayValue);
    if (!clock) continue;
    subs.push({
      minute: clock.minute,
      extraMinute: clock.extraMinute,
      playerOn: e.participants?.[0]?.athlete?.displayName ?? null,
      playerOff: e.participants?.[1]?.athlete?.displayName ?? null,
      teamEspnId: e.team.id,
      teamName: e.team.displayName,
      sourceText: e.text ?? null,
    });
  }
  return subs.sort(byClock);
}

/**
 * VAR reviews aren't a distinct, reliably-labeled keyEvent type in ESPN's
 * free feed (a confirmed penalty just shows up as "Penalty - Scored", for
 * example) — this only catches the rarer case where the type text or
 * commentary explicitly says so. Best-effort, like the rest of this file.
 */
function extractVarEvents(keyEvents: EspnKeyEvent[]): EspnVarEvent[] {
  const events: EspnVarEvent[] = [];
  for (const e of keyEvents) {
    if (!e.team) continue;
    const text = `${e.type?.text ?? ""} ${e.text ?? ""}`;
    if (!isVarText(text)) continue;
    const clock = parseEspnClock(e.clock?.displayValue);
    if (!clock) continue;
    events.push({
      minute: clock.minute,
      extraMinute: clock.extraMinute,
      player: e.participants?.[0]?.athlete?.displayName ?? null,
      teamEspnId: e.team.id,
      teamName: e.team.displayName,
      sourceText: e.text ?? null,
    });
  }
  return events.sort(byClock);
}

function byClock(a: { minute: number; extraMinute: number | null }, b: { minute: number; extraMinute: number | null }): number {
  return a.minute + (a.extraMinute ?? 0) / 100 - (b.minute + (b.extraMinute ?? 0) / 100);
}

/** Shapes a raw ESPN summary payload into our EspnMatch. Exported for testing against a captured fixture. */
export function normalizeEspnSummary(summary: EspnSummary): EspnMatch {
  const comp = summary.header.competitions[0];
  const home = comp.competitors.find((c) => c.homeAway === "home");
  const away = comp.competitors.find((c) => c.homeAway === "away");
  if (!home || !away) throw new Error("ESPN summary missing home/away competitor");

  const keyEvents = summary.keyEvents ?? [];
  return {
    espnEventId: summary.header.id,
    leagueName: "",
    kickoffAt: new Date(comp.date),
    venue: summary.gameInfo?.venue?.fullName ?? null,
    completed: comp.status?.type?.completed ?? false,
    statusName: comp.status?.type?.name ?? "",
    home: { espnId: home.team.id, name: home.team.displayName, abbreviation: home.team.abbreviation ?? null, score: Number(home.score) },
    away: { espnId: away.team.id, name: away.team.displayName, abbreviation: away.team.abbreviation ?? null, score: Number(away.score) },
    goals: extractGoals(keyEvents),
    cards: extractCards(keyEvents),
    substitutions: extractSubstitutions(keyEvents),
    varEvents: extractVarEvents(keyEvents),
  };
}

/** Fetches and normalizes one match summary by ESPN event id. `league` is an ESPN slug e.g. "eng.1". */
export async function fetchEspnMatch(eventId: string, league = "eng.1"): Promise<EspnMatch> {
  const url = `${BASE}/${league}/summary?event=${encodeURIComponent(eventId)}`;
  const res = await fetchWithRetry(url, {}, { label: "espn_summary", retries: 3, timeoutMs: 8000 });
  if (!res.ok) throw new Error(`espn_summary responded ${res.status} for event ${eventId}`);

  const match = normalizeEspnSummary((await res.json()) as EspnSummary);
  match.leagueName = LEAGUE_NAMES[league] ?? league;
  logger.info("espn_match_fetched", {
    eventId,
    score: `${match.home.score}-${match.away.score}`,
    goals: match.goals.length,
    cards: match.cards.length,
    subs: match.substitutions.length,
    completed: match.completed,
  });
  return match;
}
