import { logger } from "../logger";

interface RetryOptions {
  retries?: number;
  baseDelayMs?: number;
  timeoutMs?: number;
  label: string;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Fetch with a request timeout, limited retries, and exponential backoff.
 * Retries on network errors, 429, and 5xx. Does not retry on 4xx (other
 * than 429) — those are our bug, not a transient failure. Never retries
 * forever: after `retries` attempts it throws so the caller can degrade
 * gracefully instead of hanging.
 */
export async function fetchWithRetry(
  url: string,
  init: RequestInit = {},
  options: RetryOptions
): Promise<Response> {
  const { retries = 3, baseDelayMs = 500, timeoutMs = 5000, label } = options;

  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, { ...init, signal: controller.signal });
      clearTimeout(timer);

      if (response.status === 429 || response.status >= 500) {
        lastError = new Error(`${label} responded ${response.status}`);
        if (attempt < retries) {
          const retryAfter = Number(response.headers.get("retry-after"));
          const delay = Number.isFinite(retryAfter) && retryAfter > 0
            ? retryAfter * 1000
            : baseDelayMs * 2 ** attempt;
          logger.warn("http_retry", { label, attempt, status: response.status, delayMs: delay });
          await sleep(delay);
          continue;
        }
        return response;
      }

      return response;
    } catch (err) {
      clearTimeout(timer);
      lastError = err;
      if (attempt < retries) {
        const delay = baseDelayMs * 2 ** attempt;
        logger.warn("http_retry", { label, attempt, error: String(err), delayMs: delay });
        await sleep(delay);
        continue;
      }
    }
  }

  throw lastError instanceof Error ? lastError : new Error(`${label} failed after ${retries + 1} attempts`);
}
