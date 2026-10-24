import type { Config } from "../config";
import { UpstreamError, fetchWithRetry, realSleep, type Sleep } from "../http";

/**
 * Inflatable Office / rental.software API6 client.
 *
 * - The key goes in the query string on GET and in the JSON body on POST, as the docs say.
 *   It never appears in an error message.
 * - Limits are 15 calls / 10 s and 300 / 5 min per key. The October 2026 release adds 2 per second.
 *   Calls are spaced ≥550 ms apart per instance, and a 429's Retry-After is honored.
 * - Every call is a billable transaction after 500 a month, so callers keep calls to a minimum.
 */
export type IoLead = Record<string, unknown> & { id: string };
export type IoCustomer = Record<string, unknown> & { id: string };
export type IoStatus = { id: string; name: string; confirmed: boolean; complete: boolean; cancel: boolean };

type Opts = { fetchImpl?: typeof fetch; sleep?: Sleep; minGapMs?: number; now?: () => number };

let lastCallAt = 0;

export class IoClient {
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: Sleep;
  private readonly minGapMs: number;
  private readonly now: () => number;

  constructor(
    private readonly cfg: Config["io"],
    opts: Opts = {},
  ) {
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.sleep = opts.sleep ?? realSleep;
    this.minGapMs = opts.minGapMs ?? 550;
    this.now = opts.now ?? Date.now;
  }

  private async call<T>(method: "GET" | "POST", path: string, opts: { query?: Record<string, string | number>; body?: Record<string, unknown> } = {}): Promise<{ status: number; data: T }> {
    if (!/^\/[a-z0-9_/]+$/i.test(path)) throw new UpstreamError("io", 500, "Invalid Inflatable Office path");
    const url = new URL(this.cfg.baseUrl + path);
    for (const [k, v] of Object.entries(opts.query ?? {})) url.searchParams.set(k, String(v));
    const init: RequestInit = { method, headers: { Accept: "application/json" } };
    if (method === "GET") {
      url.searchParams.set("apiKey", this.cfg.apiKey);
    } else {
      init.headers = { Accept: "application/json", "Content-Type": "application/json" };
      init.body = JSON.stringify({ apiKey: this.cfg.apiKey, ...opts.body });
    }

    const gap = lastCallAt + this.minGapMs - this.now();
    if (gap > 0) await this.sleep(gap);
    lastCallAt = this.now();

    const res = await fetchWithRetry(url.toString(), init, {
      fetchImpl: this.fetchImpl,
      sleep: this.sleep,
      maxRetries: 3,
      baseDelayMs: 1000,
      maxWaitMs: 21_000,
    });
    const data = (await res.json().catch(() => ({}))) as T & { message?: string };
    if (res.status === 404 || res.status === 409 || res.ok) return { status: res.status, data };
    // Upstream messages are short codes like "Permission access restricted"; keep them, drop everything else.
    const msg = typeof data?.message === "string" ? data.message.slice(0, 120) : res.statusText;
    throw new UpstreamError("io", res.status, `Inflatable Office ${method} ${path.replace(/\/\d+/g, "/:id")} failed: ${res.status} ${msg}`);
  }

  async getLead(id: string): Promise<IoLead | null> {
    const r = await this.call<IoLead>("GET", `/leads/${id}`);
    return r.status === 404 ? null : r.data;
  }

  async getCustomer(id: string): Promise<IoCustomer | null> {
    const r = await this.call<IoCustomer>("GET", `/customers/${id}`);
    return r.status === 404 ? null : r.data;
  }

  /** Leads modified in a relative range, full records (_body) so no per-lead fetch is needed. */
  async listModifiedLeads(range = "past_days_1", pageSize = 25, maxPages = 4): Promise<{ leads: IoLead[]; truncated: boolean }> {
    const leads: IoLead[] = [];
    for (let page = 0; page < maxPages; page++) {
      const r = await this.call<{ items?: IoLead[] }>("GET", "/leads", {
        query: { modified_date: range, _body: "true", offset: page * pageSize, limit: pageSize },
      });
      const items = r.status === 404 ? [] : (r.data.items ?? []);
      leads.push(...items);
      if (items.length < pageSize) return { leads, truncated: false };
    }
    return { leads, truncated: true };
  }

  async listStatuses(): Promise<IoStatus[]> {
    const r = await this.call<{ items?: Record<string, unknown>[] }>("GET", "/statuses_list", { query: { _body: "true", limit: 100 } });
    return (r.data.items ?? []).map((s) => ({
      id: String(s.id),
      name: String(s.name ?? ""),
      confirmed: truthy(s.confirmed),
      complete: truthy(s.complete),
      cancel: truthy(s.cancel),
    }));
  }

  /** Create (no id) or update (id) a customer. Returns the customer id. */
  async saveCustomer(fields: Record<string, unknown>, id?: string): Promise<string> {
    const r = await this.call<{ recordid?: number | string }>("POST", id ? `/customers/${id}` : "/customers", { body: fields });
    return requireRecordId(r, "customer");
  }

  /** Create (no id) or update (id) a lead. A 409 duplicate returns the existing lead's id. */
  async saveLead(fields: Record<string, unknown>, id?: string): Promise<string> {
    const r = await this.call<{ recordid?: number | string }>("POST", id ? `/leads/${id}` : "/leads", { body: fields });
    return requireRecordId(r, "lead");
  }
}

function requireRecordId(r: { status: number; data: { recordid?: number | string } }, what: string): string {
  if (r.status === 404) throw new UpstreamError("io", 404, `Inflatable Office ${what} not found`);
  if (r.data.recordid === undefined || r.data.recordid === null) throw new UpstreamError("io", 502, `Inflatable Office did not return a ${what} id`);
  return String(r.data.recordid);
}

export function truthy(v: unknown): boolean {
  return v === true || v === 1 || v === "1" || (typeof v === "string" && /^(yes|true)$/i.test(v));
}

/** Test hook: reset the module-level call spacing. */
export function _resetIoSpacing() {
  lastCallAt = 0;
}
