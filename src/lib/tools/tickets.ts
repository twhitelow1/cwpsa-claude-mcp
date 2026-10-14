import { z } from "zod";
import { cw } from "../cw/client";
import { and, cond, or } from "../cw/conditions";
import { clean, compact, ref } from "../sanitize";
import { dateInput, id, limit, memberIdentifier, rangeEnd, rangeStart, searchText } from "./common";
import { defineTool } from "./types";
import { mapTimeEntry, TIME_FIELDS } from "./time";

type Raw = Record<string, any>;

export const TICKET_FIELDS =
  "id,summary,board,status,company,contact,priority,owner,resources,closedFlag,actualHours,budgetHours,type,subType,severity,impact,requiredDate,_info";

export function mapTicket(t: Raw) {
  return compact({
    id: t.id,
    summary: t.summary,
    board: ref(t.board),
    status: ref(t.status),
    company: ref(t.company),
    contact: ref(t.contact),
    priority: ref(t.priority),
    owner: t.owner?.identifier,
    resources: t.resources,
    type: t.type?.name,
    subType: t.subType?.name,
    severity: t.severity,
    impact: t.impact,
    closed: t.closedFlag,
    actualHours: t.actualHours,
    budgetHours: t.budgetHours,
    required: t.requiredDate,
    entered: t._info?.dateEntered,
    updated: t._info?.lastUpdated,
  });
}

export function mapNote(n: Raw, maxChars: number) {
  return compact({
    id: n.id,
    date: n.dateCreated ?? n._info?.dateEntered,
    by: n.member?.identifier ?? n.contact?.name ?? n.createdBy,
    kind: n.internalAnalysisFlag ? "internal" : n.resolutionFlag ? "resolution" : n.detailDescriptionFlag ? "description" : "other",
    text: clean(n.text, maxChars),
  });
}

const ORDER = { newest: "id desc", oldest: "id asc", updated: "_info/lastUpdated desc" } as const;

export const searchTickets = defineTool({
  name: "cw_search_tickets",
  title: "Search service tickets",
  description:
    "Search ConnectWise service tickets. Defaults to OPEN tickets, newest first. Filter by status, board, company, " +
    "assigned member, priority, date entered/updated range, or text in the summary. Returns compact rows plus the " +
    "total match count. Use cw_get_ticket for full details/notes, and cw_list_boards_statuses to find valid ids.",
  input: z.object({
    summary_contains: searchText.optional().describe("Text that must appear in the ticket summary"),
    status: searchText.optional().describe("Status name, exact (e.g. 'New', 'In Progress')"),
    status_id: id.optional(),
    board: searchText.optional().describe("Board name, exact"),
    board_id: id.optional(),
    company_id: id.optional(),
    company_name: searchText.optional().describe("Partial company name"),
    assigned_member: memberIdentifier.optional().describe("Member identifier: matches ticket owner OR assigned resources"),
    priority_id: id.optional(),
    priority: searchText.optional().describe("Priority name, partial match"),
    entered_after: dateInput.optional(),
    entered_before: dateInput.optional(),
    updated_after: dateInput.optional(),
    include_closed: z.boolean().default(false).describe("Include closed tickets (default false: open only)"),
    order: z.enum(["newest", "oldest", "updated"]).default("newest"),
    limit: limit(25, 500),
  }),
  write: false,
  auditIds: (i) => ({ company_id: i.company_id, board_id: i.board_id }),
  async handler(i) {
    const conditions = and(
      !i.include_closed && cond.eq("closedFlag", false),
      i.summary_contains && cond.contains("summary", i.summary_contains),
      i.status && cond.eq("status/name", i.status),
      i.status_id && cond.eq("status/id", i.status_id),
      i.board && cond.eq("board/name", i.board),
      i.board_id && cond.eq("board/id", i.board_id),
      i.company_id && cond.eq("company/id", i.company_id),
      i.company_name && cond.contains("company/name", i.company_name),
      i.assigned_member && or(cond.eq("owner/identifier", i.assigned_member), cond.contains("resources", i.assigned_member)),
      i.priority_id && cond.eq("priority/id", i.priority_id),
      i.priority && cond.contains("priority/name", i.priority),
      i.entered_after && cond.dateGte("_info/dateEntered", rangeStart(i.entered_after)),
      i.entered_before && cond.dateLt("_info/dateEntered", rangeEnd(i.entered_before)),
      i.updated_after && cond.dateGte("_info/lastUpdated", rangeStart(i.updated_after)),
    );
    const client = cw();
    const [total, page] = await Promise.all([
      client.count("/service/tickets", conditions),
      client.list<Raw>("/service/tickets", { conditions, orderBy: ORDER[i.order], fields: TICKET_FIELDS }, i.limit),
    ]);
    return { total, returned: page.items.length, truncated: page.truncated, tickets: page.items.map(mapTicket) };
  },
});

