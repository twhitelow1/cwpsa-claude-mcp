import { describe, expect, it } from "vitest";
import { CwClient, parseRetryAfter } from "@/lib/cw/client";
import { getCwConfig } from "@/lib/config";
import { mockCw } from "./helpers";

describe("CW client", () => {
  it("sends basic auth, clientId and Accept headers", async () => {
    const { calls, client } = mockCw(() => ({ body: { id: 1 } }));
    await client.get("/service/tickets/1");
    expect(calls[0].headers).toMatchObject({ Authorization: "Basic dGVzdA==", clientId: "client-id-test", Accept: "application/json" });
    expect(calls[0].url.pathname).toBe("/v4_6_release/apis/3.0/service/tickets/1");
  });

  it("builds Basic credentials as company+public:private", () => {
    const c = getCwConfig({ CW_HOST: "api-na.myconnectwise.net", CW_API_PATH: "/v4_6_release/apis/3.0/", CW_COMPANY_ID: "acme", CW_PUBLIC_KEY: "pub", CW_PRIVATE_KEY: "priv", CW_CLIENT_ID: "cid" });
    expect(c.baseUrl).toBe("https://api-na.myconnectwise.net/v4_6_release/apis/3.0");
    expect(Buffer.from(c.authHeader.replace("Basic ", ""), "base64").toString()).toBe("acme+pub:priv");
  });

  it("reports missing config by variable name only", () => {
    expect(() => getCwConfig({ CW_HOST: "h", CW_PRIVATE_KEY: "super-secret" })).toThrow(/CW_COMPANY_ID/); // secret-scan:allow (dummy fixture)
    try {
      getCwConfig({ CW_HOST: "h", CW_PRIVATE_KEY: "super-secret" }); // secret-scan:allow (dummy fixture)
    } catch (e) {
      expect(String(e)).not.toContain("super-secret");
    }
  });

  it("paginates until a short page", async () => {
    const { calls, client } = mockCw((c) => {
      const page = Number(c.url.searchParams.get("page"));
      const size = Number(c.url.searchParams.get("pageSize"));
      const n = page < 3 ? size : 2;
      return { body: Array.from({ length: n }, (_, k) => ({ id: (page - 1) * size + k })) };
    });
    const r = await client.list("/company/companies", { conditions: "x = 1" }, 1000 * 5);
    expect(calls.map((c) => c.url.searchParams.get("page"))).toEqual(["1", "2", "3"]);
    expect(calls[0].url.searchParams.get("pageSize")).toBe("1000");
    expect(calls[0].url.searchParams.get("conditions")).toBe("x = 1");
    expect(r.items).toHaveLength(2002);
    expect(r.truncated).toBe(false);
  });

  it("stops at the limit and flags truncation", async () => {
    const { calls, client } = mockCw((c) => ({ body: Array.from({ length: Number(c.url.searchParams.get("pageSize")) }, (_, k) => ({ id: k })) }));
    const r = await client.list("/x", {}, 25);
    expect(calls).toHaveLength(1);
    expect(r.items).toHaveLength(25);
    expect(r.truncated).toBe(true);
  });

  it("retries 429 honoring Retry-After, then succeeds", async () => {
    let n = 0;
    const waits: number[] = [];
    const { client } = mockCw(() => (++n < 3 ? { status: 429, headers: { "Retry-After": "2" }, body: {} } : { body: [{ id: 1 }] }));
    (client as unknown as { sleep: (ms: number) => Promise<void> }).sleep = async (ms) => void waits.push(ms);
    const r = await client.get("/x");
    expect(r).toEqual([{ id: 1 }]);
    expect(waits).toEqual([2000, 2000]);
  });

  it("retries GET 5xx but not POST 5xx", async () => {
    let n = 0;
    const { client } = mockCw(() => (++n === 1 ? { status: 503, body: {} } : { body: { ok: 1 } }));
    expect(await client.get("/x")).toEqual({ ok: 1 });
    n = 0;
    await expect(client.request("POST", "/x", { body: {} })).rejects.toMatchObject({ code: "upstream_error" });
  });

  it("gives up after maxRetries", async () => {
    const { calls, client } = mockCw(() => ({ status: 429, body: {} }));
    await expect(client.get("/x")).rejects.toMatchObject({ status: 503 });
    expect(calls).toHaveLength(5);
  });

  it("parses Retry-After dates", () => {
    expect(parseRetryAfter("3")).toBe(3000);
    expect(parseRetryAfter(new Date(10_000).toUTCString(), 4_000)).toBe(6000);
    expect(parseRetryAfter(null)).toBeUndefined();
  });

  it("sanitizes upstream errors (no URLs, no credentials)", async () => {
    const { client } = mockCw(() => ({
      status: 400,
      body: { message: "bad thing at https://cw.example.test/internal/path", errors: [{ field: "summary", message: "Basic dGVzdA== required" }] },
    }));
    const err = (await client.get("/x").catch((e: Error) => e)) as Error;
    expect(err.message).toContain("bad thing at [url]");
    expect(err.message).toContain("Basic [redacted]");
    expect(err.message).not.toContain("cw.example.test");
    const { client: c401 } = mockCw(() => ({ status: 401, body: { message: "secret detail" } }));
    const e401 = (await c401.get("/x").catch((e: Error) => e)) as Error;
    expect(e401.message).not.toContain("secret detail");
  });

  it("caps concurrency at 5", async () => {
    let active = 0;
    let peak = 0;
    const client = new CwClient({
      config: { baseUrl: "https://cw.example.test/a", authHeader: "Basic x", clientId: "c" },
      fetchImpl: (async () => {
        active++;
        peak = Math.max(peak, active);
        await new Promise((r) => setTimeout(r, 5));
        active--;
        return new Response("[]", { status: 200 });
      }) as typeof fetch,
    });
    await Promise.all(Array.from({ length: 20 }, () => client.get("/x")));
    expect(peak).toBe(5);
  });

  it("rejects path traversal", () => {
    const { client } = mockCw(() => ({ body: {} }));
    expect(() => client.buildUrl("/../secret")).toThrow();
    expect(() => client.buildUrl("/x?y=1")).toThrow();
  });
});
