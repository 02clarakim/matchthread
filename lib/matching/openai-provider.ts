import OpenAI from "openai";
import type { AIMatchProvider } from "./ai-provider";
import type { MatchableEvent } from "./types";
import { logger } from "../logger";

const MODEL = "gpt-4o-mini";
const TIMEOUT_MS = 4000;

let client: OpenAI | null | undefined;

function getClient(): OpenAI | null {
  if (client !== undefined) return client;
  const apiKey = process.env.OPENAI_API_KEY;
  // The key is only ever read here, server-side, and never sent to the browser.
  client = apiKey ? new OpenAI({ apiKey, timeout: TIMEOUT_MS, maxRetries: 1 }) : null;
  return client;
}

function describeEvent(event: MatchableEvent): string {
  const lines = [
    `${event.homeTeamName} vs ${event.awayTeamName}`,
    `Event: ${event.type}`,
    event.playerName ? `Player: ${event.playerName}` : null,
    event.assistName ? `Assist: ${event.assistName}` : null,
    `Minute: ${event.minute}'`,
    event.commentary ? `Commentary: ${event.commentary}` : null,
  ].filter(Boolean);
  return lines.join("\n");
}

export const openAIMatchProvider: AIMatchProvider = {
  name: "openai",

  async scoreMatch(event: MatchableEvent, candidateText: string): Promise<number | null> {
    const openai = getClient();
    if (!openai) return null;

    try {
      const response = await openai.chat.completions.create({
        model: MODEL,
        temperature: 0,
        max_tokens: 20,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              "You determine whether a social media post is discussing a specific football match event. " +
              'Respond with strict JSON: {"score": <number 0 to 1>} where 1 means certainly the same event ' +
              "and 0 means certainly unrelated. No other text.",
          },
          {
            role: "user",
            content: `Structured event:\n${describeEvent(event)}\n\nCandidate post:\n${candidateText}`,
          },
        ],
      });

      const raw = response.choices[0]?.message?.content;
      if (!raw) return null;

      const parsed = JSON.parse(raw) as { score?: unknown };
      const score = Number(parsed.score);
      if (!Number.isFinite(score)) return null;
      return Math.max(0, Math.min(1, score));
    } catch (err) {
      logger.warn("ai_matching_failed", { provider: "openai", error: String(err) });
      return null;
    }
  },
};
