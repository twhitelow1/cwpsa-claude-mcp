import { getConfig } from "@/lib/config";
import { GhlClient } from "@/lib/ghl/client";
import { IoClient, _resetIoSpacing } from "@/lib/io/client";
import { MemoryStore } from "@/lib/store";
import type { Deps } from "@/lib/sync/engine";

export const testEnv = {
  IO_API_KEY: "io-test-key-0000", // secret-scan: allow
  IO_DEFAULT_ZIP: "44301",
  IO_CONFIRMED_STATUS: "Confirmed",
  IO_CANCEL_STATUS: "Cancelled",
  GHL_TOKEN: "pit-test-token-0000", // secret-scan: allow
  GHL_LOCATION_ID: "loc123456",
  GHL_CALENDAR_ID: "cal123456",
  IO_WEBHOOK_SECRET: "i".repeat(32),
  GHL_WEBHOOK_SECRET: "g".repeat(32),
  CRON_SECRET: "c".repeat(32),
};

export type Call = { method: string; url: URL; body: Record<string, unknown> | undefined; headers: Record<string, string> };
type Route = (c: Call) => { status?: number; body?: unknown; headers?: Record<string, string> } | undefined;

/** Fake fetch: routes are tried in order; unmatched calls fail the test loudly. */
export function mockFetch(routes: Route[]) {
  const calls: Call[] = [];
  const fetchImpl = (async (input: string | URL, init?: RequestInit) => {
    const call: Call = {
      method: init?.method ?? "GET",
      url: new URL(String(input)),
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
      headers: (init?.headers ?? {}) as Record<string, string>,
    };
    calls.push(call);
    for (const r of routes) {
      const res = r(call);
      if (res) return new Response(JSON.stringify(res.body ?? {}), { status: res.status ?? 200, headers: res.headers });
    }
    throw new Error(`Unmocked ${call.method} ${call.url.pathname}`);
  }) as typeof fetch;
  return { fetchImpl, calls };
}

export function makeTestDeps(routes: Route[], env: Record<string, string> = {}) {
  _resetIoSpacing();
  const cfg = getConfig({ ...testEnv, ...env });
  const { fetchImpl, calls } = mockFetch(routes);
  const sleep = async () => {};
  const store = new MemoryStore();
  const deps: Deps = {
    cfg,
    io: new IoClient(cfg.io, { fetchImpl, sleep, minGapMs: 0 }),
    ghl: new GhlClient(cfg.ghl, { fetchImpl, sleep }),
    store,
  };
  return { deps, calls, store };
}

export const on =
  (method: string, path: RegExp, body: unknown | ((c: Call) => unknown), status = 200): Route =>
  (c) =>
    c.method === method && path.test(c.url.pathname) ? { status, body: typeof body === "function" ? (body as (c: Call) => unknown)(c) : body } : undefined;

export const ioLead = (over: Record<string, unknown> = {}) => ({
  id: "520247",
  contactid: "533268",
  eventname: "Birthday Party",
  eventstreet: "123 Main St",
  eventcity: "Akron",
  eventstate: "OH",
  eventzip: "44301",
  eventstarttime_ts: "1784145600",
  eventendtime_ts: 1784152800,
  total: "425.13",
  modifiedtime_ts: "1761594316",
  status: { id: "2349", name: "Hold", confirmed: "0", complete: "0", cancel: "0" },
  cust: {
    id: "533268",
    firstname: "Jordan",
    lastname: "Rivera",
    email: "Jordan.Rivera@example.com",
    cellphone: "(330) 555-0144",
    street: "123 Main St",
    city: "Akron",
    state: "OH",
    zip: "44301",
    organization: "",
  },
  ...over,
});
