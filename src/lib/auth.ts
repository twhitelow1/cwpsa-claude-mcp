import { createHash, timingSafeEqual } from "node:crypto";
import { ConfigError, allowedOrigins, getBridgeToken, type Env } from "./config";

export type AuthFailReason = "not_configured" | "missing_header" | "bad_scheme" | "mismatch";

export type AuthResult =
  | { ok: true; tokenId: string }
  | { ok: false; status: 401 | 403 | 500; error: string; reason: AuthFailReason; presentedLength?: number; expectedLength?: number };

const sha256 = (s: string) => createHash("sha256").update(s, "utf8").digest();

/**
 * Constant-time bearer token check. Both sides are hashed first so the
 * comparison is fixed-length and does not leak the token length.
 */
export function verifyBearer(header: string | null | undefined, env: Env = process.env): AuthResult {
  let expected: string;
  try {
    expected = getBridgeToken(env);
  } catch (e) {
    if (e instanceof ConfigError) return { ok: false, status: 500, error: "Server auth is not configured", reason: "not_configured" };
    throw e;
  }
  const raw = (header ?? "").trim();
  if (!raw) return { ok: false, status: 401, error: "Unauthorized", reason: "missing_header" };
  const m = /^Bearer\s+(\S+)$/i.exec(raw);
  if (!m) return { ok: false, status: 401, error: "Unauthorized", reason: "bad_scheme" };
  const presented = m[1];
  const a = sha256(presented);
  const b = sha256(expected);
  if (!timingSafeEqual(a, b)) {
    // Lengths only (never values) so a misconfigured token can be diagnosed from logs.
    return { ok: false, status: 401, error: "Unauthorized", reason: "mismatch", presentedLength: presented.length, expectedLength: expected.length };
  }
  // Non-reversible id for rate limiting/audit; never log the token itself.
  return { ok: true, tokenId: a.toString("hex").slice(0, 12) };
}

/**
 * Browser requests carry Origin; reject any not explicitly allowed (DNS
 * rebinding / CSRF guard, per the MCP transport spec). Server-to-server
 * calls (no Origin) are allowed — the bearer token still applies.
 */
export function checkOrigin(origin: string | null, env: Env = process.env): boolean {
  if (!origin) return true;
  return allowedOrigins(env).includes(origin.replace(/\/+$/, ""));
}
