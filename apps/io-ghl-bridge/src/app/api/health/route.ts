import { ConfigError, getConfig } from "@/lib/config";

export const dynamic = "force-dynamic";

/** Liveness plus a config check that reports variable names only, never values. */
export function GET() {
  try {
    getConfig();
    return Response.json({ ok: true });
  } catch (e) {
    return Response.json({ ok: false, error: e instanceof ConfigError ? e.message : "error" }, { status: 500 });
  }
}