export const getTicket = defineTool({
  name: "cw_get_ticket",
  title: "Get ticket with notes, time and configs",
  description:
    "Get one service ticket by id with its notes (HTML stripped, oldest first), time entries (with hours totals) and " +
    "attached configurations. Use this when you need the full history of a ticket.",
  input: z.object({
    ticket_id: id,
    include_notes: z.boolean().default(true),
    include_time: z.boolean().default(true),
    include_configs: z.boolean().default(true),
    note_max_chars: z.number().int().min(100).max(10000).default(1500).describe("Per-note text cap"),
  }),
  write: false,
  auditIds: (i) => ({ ticket_id: i.ticket_id }),
  async handler(i) {
    const client = cw();
    const tid = i.ticket_id;
    const [ticket, notes, time, configs] = await Promise.all([
      client.get<Raw>(`/service/tickets/${tid}`),
      i.include_notes ? client.list<Raw>(`/service/tickets/${tid}/notes`, { orderBy: "id asc" }, 500) : undefined,
      i.include_time
        ? client.list<Raw>(
            "/time/entries",
            { conditions: and(cond.eq("chargeToId", tid), cond.eq("chargeToType", "ServiceTicket")), orderBy: "timeStart asc", fields: TIME_FIELDS },
            500,
          )
        : undefined,
      i.include_configs ? client.list<Raw>(`/service/tickets/${tid}/configurations`, {}, 100) : undefined,
    ]);
    const entries = time?.items.map(mapTimeEntry);
    return compact({
      ticket: mapTicket(ticket),
      notes: notes && { count: notes.items.length, truncated: notes.truncated, items: notes.items.map((n) => mapNote(n, i.note_max_chars)) },
      time:
        entries && {
          count: entries.length,
          totalHours: round(entries.reduce((s, e) => s + (e.hours ?? 0), 0)),
          billableHours: round(entries.filter((e) => e.billable === "Billable").reduce((s, e) => s + (e.hours ?? 0), 0)),
          entries,
        },
      configurations: configs?.items.map((c) =>
        compact({ id: c.id, name: c.deviceIdentifier ?? c.name, type: c.type?.name ?? c.type, serial: c.serialNumber, status: c.status?.name }),
      ),
    });
  },
});

export const listTicketNotes = defineTool({
  name: "cw_list_ticket_notes",
  title: "List ticket notes",
  description:
    "List the notes on a service ticket (HTML stripped). Filter by kind: description (customer-visible discussion), " +
    "internal (internal analysis), or resolution.",
  input: z.object({
    ticket_id: id,
    kind: z.enum(["all", "description", "internal", "resolution"]).default("all"),
    newest_first: z.boolean().default(false),
    note_max_chars: z.number().int().min(100).max(10000).default(2000),
    limit: limit(100, 500),
  }),
  write: false,
  auditIds: (i) => ({ ticket_id: i.ticket_id }),
  async handler(i) {
    const flag = { all: undefined, description: "detailDescriptionFlag", internal: "internalAnalysisFlag", resolution: "resolutionFlag" }[i.kind];
    const r = await cw().list<Raw>(
      `/service/tickets/${i.ticket_id}/notes`,
      { conditions: flag ? cond.eq(flag, true) : undefined, orderBy: i.newest_first ? "id desc" : "id asc" },
      i.limit,
    );
    return { ticket_id: i.ticket_id, count: r.items.length, truncated: r.truncated, notes: r.items.map((n) => mapNote(n, i.note_max_chars)) };
  },
});

const round = (n: number) => Math.round(n * 100) / 100;
