import OpenAI from "openai";
import type { CommentaryProvider, CommentaryInput, Commentary } from "./provider";
import { logger } from "../logger";

/**
 * Generates one plain, factual sentence describing a match event — a match
 * report line, not broadcast commentary. Richer than our template (which
 * only ever says "X scores for Y after being set up by Z"), but
 * deliberately flat: no hype, no adjectives, no exclamation marks. It
 * describes what physically happened — the shot, the buildup, the
 * incident — the same register as a written match report.
 *
 * `input.sourceText` (ESPN's own play-by-play sentence, when we have it —
 * see lib/sports/espn.ts) is passed in as *background detail to draw facts
 * from* — shot type, placement, how the chance arose, why a card was shown
 * — never as text to paraphrase or lift phrasing from. This project already
 * drew that line once (see lib/commentary/fotmob.ts's doc comment on why
 * FotMob's own commentary text is never reused); the same principle
 * applies here: facts are fair game, someone else's prose isn't. The model
 * is instructed accordingly, and the few-shot examples below are written
 * fresh for this prompt, not lifted from any real broadcast or article.
 *
 * Cheap by design: gpt-4o-mini, one short call per event, ~$0.0001 each.
 * Commentary is persisted once per event (see MatchEvent.commentaryFetchedAt),
 * so this never runs twice for the same event.
 */

const MODEL = "gpt-4o-mini";
const TIMEOUT_MS = 4000;

let client: OpenAI | null | undefined;

function getClient(): OpenAI | null {
  if (client !== undefined) return client;
  const apiKey = process.env.OPENAI_API_KEY;
  client = apiKey ? new OpenAI({ apiKey, timeout: TIMEOUT_MS, maxRetries: 1 }) : null;
  return client;
}

const SYSTEM_PROMPT = `You write a single, plain, factual sentence describing a football (soccer) match event — a goal, card, substitution, or VAR incident. This is a line from a written match report, NOT broadcast commentary.

Rules:
- Output exactly ONE sentence. No preamble, no quotes, no markdown, no exclamation marks.
- Do not use subjective or evaluative adjectives — no "stunning", "brilliant", "clinical", "crucial", "sensational", "superb", or similar. Do not editorialize about stakes, pressure, momentum, or drama.
- Describe what physically happened: the type of shot or action, where it went, and how it came about (a pass, a corner, a rebound, a tackle) when that detail is available. Keep the tone as neutral for a card or substitution as for a goal.
- Use only the facts given to you. Never invent a concrete fact (shot placement, distance, injury, decision) beyond what's given.
- "Additional detail" is background context to pull facts from — extract facts from it, but write your own sentence. Do not copy its wording or sentence structure.
- Use the actual player/team names, not pronouns.
- Never state the minute or any time reference (no "in the 62nd minute", "90+6'", "late in the half", "early on", etc.) — the minute is already shown elsewhere in the UI, right next to this sentence.

Examples of the target register (facts -> sentence):

Facts: type=GOAL, team=Newcastle United, opponent=Tottenham Hotspur, player=Anthony Elanga, assist=Amar Dedic, additional detail=left footed shot from the centre of the box to the bottom right corner. Assisted by Amar Dedic with a headed pass.
Sentence: Anthony Elanga scores with a left-footed shot from the centre of the box, after a headed pass into the area from Amar Dedic.

Facts: type=YELLOW_CARD, team=Newcastle United, player=Nico González, additional detail=shown for a bad foul
Sentence: Nico González is shown a yellow card for a foul.

Facts: type=SUBSTITUTION, team=Tottenham Hotspur, player=Mikey Moore (coming on), player coming off=Archie Gray
Sentence: Tottenham Hotspur make a substitution, sending on Mikey Moore in place of Archie Gray.`;

function typeLabel(type: string): string {
  return type.replace(/_/g, " ").toLowerCase();
}

function describeEvent(input: CommentaryInput): string {
  const lines = [
    `type=${input.type}`,
    input.teamName ? `team=${input.teamName}` : null,
    input.opponentName ? `opponent=${input.opponentName}` : null,
    input.playerName
      ? `player=${input.playerName}${input.type === "SUBSTITUTION" ? " (coming on)" : ""}`
      : null,
    input.assistName
      ? input.type === "SUBSTITUTION"
        ? `player coming off=${input.assistName}`
        : `assist=${input.assistName}`
      : null,
    input.detail ? `detail=${input.detail}` : null,
    input.sourceText ? `additional detail (facts only, do not copy wording)=${input.sourceText}` : null,
  ].filter(Boolean);
  return lines.join("\n");
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * OpenAI's 429s come in two unrelated flavors that need opposite handling:
 *   - "tokens per min (TPM)" / "requests per min (RPM)" — a short rolling
 *     window that empties out again within seconds, purely a symptom of
 *     bursting too many concurrent calls at once. Worth one short wait+retry.
 *   - "requests per day (RPD)" — a real daily cap; retrying does nothing
 *     until it resets, so give up immediately and let the caller's circuit
 *     breaker notice the pattern (see scripts/regenerate-commentary.ts).
 */
function isBurstRateLimit(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /tokens per min|requests per min/i.test(message) && !/requests per day/i.test(message);
}

function parseRetryAfterMs(err: unknown, fallbackMs: number): number {
  const message = err instanceof Error ? err.message : String(err);
  const match = message.match(/try again in ([\d.]+)(ms|s)\b/i);
  if (!match) return fallbackMs;
  const value = parseFloat(match[1]);
  const ms = match[2].toLowerCase() === "s" ? value * 1000 : value;
  return Math.min(Math.max(ms, 100), 5000);
}

export const llmCommentaryProvider: CommentaryProvider = {
  name: "llm",

  async getCommentary(input: CommentaryInput): Promise<Commentary | null> {
    const openai = getClient();
    if (!openai) return null;

    const messages = [
      { role: "system" as const, content: SYSTEM_PROMPT },
      { role: "user" as const, content: `Write the report sentence for this ${typeLabel(input.type)}:\n\n${describeEvent(input)}` },
    ];

    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const response = await openai.chat.completions.create({
          model: MODEL,
          temperature: 0.3,
          max_tokens: 80,
          messages,
        });

        const text = response.choices[0]?.message?.content?.trim();
        if (!text) return null;

        return { text, source: "LLM" };
      } catch (err) {
        if (attempt === 0 && isBurstRateLimit(err)) {
          await sleep(parseRetryAfterMs(err, 1000));
          continue;
        }
        logger.warn("llm_commentary_failed", { error: String(err), eventExternalId: input.eventExternalId });
        return null;
      }
    }
    return null;
  },
};
