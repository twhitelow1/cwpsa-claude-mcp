import { checkOrigin, verifyBearer } from "./auth";
import { allowedOrigins } from "./config";
import { checkRateLimit } from "./ratelimit";

export function json(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...headers } });
}

export function corsHeaders(origin: string | null): Record<string, string> {
  if (!origin || !allowedOrigins().includes(origin.replace(/\/+$/, ""))) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Headers": "Authorization, Content-Type, Mcp-Session-Id, Mcp-Protocol-Version",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Expose-Headers": "Mcp-Session-Id",
    Vary: "Origin",
  };
}

/** Auth + origin + rate limit. Returns a Response to short-circuit, or the token id. */
export function guard(req: Request): { response: Response } | { tokenId: string } {
  const origin = req.headers.get("origin");
  if (!checkOrigin(origin)) return { response: json({ error: "forbidden_origin" }, 403) };
  const auth = verifyBearer(req.headers.get("authorization"));
  if (!auth.ok) {
    return {
      response: json({ error: auth.status === 401 ? "unauthorized" : "server_misconfigured" }, auth.status, {
        ...(auth.status === 401 ? { "WWW-Authenticate": 'Bearer realm="cw-bridge"' } : {}),
        ...corsHeaders(origin),
      }),
    };
  }
  const rl = checkRateLimit(auth.tokenId);
  if (!rl.ok) return { response: json({ error: "rate_limited" }, 429, { "Retry-After": String(rl.retryAfterSec), ...corsHeaders(origin) }) };
  return { tokenId: auth.tokenId };
}

export function preflight(req: Request) {
  const origin = req.headers.get("origin");
  const h = corsHeaders(origin);
  return new Response(null, { status: Object.keys(h).length ? 204 : 403, headers: h });
}
