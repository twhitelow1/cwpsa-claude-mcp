import { beforeEach, describe, expect, it } from "vitest";
import { _resetUsedTokens } from "@/lib/confirm";
import { runTool } from "@/lib/run";
import { coerceQuery, matchRoute } from "@/lib/rest";
import { toolByName } from "@/lib/tools";
import { mockCw, setEnv } from "./helpers";

const tool = (n: string) => toolByName.get(n)!;

describe("read tools", () => {
  beforeEach(() => setEnv());

  it("cw_search_tickets defaults to open tickets and returns total", async () => {
    const { calls } = mockCw((c) =>
      c.url.pathname.endsWith("/count")
        ? { body: { count: 42 } }
        : { body: [{ id: 7, summary: "<b>Printer</b>", board: { id: 1, name: "Help Desk", _info: {} }, status: { id: 2, name: "New" }, _info: { dateEntered: "2026-10-01T00:00:00Z" } }] },
    );
    const r = await runTool(tool("cw_search_tickets"), { company_name: 'Bob\'s "Pizza"', assigned_member: "tlow" });
    expect(r.ok).toBe(true);
    const cond = calls[1].url.searchParams.get("conditions")!;
    expect(cond).toContain("closedFlag = false");
    expect(cond).toContain('company/name like "%Bob\'s \\"Pizza\\"%"');
    expect(cond).toContain('(owner/identifier = "tlow" or resources like "%tlow%")');
    if (r.ok) expect(r.data).toMatchObject({ total: 42, tickets: [{ id: 7, board: { id: 1, name: "Help Desk" }, status: { name: "New" } }] });
  });

  it("validates input with zod", async () => {
    mockCw(() => ({ body: [] }));
    const r = await runTool(tool("cw_search_tickets"), { limit: 5000 });
    expect(r).toMatchObject({ ok: false, status: 400, code: "invalid_input" });
    const r2 = await runTool(tool("cw_search_time_entries"), { member: 'x" or 1=1', start_date: "2026-01-01", end_date: "2026-01-02" });
    expect(r2).toMatchObject({ ok: false, code: "invalid_input" });
  });

  it("cw_time_summary groups and splits billable", async () => {
    mockCw(() => ({
      body: [
        { id: 1, member: { identifier: "a" }, timeStart: "2026-10-01T10:00:00Z", actualHours: 2, billableOption: "Billable" },
        { id: 2, member: { identifier: "a" }, timeStart: "2026-10-02T10:00:00Z", actualHours: 1.5, billableOption: "DoNotBill" },
        { id: 3, member: { identifier: "b" }, timeStart: "2026-10-02T10:00:00Z", actualHours: 1, billableOption: "Billable" },
      ],
    }));
    const r = await runTool(tool("cw_time_summary"), { start_date: "2026-10-01", end_date: "2026-10-07", group_by: "member" });
    expect(r.ok && r.data).toMatchObject({
      totals: { entries: 3, hours: 4.5, billableHours: 3, nonBillableHours: 1.5 },
      groups: [
        { key: "a", hours: 3.5, billableHours: 2 },
        { key: "b", hours: 1 },
      ],
    });
  });

  it("time range end date is inclusive", async () => {
    const { calls } = mockCw(() => ({ body: [] }));
    await runTool(tool("cw_search_time_entries"), { start_date: "2026-10-01", end_date: "2026-10-07" });
    expect(calls[0].url.searchParams.get("conditions")).toBe("timeStart >= [2026-10-01T00:00:00Z] and timeStart < [2026-10-08T00:00:00Z]");
  });

  it("does not leak internal errors", async () => {
    mockCw(() => {
      throw new Error("socket to https://secret.internal failed");
    });
    const r = await runTool(tool("cw_get_company"), { company_id: 1 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).not.toContain("secret.internal");
  });
});

describe("write tools", () => {
  beforeEach(() => {
    setEnv();
    _resetUsedTokens();
  });

  const note = { ticket_id: 55, text: "Rebooted the server", visibility: "internal" };

  it("are blocked when WRITES_ENABLED is not true", async () => {
    const { calls } = mockCw(() => ({ body: {} }));
    const r = await runTool(tool("cw_add_ticket_note"), note);
    expect(r).toMatchObject({ ok: false, status: 403, code: "writes_disabled" });
    expect(calls).toHaveLength(0);
  });

  it("require an explicit visibility (no default)", async () => {
    setEnv({ WRITES_ENABLED: "true" });
    mockCw(() => ({ body: {} }));
    const r = await runTool(tool("cw_add_ticket_note"), { ticket_id: 55, text: "x" });
    expect(r).toMatchObject({ ok: false, code: "invalid_input" });
  });

  it("dry run → confirm executes exactly the previewed request once", async () => {
    setEnv({ WRITES_ENABLED: "true" });
    const { calls } = mockCw(() => ({ body: { id: 999 } }));
    const dry = await runTool(tool("cw_add_ticket_note"), note);
    expect(calls).toHaveLength(0);
    expect(dry.ok).toBe(true);
    const d = (dry as { data: any }).data;
    expect(d.dry_run).toBe(true);
    expect(d.will_send[0]).toMatchObject({ method: "POST", path: "/service/tickets/55/notes", body: { internalAnalysisFlag: true, detailDescriptionFlag: false } });

    const exec = await runTool(tool("cw_add_ticket_note"), { ...note, confirm_token: d.confirm_token });
    expect(exec.ok && exec.data).toMatchObject({ executed: true, results: [{ noteId: 999 }] });
    expect(calls).toHaveLength(1);
    expect(calls[0].body).toEqual(d.will_send[0].body);

    const replay = await runTool(tool("cw_add_ticket_note"), { ...note, confirm_token: d.confirm_token });
    expect(replay).toMatchObject({ ok: false, code: "confirm_rejected" });
    expect(calls).toHaveLength(1);
  });

  it("confirm token is bound to the payload", async () => {
    setEnv({ WRITES_ENABLED: "true" });
    const { calls } = mockCw(() => ({ body: { id: 1 } }));
    const dry = (await runTool(tool("cw_add_ticket_note"), note)) as { data: any };
    const r = await runTool(tool("cw_add_ticket_note"), { ...note, visibility: "customer_visible", confirm_token: dry.data.confirm_token });
    expect(r).toMatchObject({ ok: false, code: "confirm_rejected" });
    expect(calls).toHaveLength(0);
  });

  it("sales order chains created id into product lines", async () => {
    setEnv({ WRITES_ENABLED: "true", CW_MISC_CATALOG_ITEM_ID: "500" });
    const input = {
      company_id: 1,
      contact_id: 2,
      sales_rep_member_id: 3,
      status_id: 4,
      line_items: [
        { sku: "ABC-1", quantity: 2 },
        { sku: "CUSTOM-9", description: "Custom cable", quantity: 1, unit_price: 20, unit_cost: 10 },
      ],
    };
    // line 1 resolves by SKU; line 2 misses the catalog and falls back to the misc item
    let lookups = 0;
    const { calls } = mockCw((c) => {
      if (c.url.pathname.endsWith("/procurement/catalog")) return { body: ++lookups === 1 ? [{ id: 321 }] : [] };
      if (c.method === "POST" && c.url.pathname.endsWith("/sales/orders")) return { body: { id: 77 } };
      if (c.method === "POST") return { body: { id: 5000 } };
      return { body: [] };
    });
    const dry = (await runTool(tool("cw_create_sales_order"), input)) as { data: any };
    expect(dry.data.will_send).toHaveLength(3);
    expect(dry.data.will_send[1].body).toMatchObject({ catalogItem: { id: 321 }, chargeToType: "SalesOrder", chargeToId: "$ref:0.id" });
    expect(dry.data.will_send[2].body).toMatchObject({ catalogItem: { id: 500 }, vendorSku: "CUSTOM-9", price: 20, cost: 10 });

    lookups = 0;
    const exec = (await runTool(tool("cw_create_sales_order"), { ...input, confirm_token: dry.data.confirm_token })) as { ok: boolean; data: any };
    expect(exec.ok).toBe(true);
    expect(exec.data.executed).toBe(true);
    const posts = calls.filter((c) => c.method === "POST");
    expect(posts.map((c) => c.url.pathname.split("/3.0")[1])).toEqual(["/sales/orders", "/procurement/products", "/procurement/products"]);
    expect(posts[1].body).toMatchObject({ chargeToId: 77, chargeToType: "SalesOrder" });
  });

  it("there are no delete operations", () => {
    for (const t of toolByName.values()) expect(t.name).not.toMatch(/delete|remove/);
  });
});

describe("REST mapping", () => {
  it("matches routes and coerces query types by schema", () => {
    const m = matchRoute(["tickets", "123", "notes"])!;
    expect(m.tool.name).toBe("cw_list_ticket_notes");
    expect(m.pathParams).toEqual({ ticket_id: 123 });
    expect(matchRoute(["tickets", "abc"])).toBeUndefined();
    const q = coerceQuery(toolByName.get("cw_search_tickets")!, new URLSearchParams("summary_contains=1234&limit=5&include_closed=true"));
    expect(q).toEqual({ summary_contains: "1234", limit: 5, include_closed: true });
    expect(() => coerceQuery(toolByName.get("cw_search_tickets")!, new URLSearchParams("bogus=1"))).toThrow();
  });
});
