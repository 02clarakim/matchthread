/**
 * Minimal structured logger. Emits one JSON line per event so logs stay
 * greppable/parseable in any log aggregator without pulling in a dependency.
 *
 * Never pass secrets (API keys, passwords, session tokens) as fields.
 */

type LogFields = Record<string, string | number | boolean | null | undefined>;

const REDACTED_KEYS = new Set([
  "password",
  "passwordHash",
  "apiKey",
  "api_key",
  "token",
  "secret",
  "authorization",
]);

function sanitize(fields: LogFields): LogFields {
  const clean: LogFields = {};
  for (const [key, value] of Object.entries(fields)) {
    clean[key] = REDACTED_KEYS.has(key) ? "[redacted]" : value;
  }
  return clean;
}

function emit(level: "info" | "warn" | "error", event: string, fields: LogFields = {}) {
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    event,
    ...sanitize(fields),
  });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export const logger = {
  info: (event: string, fields?: LogFields) => emit("info", event, fields),
  warn: (event: string, fields?: LogFields) => emit("warn", event, fields),
  error: (event: string, fields?: LogFields) => emit("error", event, fields),
};
