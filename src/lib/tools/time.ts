import { z } from "zod";
import { cw } from "../cw/client";
import { and, cond } from "../cw/conditions";
import { BridgeError } from "../errors";
import { clean, compact } from "../sanitize";
import { dateInput, id, limit, memberIdentifier, rangeEnd, rangeStart } from "./common";
import { defineTool } from "./types";

type Raw = Record<string, any>;

export const TIME_FIELDS =
  "id,company,chargeToId,chargeToType,member,timeStart,timeEnd,actualHours,hoursBilled,billableOption,notes,workType,workRole,ticket,_info";

export function mapTimeEntry(t: Raw) {
  return compact({
    id: t.id,
    member: t.member?.identifier,
    company: t.company?.name,
    companyId: t.company?.id,
    chargeTo: t.chargeToType && t.chargeToId ? `${t.chargeToType}#${t.chargeToId}` : undefined,
    ticketId: t.chargeToType === "ServiceTicket" || t.chargeToType === "ProjectTicket" ? t.chargeToId : undefined,
    start: t.timeStart,
    end: t.timeEnd,
    hours: typeof t.actualHours === "number" ? t.actualHours : 0,
    billable: t.billableOption as string | undefined,
    workType: t.workType?.name,
    notes: clean(t.notes, 300),
  }) as { id: number; hours: number; billable?: string; member?: string; company?: string; start?: string; [k: string]: unknown };
}

const r2 = (n: number) => Math.round(n * 100) / 100;

const rangeFilters = {
  member: memberIdentifier.optional(),
  company_id: id.optional(),
  ticket_id: id.optional().describe("Service ticket id"),
  start_date: dateInput.describe("Range start (inclusive). Dates are UTC."),
  end_date: dateInput.describe("Range end (inclusive when a plain date)"),
};

function rangeConditions(i: { member?: string; company_id?: number; ticket_id?: number; start_date: string; end_date: string }) {
  const start = rangeStart(i.start_date);
  const end = rangeEnd(i.end_date);
  if (end <= start) throw new BridgeError("end_date must be on or after start_date");
  if (end.getTime() - start.getTime() > 366 * 864e5) throw new BridgeError("Date range cannot exceed 366 days");
  return and(
    i.member && cond.eq("member/identifier", i.member),
    i.company_id && cond.eq("company/id", i.company_id),
    i.ticket_id && and(cond.eq("chargeToId", i.ticket_id), cond.eq("chargeToType", "ServiceTicket")),
    cond.dateGte("timeStart", start),
    cond.dateLt("timeStart", end),
  );
}

function totals(entries: { hours: number; billable?: string }[]) {
  const hours = entries.reduce((s, e) => s + e.hours, 0);
  const billable = entries.filter((e) => e.billable === "Billable").reduce((s, e) => s + e.hours, 0);
  return { entries: entries.length, hours: r2(hours), billableHours: r2(billable), nonBillableHours: r2(hours - billable) };
}

export const searchTimeEntries = defineTool({
  name: "cw_search_time_entries",
  title: "Search time entries",
  description:
    "Search ConnectWise time entries in a date range, optionally by member, company or ticket. Each row has hours and " +
    "billable status (Billable / DoNotBill / NoCharge / NoDefault). Returns totals (hours, billable, non-billable).",
  input: z.object({ ...rangeFilters, billable_only: z.boolean().default(false), limit: limit(200, 2000) }),
  write: false,
  auditIds: (i) => ({ company_id: i.company_id, ticket_id: i.ticket_id, member: i.member }),
  async handler(i) {
    const conditions = and(rangeConditions(i), i.billable_only && cond.eq("billableOption", "Billable"));
    const r = await cw().list<Raw>("/time/entries", { conditions, orderBy: "timeStart asc", fields: TIME_FIELDS }, i.limit);
    const entries = r.items.map(mapTimeEntry);
    return { totals: totals(entries), truncated: r.truncated, entries };
  },
});

export const timeSummary = defineTool({
  name: "cw_time_summary",
  title: "Summarize hours",
  description:
    "Aggregate ConnectWise time for a date range: hours grouped by member, company, day or ticket, split billable vs " +
    "non-billable. Use for utilization / 'how many hours did X log' questions. Scans up to 5000 entries.",
  input: z.object({
    ...rangeFilters,
    group_by: z.enum(["member", "company", "day", "ticket"]).default("member"),
  }),
  write: false,
  auditIds: (i) => ({ company_id: i.company_id, member: i.member }),
  async handler(i) {
    const r = await cw().list<Raw>(
      "/time/entries",
      { conditions: rangeConditions(i), orderBy: "timeStart asc", fields: "id,company,chargeToId,chargeToType,member,timeStart,actualHours,billableOption" },
      5000,
    );
    const entries = r.items.map(mapTimeEntry);
    const keyOf = (e: ReturnType<typeof mapTimeEntry>) =>
      i.group_by === "member"
        ? (e.member ?? "unknown")
        : i.group_by === "company"
          ? (e.company ?? "unknown")
          : i.group_by === "day"
            ? (e.start ?? "").slice(0, 10) || "unknown"
            : e.ticketId
              ? `#${e.ticketId}`
              : "non-ticket";
    const groups = new Map<string, ReturnType<typeof mapTimeEntry>[]>();
    for (const e of entries) {
      const k = String(keyOf(e));
      groups.set(k, [...(groups.get(k) ?? []), e]);
    }
    const rows = [...groups.entries()]
      .map(([key, es]) => ({ key, ...totals(es) }))
      .sort((a, b) => (i.group_by === "day" ? a.key.localeCompare(b.key) : b.hours - a.hours));
    return { range: { start: i.start_date, end: i.end_date }, groupBy: i.group_by, totals: totals(entries), truncated: r.truncated, groups: rows };
  },
});
