import { createHash, timingSafeEqual } from "node:crypto";

export class UpstreamError extends Error {
  constructor(
    readonly service: "io" | "ghl" | "store",
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "UpstreamError";
  }
}

export type Sleep = (ms: number) => Promise<void>;
export const realSleep: Sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function parseRetryAfter(h: string | null, now = Date.now()): number | undefined {
  if (!h) return undefined;
  const secs = Number(h);
  if (Number.isFinite(secs)) return Math.max(0, secs * 1000);
  const t = Date.parse(h);
  return Number.isNaN(t) ? undefined : Math.max(0, t - now);
}

export type RetryOptions = {
  fetchImpl: typeof fetch;
  sleep: Sleep;
  maxRetries: number;
  baseDelayMs: number;
  /** Longest Retry-After we will sit through inside one serverless invocation. */
  maxWaitMs: number;
};

/**
 * fetch with retries. Reads (GET) retry on 429/5xx/network errors; writes
 * retry only on 429, so a timed-out create is never sent twice.
 */
export async function fetchWithRetry(url: string, init: RequestInit, o: RetryOptions): Promise<Response> {
  const isRead = (init.method ?? "GET") === "GET";
  for (let attempt = 0; ; attempt++) {
    let res: Response | undefined;
    try {
      res = await o.fetchImpl(url, init);
    } catch (e) {
      if (!isRead || attempt >= o.maxRetries) throw e;
    }
    if (res) {
      const retryable = res.status === 429 || (isRead && res.status >= 500);
      if (!retryable || attempt >= o.maxRetries) return res;
      const wait = parseRetryAfter(res.headers.get("retry-after")) ?? o.baseDelayMs * 2 ** attempt;
      if (wait > o.maxWaitMs) return res;
      await o.sleep(wait);
    } else {
      await o.sleep(o.baseDelayMs * 2 ** attempt);
    }
  }
}

/** Constant-time secret compare; hashing first hides the length. */
export function secretMatches(presented: string | null | undefined, expected: string): boolean {
  if (!presented) return false;
  const h = (s: string) => createHash("sha256").update(s, "utf8").digest();
  return timingSafeEqual(h(presented.trim()), h(expected));
}

/** One JSON line per sync step. Ids and outcomes only, never names, emails or phones. */
export function log(entry: Record<string, string | number | boolean | undefined>) {
  console.log(JSON.stringify({ ts: new Date().toISOString(), type: "sync", ...entry }));
}
