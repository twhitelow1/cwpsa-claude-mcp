import { requestContext } from "@/lib/context";
import { toPublicError } from "@/lib/errors";
import { corsHeaders, guard, json, preflight } from "@/lib/guard";
import { coerceQuery, matchRoute } from "@/lib/rest";
import { runTool } from "@/lib/run";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: Request, ctx: { params: Promise<{ path: string[] }> }) {
  const g = guard(req);
  if ("response" in g) return g.response;
  const cors = corsHeaders(req.headers.get("origin"));
  const { path } = await ctx.params;
  const route = matchRoute(path);
  if (!route) return json({ error: "not_found", message: "Unknown endpoint. See /api/openapi.json" }, 404, cors);

  let input: Record<string, unknown>;
  try {
    input = { ...coerceQuery(route.tool, new URL(req.url).searchParams), ...route.pathParams };
  } catch (e) {
    const p = toPublicError(e);
    return json({ error: p.code, message: p.message }, p.status, cors);
  }
  const r = await requestContext.run({ tokenId: g.tokenId, via: "rest" }, () => runTool(route.tool, input));
  return r.ok ? json(r.data, 200, cors) : json({ error: r.code, message: r.message }, r.status, cors);
}

export { preflight as OPTIONS };
