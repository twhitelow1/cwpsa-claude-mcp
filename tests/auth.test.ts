import { beforeEach, describe, expect, it } from "vitest";
import { checkOrigin, verifyBearer } from "@/lib/auth";
import { guard } from "@/lib/guard";
import { _resetRateLimits, checkRateLimit } from "@/lib/ratelimit";
import { TOKEN, setEnv } from "./helpers";

describe("bearer auth", () => {
  beforeEach(() => setEnv());

  it("accepts the exact token", () => {
    const r = verifyBearer(`Bearer ${TOKEN}`);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.tokenId).not.toContain(TOKEN.slice(0, 8));
  });

  it.each([
    [null],
    [""],
    [TOKEN],
    [`Basic ${TOKEN}`],
    [`Bearer ${TOKEN}x`],
    [`Bearer ${TOKEN.slice(0, -1)}`],
    ["Bearer "],
    [`Bearer ${TOKEN} extra`],
  ])("rejects %s", (h) => {
    expect(verifyBearer(h)).toMatchObject({ ok: false, status: 401, error: "Unauthorized" });
  });

  it("tolerates whitespace, quotes or a Bearer prefix pasted into the server env value", () => {
    for (const stored of [`${TOKEN}\n`, `  ${TOKEN} `, `"${TOKEN}"`, `Bearer ${TOKEN}`]) {
      expect(verifyBearer(`Bearer ${TOKEN}`, { BRIDGE_API_TOKEN: stored }).ok).toBe(true);
    }
  });

  it("reports why auth failed without exposing the token", () => {
    expect(verifyBearer(undefined)).toMatchObject({ reason: "missing_header" });
    expect(verifyBearer(`Token ${TOKEN}`)).toMatchObject({ reason: "bad_scheme" });
    const r = verifyBearer("Bearer wrong-token");
    expect(r).toMatchObject({ reason: "mismatch", presentedLength: 11, expectedLength: TOKEN.length });
    expect(JSON.stringify(r)).not.toContain(TOKEN);
  });

  it("fails closed when the server token is missing or short", () => {
    setEnv({ BRIDGE_API_TOKEN: "short" });
    expect(verifyBearer("Bearer short")).toMatchObject({ ok: false, status: 500 });
    setEnv({ BRIDGE_API_TOKEN: undefined }); // secret-scan:allow (dummy fixture)
    expect(verifyBearer("Bearer ")).toMatchObject({ ok: false, status: 500 });
  });

  it("checks origin allow-list", () => {
    expect(checkOrigin(null)).toBe(true);
    expect(checkOrigin("https://claude.ai")).toBe(true);
    expect(checkOrigin("https://claude.ai/")).toBe(true);
    expect(checkOrigin("https://evil.example")).toBe(false);
  });

  it("guard returns 401 with WWW-Authenticate and no detail", async () => {
    const g = guard(new Request("https://x.test/api/mcp", { headers: { authorization: "Bearer nope" } }));
    expect("response" in g).toBe(true);
    if ("response" in g) {
      expect(g.response.status).toBe(401);
      expect(g.response.headers.get("www-authenticate")).toContain("Bearer");
      expect(await g.response.text()).not.toContain(TOKEN);
    }
  });

  it("guard rejects disallowed origin even with a valid token", () => {
    const g = guard(new Request("https://x.test/api/mcp", { headers: { authorization: `Bearer ${TOKEN}`, origin: "https://evil.example" } }));
    expect("response" in g && g.response.status).toBe(403);
  });
});

describe("rate limit", () => {
  beforeEach(() => _resetRateLimits());
  it("blocks after the limit and resets after a minute", () => {
    const t = 1_000_000;
    for (let n = 0; n < 3; n++) expect(checkRateLimit("k", t, 3).ok).toBe(true);
    const blocked = checkRateLimit("k", t + 10, 3);
    expect(blocked.ok).toBe(false);
    expect(checkRateLimit("other", t + 10, 3).ok).toBe(true);
    expect(checkRateLimit("k", t + 60_000, 3).ok).toBe(true);
  });
});
