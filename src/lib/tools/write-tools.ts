import { z } from "zod";
import { miscCatalogItemId } from "../config";
import { cw } from "../cw/client";
import { cond, cwDate, or } from "../cw/conditions";
import { BridgeError } from "../errors";
import { compact } from "../sanitize";
import { confirmTokenField, runWrite } from "../writes";
import { dateInput, id, memberIdentifier } from "./common";
import { defineTool, type PlannedRequest } from "./types";

type Raw = Record<string, any>;

const WRITE_NOTE = " WRITE TOOL: requires WRITES_ENABLED and a two-step confirm (first call = dry run preview + confirm_token).";

/** CW wants second-precision UTC: 2026-01-31T14:00:00Z */
const cwTime = (d: Date) => cwDate(d).slice(1, -1);

const brief = (r: unknown) => {
  const o = (r ?? {}) as Raw;
  return compact({ id: o.id, name: o.name ?? o.summary, status: o.status?.name });
};

// ---------------------------------------------------------------- notes

export const addTicketNote = defineTool({
  name: "cw_add_ticket_note",
  title: "Add ticket note",
  description:
    "Add a note to a service ticket. `visibility` is REQUIRED and has no default: 'internal' (Internal Analysis, staff " +
    "only) or 'customer_visible' (Discussion/Detail Description — the customer can see it). Confirm with the user " +
    "which one they intend." + WRITE_NOTE,
  input: z.object({
    ticket_id: id,
    text: z.string().trim().min(1).max(20000),
    visibility: z.enum(["internal", "customer_visible"]).describe("REQUIRED. internal = staff only; customer_visible = customer can see it"),
    mark_as_resolution: z.boolean().default(false).describe("Also flag the note as the ticket Resolution"),
    send_notifications: z.boolean().default(false).describe("Let ConnectWise send its configured email notifications"),
    confirm_token: confirmTokenField,
  }),
  write: true,
  auditIds: (i) => ({ ticket_id: i.ticket_id, visibility: i.visibility }),
  async handler(i) {
    return runWrite(
      "cw_add_ticket_note",
      i.confirm_token,
      async () => ({
        summary: `Add ${i.visibility === "internal" ? "INTERNAL" : "CUSTOMER-VISIBLE"} note to ticket #${i.ticket_id}${i.mark_as_resolution ? " (as resolution)" : ""}`,
        requests: [
          {
            method: "POST",
            path: `/service/tickets/${i.ticket_id}/notes`,
            purpose: "create note",
            body: {
              text: i.text,
              detailDescriptionFlag: i.visibility === "customer_visible",
              internalAnalysisFlag: i.visibility === "internal",
              resolutionFlag: i.mark_as_resolution,
              processNotifications: i.send_notifications,
            },
          },
        ],
      }),
      (r) => compact({ noteId: (r as Raw)?.id, ticketId: i.ticket_id }),
    );
  },
});

// ---------------------------------------------------------------- time

