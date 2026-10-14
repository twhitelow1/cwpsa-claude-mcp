/**
 * Structured audit log: one JSON line per call, captured by Vercel logs.
 * Callers pass only ids and status — never credentials or note bodies.
 */
export type AuditEntry = {
  tool: string;
  via: "mcp" | "rest";
  tokenId?: string;
  entityIds?: Record<string, number | string | undefined>;
  mode: "read" | "dry_run" | "executed" | "rejected";
  status: "ok" | "error";
  error?: string;
  durationMs?: number;
};

export function audit(entry: AuditEntry) {
  const line = { ts: new Date().toISOString(), type: "audit", ...entry };
  console.log(JSON.stringify(line));
}
