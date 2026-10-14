import { getCwConfig, type CwConfig } from "../config";
import { BridgeError, scrub } from "../errors";

export type Query = Record<string, string | number | boolean | undefined>;

export type ClientOptions = {
  config?: CwConfig;
  fetchImpl?: typeof fetch;
  maxConcurrency?: number;
  maxRetries?: number;
  /** ms; tests set this to ~0 */
  baseDelayMs?: number;
  maxDelayMs?: number;
  sleep?: (ms: number) => Promise<void>;
};

const MAX_PAGE_SIZE = 1000;

class Semaphore {
  private active = 0;
  private queue: (() => void)[] = [];
  constructor(private readonly max: number) {}
  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.active >= this.max) await new Promise<void>((r) => this.queue.push(r));
    this.active++;
    try {
      return await fn();
    } finally {
      this.active--;
      this.queue.shift()?.();
    }
  }
}

export function parseRetryAfter(h: string | null, now = Date.now()): number | undefined {
  if (!h) return undefined;
  const secs = Number(h);
  if (Number.isFinite(secs)) return Math.max(0, secs * 1000);
  const t = Date.parse(h);
  return Number.isNaN(t) ? undefined : Math.max(0, t - now);
}

export class CwClient {
  private readonly cfg: CwConfig;
  private readonly fetchImpl: typeof fetch;
  private readonly sem: Semaphore;
  private readonly maxRetries: number;
  private readonly baseDelayMs: number;
  private readonly maxDelayMs: number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(opts: ClientOptions = {}) {
    this.cfg = opts.config ?? getCwConfig();
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.sem = new Semaphore(opts.maxConcurrency ?? 5);
    this.maxRetries = opts.maxRetries ?? 4;
    this.baseDelayMs = opts.baseDelayMs ?? 500;
    this.maxDelayMs = opts.maxDelayMs ?? 8000;
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  buildUrl(path: string, query?: Query): string {
    if (!path.startsWith("/") || path.includes("..") || /[?#]/.test(path)) {
      throw new BridgeError("Invalid ConnectWise path", 500, "internal_error");
    }
    const url = new URL(this.cfg.baseUrl + path);
    for (const [k, v] of Object.entries(query ?? {})) {
      if (v !== undefined && v !== "") url.searchParams.set(k, String(v));
    }
    return url.toString();
  }

  async request<T = unknown>(method: "GET" | "POST" | "PATCH", path: string, opts: { query?: Query; body?: unknown } = {}): Promise<T> {
    const url = this.buildUrl(path, opts.query);
    const headers: Record<string, string> = {
      Authorization: this.cfg.authHeader,
      clientId: this.cfg.clientId,
      Accept: "application/json",
    };
    if (opts.body !== undefined) headers["Content-Type"] = "application/json";

    return this.sem.run(async () => {
      for (let attempt = 0; ; attempt++) {
        let res: Response;
        try {
          res = await this.fetchImpl(url, {
            method,
            headers,
            body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
          });
        } catch {
          // Network error: retry idempotent GETs only.
          if (method === "GET" && attempt < this.maxRetries) {
            await this.sleep(this.backoff(attempt));
            continue;
          }
          throw new BridgeError("ConnectWise is unreachable", 502, "upstream_unreachable");
        }

        const retryable = res.status === 429 || (res.status >= 500 && res.status !== 501);
        // POST/PATCH are only retried on 429 (request was not processed).
        const canRetry = res.status === 429 || method === "GET";
        if (retryable && canRetry && attempt < this.maxRetries) {
          const ra = parseRetryAfter(res.headers.get("retry-after"));
          await this.sleep(Math.min(ra ?? this.backoff(attempt), this.maxDelayMs));
          continue;
        }
        if (!res.ok) throw await this.toError(res);
        if (res.status === 204) return undefined as T;
        const text = await res.text();
        return (text ? JSON.parse(text) : undefined) as T;
      }
    });
  }

  private backoff(attempt: number): number {
    const exp = this.baseDelayMs * 2 ** attempt;
    return Math.min(exp + Math.random() * this.baseDelayMs, this.maxDelayMs);
  }

  private async toError(res: Response): Promise<BridgeError> {
    let detail = "";
    try {
      const j = (await res.json()) as { message?: string; errors?: { field?: string; message?: string }[] };
      const parts = [j.message, ...(j.errors ?? []).map((e) => [e.field, e.message].filter(Boolean).join(": "))];
      detail = parts.filter(Boolean).join("; ");
    } catch {
      /* non-JSON body: ignore, may contain internal details */
    }
    if (res.status === 401 || res.status === 403)
      return new BridgeError("ConnectWise rejected the API credentials or member permissions", 502, "upstream_auth");
    if (res.status === 404) return new BridgeError("Not found in ConnectWise", 404, "not_found");
    if (res.status === 429) return new BridgeError("ConnectWise rate limit hit; try again shortly", 503, "upstream_rate_limited");
    if (res.status >= 500) return new BridgeError("ConnectWise server error", 502, "upstream_error");
    return new BridgeError(scrub(`ConnectWise rejected the request${detail ? `: ${detail}` : ""}`), 400, "upstream_rejected");
  }

  get<T = unknown>(path: string, query?: Query) {
    return this.request<T>("GET", path, { query });
  }

  /**
   * Fetch pages until a short page is returned or `limit` items collected.
   * Returns `truncated: true` when the limit cut the result off.
   */
  async list<T = unknown>(path: string, query: Query = {}, limit = 200): Promise<{ items: T[]; truncated: boolean }> {
    const items: T[] = [];
    const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, limit));
    for (let page = 1; ; page++) {
      const batch = await this.get<T[]>(path, { ...query, page, pageSize });
      const arr = Array.isArray(batch) ? batch : [];
      items.push(...arr);
      if (items.length >= limit) {
        // Truncated if we cut items, or a full page suggests more exist.
        const truncated = items.length > limit || arr.length === pageSize;
        return { items: items.slice(0, limit), truncated };
      }
      if (arr.length < pageSize) return { items, truncated: false };
    }
  }

  async count(path: string, conditions?: string): Promise<number> {
    const r = await this.get<{ count: number }>(`${path}/count`, { conditions });
    return r?.count ?? 0;
  }
}

let shared: CwClient | undefined;
export function cw(): CwClient {
  shared ??= new CwClient();
  return shared;
}
export function _setClient(c: CwClient | undefined) {
  shared = c;
}