export const addTimeEntry = defineTool({
  name: "cw_add_time_entry",
  title: "Add time entry",
  description:
    "Log time against a service ticket for a member. Give start plus either end or hours. `billable` is required " +
    "(Billable, DoNotBill, NoCharge)." + WRITE_NOTE,
  input: z.object({
    ticket_id: id,
    member: memberIdentifier,
    start: z.string().refine((s) => !Number.isNaN(Date.parse(s)), "start must be an ISO datetime").describe("ISO datetime with offset, e.g. 2026-10-14T09:00:00-05:00"),
    end: z.string().refine((s) => !Number.isNaN(Date.parse(s)), "end must be an ISO datetime").optional(),
    hours: z.number().positive().max(24).optional().describe("Used when end is not given"),
    notes: z.string().trim().min(1).max(10000),
    billable: z.enum(["Billable", "DoNotBill", "NoCharge"]),
    work_type_id: id.optional(),
    confirm_token: confirmTokenField,
  }),
  write: true,
  auditIds: (i) => ({ ticket_id: i.ticket_id, member: i.member }),
  async handler(i) {
    const start = new Date(i.start);
    let end: Date;
    if (i.end) end = new Date(i.end);
    else if (i.hours) end = new Date(start.getTime() + i.hours * 3_600_000);
    else throw new BridgeError("Provide either end or hours");
    const hrs = (end.getTime() - start.getTime()) / 3_600_000;
    if (hrs <= 0) throw new BridgeError("end must be after start");
    if (hrs > 24) throw new BridgeError("A single time entry cannot exceed 24 hours");

    return runWrite(
      "cw_add_time_entry",
      i.confirm_token,
      async () => ({
        summary: `Log ${Math.round(hrs * 100) / 100}h (${i.billable}) for ${i.member} on ticket #${i.ticket_id}`,
        requests: [
          {
            method: "POST",
            path: "/time/entries",
            purpose: "create time entry",
            body: compact({
              chargeToId: i.ticket_id,
              chargeToType: "ServiceTicket",
              member: { identifier: i.member },
              timeStart: cwTime(start),
              timeEnd: cwTime(end),
              billableOption: i.billable,
              notes: i.notes,
              workType: i.work_type_id ? { id: i.work_type_id } : undefined,
            }),
          },
        ],
      }),
      (r) => compact({ timeEntryId: (r as Raw)?.id, hours: (r as Raw)?.actualHours, ticketId: i.ticket_id }),
    );
  },
});

// ---------------------------------------------------------------- ticket update

export const updateTicket = defineTool({
  name: "cw_update_ticket",
  title: "Update ticket",
  description:
    "Change a service ticket's status, priority, owner (assigned member) and/or board. Nothing else can be changed. " +
    "Use cw_list_boards_statuses / cw_list_members for valid ids. Moving boards usually needs a status valid on the " +
    "new board too." + WRITE_NOTE,
  input: z.object({
    ticket_id: id,
    status_id: id.optional(),
    priority_id: id.optional(),
    owner_member_id: id.optional().describe("Member id (from cw_list_members) to set as ticket owner"),
    board_id: id.optional(),
    confirm_token: confirmTokenField,
  }),
  write: true,
  auditIds: (i) => ({ ticket_id: i.ticket_id }),
  async handler(i) {
    const ops: { op: "replace"; path: string; value: { id: number } }[] = [];
    // Board first so the status is validated against the new board.
    if (i.board_id) ops.push({ op: "replace", path: "board", value: { id: i.board_id } });
    if (i.status_id) ops.push({ op: "replace", path: "status", value: { id: i.status_id } });
    if (i.priority_id) ops.push({ op: "replace", path: "priority", value: { id: i.priority_id } });
    if (i.owner_member_id) ops.push({ op: "replace", path: "owner", value: { id: i.owner_member_id } });
    if (ops.length === 0) throw new BridgeError("Nothing to update: give status_id, priority_id, owner_member_id or board_id");

    return runWrite(
      "cw_update_ticket",
      i.confirm_token,
      async () => {
        const cur = await cw().get<Raw>(`/service/tickets/${i.ticket_id}`, { fields: "id,summary,board,status,priority,owner" });
        const before = compact({ board: cur.board?.name, status: cur.status?.name, priority: cur.priority?.name, owner: cur.owner?.identifier });
        return {
          summary: `Update ticket #${i.ticket_id} "${String(cur.summary ?? "").slice(0, 80)}" — currently ${JSON.stringify(before)}; change: ${ops.map((o) => `${o.path}→${o.value.id}`).join(", ")}`,
          requests: [{ method: "PATCH", path: `/service/tickets/${i.ticket_id}`, purpose: "patch ticket", body: ops }],
        };
      },
      (r) => {
        const t = (r ?? {}) as Raw;
        return compact({ ticketId: t.id, board: t.board?.name, status: t.status?.name, priority: t.priority?.name, owner: t.owner?.identifier });
      },
    );
  },
});

// ---------------------------------------------------------------- sales

