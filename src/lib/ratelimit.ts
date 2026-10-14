import { rateLimitPerMinute } from "./config";

/**
 * Fixed-window limiter keyed by token id. In-memory, so it is per
 * serverless instance — a basic abuse brake, not a global quota.
 */
const windows = new Map<string, { start: number; count: number }>();

export function checkRateLimit(key: string, now = Date.now(), limit = rateLimitPerMinute()) {
  const w = windows.get(key);
  if (!w || now - w.start >= 60_000) {
    windows.set(key, { start: now, count: 1 });
    return { ok: true as const };
  }
  w.count += 1;
  if (w.count > limit) {
    return { ok: false as const, retryAfterSec: Math.ceil((w.start + 60_000 - now) / 1000) };
  }
  return { ok: true as const };
}

export function _resetRateLimits() {
  windows.clear();
}
