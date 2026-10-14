import { audit } from "./audit";
import { requestContext } from "./context";
import { toPublicError } from "./errors";
import type { ToolDef } from "./tools/types";

export type RunResult = { ok: true; data: unknown } | { ok: false; status: number; code: string; message: string };

/** Validate input, run the tool, write the audit line. Shared by MCP and REST. */
export async function runTool(tool: ToolDef, rawInput: unknown): Promise<RunResult> {
  const ctx = requestContext.getStore();
  const started = Date.now();
  let ids: Record<string, number | string | undefined> | undefined;
  let mode: "read" | "dry_run" | "executed" | "rejected" = tool.write ? "dry_run" : "read";
  try {
    const input = tool.input.parse(rawInput ?? {});
    ids = tool.auditIds?.(input);
    if (tool.write && (input as { confirm_token?: string }).confirm_token) mode = "executed";
    const data = await tool.handler(input);
    const partial = !!(data && typeof data === "object" && "partial" in data);
    audit({ tool: tool.name, via: ctx?.via ?? "rest", tokenId: ctx?.tokenId, entityIds: withResultIds(ids, data), mode, status: partial ? "error" : "ok", error: partial ? "partial_write" : undefined, durationMs: Date.now() - started });
    return { ok: true, data };
  } catch (e) {
    const pub = toPublicError(e);
    if (pub.code === "writes_disabled" || pub.code === "confirm_rejected") mode = "rejected";
    if (pub.code === "internal_error") console.error(JSON.stringify({ type: "error", tool: tool.name, err: e instanceof Error ? e.name : "unknown" }));
    audit({ tool: tool.name, via: ctx?.via ?? "rest", tokenId: ctx?.tokenId, entityIds: ids, mode, status: "error", error: pub.code, durationMs: Date.now() - started });
    return { ok: false, ...pub };
  }
}

/** Add created entity ids from executed writes to the audit entry. */
function withResultIds(ids: Record<string, number | string | undefined> | undefined, data: unknown) {
  if (!data || typeof data !== "object" || !("results" in data)) return ids;
  const created = (data as { results: Record<string, unknown>[] }).results
    .map((r) => r?.noteId ?? r?.timeEntryId ?? r?.productId ?? r?.ticketId ?? r?.id)
    .filter((x) => x !== undefined)
    .join(",");
  return { ...ids, created };
}
