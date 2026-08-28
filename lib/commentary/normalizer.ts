/**
 * Normalizes commentary text from any external source before it is stored
 * or rendered: strips HTML, decodes common entities, collapses whitespace,
 * and truncates to roughly one sentence. Text is always rendered by React
 * as plain text (never dangerouslySetInnerHTML), so this is not itself an
 * XSS boundary — but stripping tags keeps stray markup out of the UI.
 */

const MAX_LENGTH = 220;

const HTML_ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&apos;": "'",
  "&nbsp;": " ",
};

export function normalizeCommentaryText(raw: string | null | undefined): string | null {
  if (!raw) return null;

  let text = raw.replace(/<[^>]*>/g, " ");

  for (const [entity, replacement] of Object.entries(HTML_ENTITIES)) {
    text = text.split(entity).join(replacement);
  }

  text = text.replace(/\s+/g, " ").trim();

  if (!text) return null;

  if (text.length > MAX_LENGTH) {
    const truncated = text.slice(0, MAX_LENGTH);
    const lastSpace = truncated.lastIndexOf(" ");
    text = `${truncated.slice(0, lastSpace > 0 ? lastSpace : MAX_LENGTH)}…`;
  }

  return text;
}
