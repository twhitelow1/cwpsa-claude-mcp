import { ZodError } from "zod";
import { ConfigError } from "./config";

/** Error safe to show to callers. Message must never contain secrets/URLs. */
export class BridgeError extends Error {
  constructor(
    message: string,
    public status = 400,
    public code = "bad_request",
  ) {
    super(message);
    this.name = "BridgeError";
  }
}

const URL_RE = /https?:\/\/[^\s"']+/gi;
const BASIC_RE = /(Basic|Bearer)\s+[A-Za-z0-9+/=._-]+/gi;

export function scrub(msg: string): string {
  return msg.replace(URL_RE, "[url]").replace(BASIC_RE, "$1 [redacted]").slice(0, 500);
}

export function toPublicError(e: unknown): { status: number; code: string; message: string } {
  if (e instanceof BridgeError) return { status: e.status, code: e.code, message: scrub(e.message) };
  if (e instanceof ZodError) {
    const issues = e.issues.slice(0, 5).map((i) => `${i.path.join(".") || "input"}: ${i.message}`);
    return { status: 400, code: "invalid_input", message: issues.join("; ") };
  }
  if (e instanceof ConfigError) return { status: 500, code: "not_configured", message: scrub(e.message) };
  return { status: 500, code: "internal_error", message: "Internal error" };
}
