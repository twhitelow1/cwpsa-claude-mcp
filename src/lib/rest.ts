import type { z } from "zod";
import { BridgeError } from "./errors";
import { toolByName } from "./tools";
import type { ToolDef } from "./tools/types";

/** REST mirror of the read tools: path pattern → tool + path params. */
export const restRoutes: { pattern: string; tool: string; params?: string[]; summary: string }[] = [
  { pattern: "tickets", tool: "cw_search_tickets", summary: "Search service tickets (open by default)" },
  { pattern: "tickets/:ticket_id", tool: "cw_get_ticket", params: ["ticket_id"], summary: "Ticket with notes, time and configs" },
  { pattern: "tickets/:ticket_id/notes", tool: "cw_list_ticket_notes", params: ["ticket_id"], summary: "Ticket notes" },
  { pattern: "time-entries", tool: "cw_search_time_entries", summary: "Search time entries with totals" },
  { pattern: "time-summary", tool: "cw_time_summary", summary: "Hours grouped by member/company/day/ticket" },
  { pattern: "companies", tool: "cw_search_companies", summary: "Search companies" },
  { pattern: "companies/:company_id", tool: "cw_get_company", params: ["company_id"], summary: "Get company" },
  { pattern: "contacts", tool: "cw_search_contacts", summary: "Search contacts" },
  { pattern: "configurations", tool: "cw_search_configurations", summary: "Search configurations" },
  { pattern: "agreements", tool: "cw_get_agreements", summary: "Agreements (by company)" },
  { pattern: "catalog", tool: "cw_search_catalog", summary: "Search procurement catalog" },
  { pattern: "members", tool: "cw_list_members", summary: "List members" },
  { pattern: "boards", tool: "cw_list_boards_statuses", summary: "Boards, statuses and priorities" },
];

export function matchRoute(segments: string[]): { tool: ToolDef; pathParams: Record<string, number> } | undefined {
  for (const r of restRoutes) {
    const parts = r.pattern.split("/");
    if (parts.length !== segments.length) continue;
    const params: Record<string, number> = {};
    let ok = true;
    for (let n = 0; n < parts.length; n++) {
      if (parts[n].startsWith(":")) {
        if (!/^\d{1,10}$/.test(segments[n])) {
          ok = false;
          break;
        }
        params[parts[n].slice(1)] = Number(segments[n]);
      } else if (parts[n] !== segments[n]) {
        ok = false;
        break;
      }
    }
    const tool = toolByName.get(r.tool);
    if (ok && tool && !tool.write) return { tool, pathParams: params };
  }
  return undefined;
}

/** Underlying zod type name after unwrapping optional/default. */
export function baseType(schema: z.ZodType): string {
  let def = (schema as unknown as { _zod: { def: { type: string; innerType?: z.ZodType } } })._zod.def;
  while ((def.type === "optional" || def.type === "default" || def.type === "nullable") && def.innerType) {
    def = (def.innerType as unknown as { _zod: { def: typeof def } })._zod.def;
  }
  return def.type;
}

/** Coerce query-string values to the types the tool schema expects. */
export function coerceQuery(tool: ToolDef, params: URLSearchParams): Record<string, unknown> {
  const shape = tool.input.shape as Record<string, z.ZodType>;
  const out: Record<string, unknown> = {};
  for (const [k, v] of params) {
    const s = shape[k];
    if (!s) throw new BridgeError(`Unknown query parameter: ${k.slice(0, 40)}`);
    const t = baseType(s);
    if (t === "number") out[k] = v.trim() === "" ? undefined : Number(v);
    else if (t === "boolean") out[k] = v === "true" ? true : v === "false" ? false : v;
    else out[k] = v;
  }
  return out;
}
