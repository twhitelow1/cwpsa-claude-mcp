import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { getBridgeToken, type Env } from "./config";
import { BridgeError } from "./errors";

export const CONFIRM_TTL_MS = 10 * 60 * 1000;

/** Deterministic JSON (sorted keys) so the same payload always hashes the same. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(",")}}`;
}

export function hashPayload(tool: string, payload: unknown): string {
  return createHash("sha256").update(canonicalJson({ tool, payload })).digest("base64url");
}

function signingKey(env: Env): Buffer {
  // Derived from the bridge token: rotating the token invalidates all pending confirms.
  return createHmac("sha256", getBridgeToken(env)).update("cw-bridge/confirm-token/v1").digest();
}

type Claims = { t: string; h: string; e: number; n: string };

export function issueConfirmToken(tool: string, payload: unknown, opts: { now?: number; env?: Env } = {}) {
  const now = opts.now ?? Date.now();
  const claims: Claims = { t: tool, h: hashPayload(tool, payload), e: now + CONFIRM_TTL_MS, n: randomBytes(9).toString("base64url") };
  const body = Buffer.from(JSON.stringify(claims)).toString("base64url");
  const sig = createHmac("sha256", signingKey(opts.env ?? process.env)).update(body).digest("base64url");
  return { token: `${body}.${sig}`, expiresAt: new Date(claims.e).toISOString() };
}

// Best-effort single use within an instance (serverless instances don't share memory).
const used = new Map<string, number>();

export function verifyConfirmToken(
  token: string,
  tool: string,
  payload: unknown,
  opts: { now?: number; env?: Env } = {},
): void {
  const now = opts.now ?? Date.now();
  const fail = (why: string): never => {
    throw new BridgeError(`confirm_token rejected: ${why}. Call again without confirm_token for a fresh dry run.`, 409, "confirm_rejected");
  };
  const [body, sig, extra] = token.split(".");
  if (!body || !sig || extra !== undefined) fail("malformed");
  const expected = createHmac("sha256", signingKey(opts.env ?? process.env)).update(body).digest();
  let given: Buffer;
  try {
    given = Buffer.from(sig, "base64url");
  } catch {
    return fail("malformed");
  }
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) fail("bad signature");

  let claims: Claims;
  try {
    claims = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as Claims;
  } catch {
    return fail("malformed");
  }
  if (claims.t !== tool) fail("issued for a different tool");
  if (typeof claims.e !== "number" || claims.e <= now) fail("expired");
  if (claims.h !== hashPayload(tool, payload)) fail("payload differs from the dry run");
  if (used.has(claims.n)) fail("already used");

  for (const [n, exp] of used) if (exp <= now) used.delete(n);
  used.set(claims.n, claims.e);
}

export function _resetUsedTokens() {
  used.clear();
}
