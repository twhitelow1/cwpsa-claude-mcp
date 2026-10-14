import { CwClient, _setClient } from "@/lib/cw/client";

export const TOKEN = "test-token-0123456789abcdefghijklmnopqrstuvwxyz";

export function setEnv(extra: Record<string, string | undefined> = {}) {
  process.env.BRIDGE_API_TOKEN = TOKEN;
  process.env.WRITES_ENABLED = "false";
  process.env.ALLOWED_ORIGINS = "https://claude.ai";
  for (const [k, v] of Object.entries(extra)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}

export type Call = { method: string; url: URL; headers: Record<string, string>; body?: unknown };

/** Install a CwClient backed by a routing mock; returns the call log. */
export function mockCw(route: (c: Call) => { status?: number; body?: unknown; headers?: Record<string, string> }) {
  const calls: Call[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const call: Call = {
      method: init?.method ?? "GET",
      url: new URL(String(input)),
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    };
    calls.push(call);
    const r = route(call);
    return new Response(r.body === undefined ? null : JSON.stringify(r.body), {
      status: r.status ?? 200,
      headers: { "Content-Type": "application/json", ...(r.headers ?? {}) },
    });
  }) as typeof fetch;
  const client = new CwClient({
    config: { baseUrl: "https://cw.example.test/v4_6_release/apis/3.0", authHeader: "Basic dGVzdA==", clientId: "client-id-test" },
    fetchImpl,
    baseDelayMs: 1,
    sleep: async () => {},
  });
  _setClient(client);
  return { calls, client };
}