const lineItem = z
  .object({
    catalog_item_id: id.optional().describe("Catalog item id from cw_search_catalog (preferred)"),
    sku: z.string().trim().min(1).max(50).optional().describe("Catalog identifier; looked up if catalog_item_id is absent. For custom items, the vendor SKU"),
    description: z.string().trim().min(1).max(4000).optional().describe("Overrides the catalog description; required for custom items"),
    quantity: z.number().positive().max(100000),
    unit_price: z.number().min(0).optional().describe("Sell price per unit; required for custom items"),
    unit_cost: z.number().min(0).optional().describe("Cost per unit; required for custom items"),
    vendor_company_id: id.optional().describe("Vendor company id"),
  })
  .describe("A line from the catalog (catalog_item_id or sku) or a custom item (description + unit_price + unit_cost)");

type LineItem = z.infer<typeof lineItem>;

/** Resolve a line to a concrete catalog item id + overrides. Read-only lookups. */
async function resolveLine(l: LineItem): Promise<Record<string, unknown>> {
  let catalogId = l.catalog_item_id;
  let custom = false;
  if (!catalogId && l.sku) {
    const found = await cw().get<Raw[]>("/procurement/catalog", {
      conditions: or(cond.eq("identifier", l.sku), cond.eq("manufacturerPartNumber", l.sku)),
      pageSize: 2,
    });
    if (found?.length === 1) catalogId = found[0].id;
    else if ((found?.length ?? 0) > 1) throw new BridgeError(`SKU "${l.sku}" matches several catalog items; pass catalog_item_id`);
  }
  if (!catalogId) {
    custom = true;
    catalogId = miscCatalogItemId();
    if (!catalogId)
      throw new BridgeError(
        `Line "${l.sku ?? l.description ?? "?"}" is not in the catalog and CW_MISC_CATALOG_ITEM_ID is not configured for custom items`,
      );
    if (!l.description || l.unit_price === undefined || l.unit_cost === undefined)
      throw new BridgeError("Custom (non-catalog) lines need description, unit_price and unit_cost");
  }
  return compact({
    catalogItem: { id: catalogId },
    description: l.description,
    quantity: l.quantity,
    price: l.unit_price,
    cost: l.unit_cost,
    vendor: l.vendor_company_id ? { id: l.vendor_company_id } : undefined,
    vendorSku: custom ? l.sku : undefined,
    billableOption: "Billable",
  });
}

async function productRequests(lines: LineItem[], chargeToType: "Opportunity" | "SalesOrder", chargeToId: number | string): Promise<PlannedRequest[]> {
  const resolved = await Promise.all(lines.map(resolveLine));
  return resolved.map((body, n) => ({
    method: "POST",
    path: "/procurement/products",
    purpose: `add line ${n + 1}`,
    body: { ...body, chargeToType, chargeToId },
  }));
}

async function defaultSite(companyId: number): Promise<number> {
  const c = await cw().get<Raw>(`/company/companies/${companyId}`, { fields: "id,site" });
  if (typeof c?.site?.id !== "number") throw new BridgeError("Company has no default site; pass site_id");
  return c.site.id;
}

const productSummary = (r: unknown, req: PlannedRequest) => {
  const o = (r ?? {}) as Raw;
  return req.path === "/procurement/products"
    ? compact({ productId: o.id, catalogItem: o.catalogItem?.identifier, quantity: o.quantity, price: o.price })
    : brief(r);
};

