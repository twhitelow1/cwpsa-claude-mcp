import { guard, json, preflight, corsHeaders } from "@/lib/guard";
import { buildOpenApi } from "@/lib/openapi";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(req: Request) {
  const g = guard(req);
  if ("response" in g) return g.response;
  return json(buildOpenApi(new URL(req.url).origin), 200, corsHeaders(req.headers.get("origin")));
}

export { preflight as OPTIONS };
