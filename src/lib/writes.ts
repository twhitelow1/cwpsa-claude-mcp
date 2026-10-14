import { z } from "zod";
import { writesEnabled } from "./config";
import { issueConfirmToken, verifyConfirmToken } from "./confirm";
import { cw } from "./cw/client";
import { BridgeError } from "./errors";
import type { PlannedRequest, WritePlan } from "./tools/types";

export const confirmTokenField = z
  .string()
  .min(10)
  .max(2000)
  .optional()
  .describe(
    "Leave EMPTY on the first call to get a dry_run preview and a confirm_token. To execute, call again with " +
      "identical arguments plus that confirm_token (valid 10 minutes, single use). Always show the preview to the user first.",
  );

const REF_RE = /^\$ref:(\d+)\.id$/;

/** Replace "$ref:N.id" placeholders with the id returned by request N. */
export function resolveRefs(value: unknown, results: unknown[]): unknown {
  if (typeof value === "string") {
    const m = REF_RE.exec(value);
    if (!m) return value;
    const prior = results[Number(m[1])] as { id?: number } | undefined;
    if (typeof prior?.id !== "number") throw new BridgeError("Internal: unresolved reference in write plan", 500, "internal_error");
    return prior.id;
  }
  if (Array.isArray(value)) return value.map((v) => resolveRefs(v, results));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, resolveRefs(v, results)]));
  }
  return value;
}

export type WriteOutcome =
  | { dry_run: true; summary: string; will_send: PlannedRequest[]; confirm_token: string; expires_at: string; next_step: string }
  | { dry_run: false; executed: true; summary: string; results: unknown[] }
  | { dry_run: false; executed: false; partial: true; summary: string; completed: unknown[]; failed_step: number; error: string };

/**
 * Two-step write: no token → preview + HMAC token bound to the exact plan;
 * token → re-build the plan, verify the token matches it, then execute.
 */
export async function runWrite(
  tool: string,
  confirmToken: string | undefined,
  buildPlan: () => Promise<WritePlan>,
  summarizeResult: (r: unknown, req: PlannedRequest) => unknown,
): Promise<WriteOutcome> {
  if (!writesEnabled()) {
    throw new BridgeError("Write tools are disabled on this bridge (WRITES_ENABLED is not 'true').", 403, "writes_disabled");
  }
  const plan = await buildPlan();
  if (!confirmToken) {
    const { token, expiresAt } = issueConfirmToken(tool, plan);
    return {
      dry_run: true,
      summary: plan.summary,
      will_send: plan.requests,
      confirm_token: token,
      expires_at: expiresAt,
      next_step: "Nothing has been written. Show this preview to the user; if they approve, call the same tool again with identical arguments plus confirm_token.",
    };
  }
  verifyConfirmToken(confirmToken, tool, plan);

  const raw: unknown[] = [];
  const results: unknown[] = [];
  for (let n = 0; n < plan.requests.length; n++) {
    const req = plan.requests[n];
    try {
      const body = resolveRefs(req.body, raw);
      const path = String(resolveRefs(req.path, raw));
      const res = await cw().request(req.method, path, { body });
      raw.push(res);
      results.push(summarizeResult(res, req));
    } catch (e) {
      if (n === 0) throw e;
      // Earlier steps succeeded and are NOT rolled back (no deletes in v1).
      return {
        dry_run: false,
        executed: false,
        partial: true,
        summary: plan.summary,
        completed: results,
        failed_step: n,
        error: e instanceof BridgeError ? e.message : "Request failed",
      };
    }
  }
  return { dry_run: false, executed: true, summary: plan.summary, results };
}