export const createOpportunity = defineTool({
  name: "cw_create_opportunity",
  title: "Create opportunity",
  description:
    "Create a sales opportunity for a company/contact, optionally with product lines (catalog items or custom items)." + WRITE_NOTE,
  input: z.object({
    name: z.string().trim().min(1).max(100),
    company_id: id,
    contact_id: id,
    sales_rep_member_id: id.describe("Primary sales rep member id (cw_list_members)"),
    site_id: id.optional().describe("Company site id; defaults to the company's default site"),
    expected_close_date: dateInput.optional(),
    notes: z.string().trim().max(10000).optional(),
    line_items: z.array(lineItem).max(50).default([]),
    confirm_token: confirmTokenField,
  }),
  write: true,
  auditIds: (i) => ({ company_id: i.company_id, contact_id: i.contact_id }),
  async handler(i) {
    return runWrite(
      "cw_create_opportunity",
      i.confirm_token,
      async () => {
        const site = i.site_id ?? (await defaultSite(i.company_id));
        const requests: PlannedRequest[] = [
          {
            method: "POST",
            path: "/sales/opportunities",
            purpose: "create opportunity",
            body: compact({
              name: i.name,
              company: { id: i.company_id },
              contact: { id: i.contact_id },
              site: { id: site },
              primarySalesRep: { id: i.sales_rep_member_id },
              expectedCloseDate: i.expected_close_date ? cwTime(new Date(i.expected_close_date)) : undefined,
              notes: i.notes,
            }),
          },
          ...(await productRequests(i.line_items, "Opportunity", "$ref:0.id")),
        ];
        return { summary: `Create opportunity "${i.name}" for company ${i.company_id} with ${i.line_items.length} line(s)`, requests };
      },
      productSummary,
    );
  },
});

export const createSalesOrder = defineTool({
  name: "cw_create_sales_order",
  title: "Create sales order",
  description:
    "Create a sales order for a company/contact with product lines (catalog items or custom items with description, " +
    "qty, unit cost, unit price, vendor, SKU)." + WRITE_NOTE,
  input: z.object({
    company_id: id,
    contact_id: id,
    sales_rep_member_id: id,
    status_id: id.optional().describe("Sales order status id; defaults to the status flagged default in ConnectWise"),
    order_date: dateInput.optional(),
    po_number: z.string().trim().max(50).optional(),
    notes: z.string().trim().max(10000).optional(),
    line_items: z.array(lineItem).min(1).max(50),
    confirm_token: confirmTokenField,
  }),
  write: true,
  auditIds: (i) => ({ company_id: i.company_id, contact_id: i.contact_id }),
  async handler(i) {
    return runWrite(
      "cw_create_sales_order",
      i.confirm_token,
      async () => {
        let status = i.status_id;
        if (!status) {
          const s = await cw().get<Raw[]>("/sales/orders/statuses", { conditions: cond.eq("defaultFlag", true), pageSize: 1 });
          status = s?.[0]?.id;
          if (!status) throw new BridgeError("No default sales order status found; pass status_id");
        }
        const requests: PlannedRequest[] = [
          {
            method: "POST",
            path: "/sales/orders",
            purpose: "create sales order",
            body: compact({
              company: { id: i.company_id },
              contact: { id: i.contact_id },
              salesRep: { id: i.sales_rep_member_id },
              status: { id: status },
              orderDate: i.order_date ? cwTime(new Date(i.order_date)) : undefined,
              poNumber: i.po_number,
              notes: i.notes,
            }),
          },
          ...(await productRequests(i.line_items, "SalesOrder", "$ref:0.id")),
        ];
        return { summary: `Create sales order for company ${i.company_id} with ${i.line_items.length} line(s)`, requests };
      },
      productSummary,
    );
  },
});

export const addSalesOrderLine = defineTool({
  name: "cw_add_sales_order_line",
  title: "Add sales order line",
  description: "Add one product line (catalog or custom item) to an existing sales order." + WRITE_NOTE,
  input: z.object({ order_id: id, line_item: lineItem, confirm_token: confirmTokenField }),
  write: true,
  auditIds: (i) => ({ order_id: i.order_id }),
  async handler(i) {
    return runWrite(
      "cw_add_sales_order_line",
      i.confirm_token,
      async () => {
        await cw().get(`/sales/orders/${i.order_id}`, { fields: "id" }); // 404s early if the order doesn't exist
        return { summary: `Add 1 line to sales order #${i.order_id}`, requests: await productRequests([i.line_item], "SalesOrder", i.order_id) };
      },
      productSummary,
    );
  },
});
