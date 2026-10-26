import { beforeEach, describe, expect, it } from "vitest";
import { pickRule, priceItem } from "@/lib/pricing";
import { runTool } from "@/lib/run";
import { matchRoute } from "@/lib/rest";
import { toolByName } from "@/lib/tools";
import { mockCw, setEnv } from "./helpers";

const all25 = [{ category: [], marginPct: 25 }];

describe("priceItem", () => {
  it("applies margin as cost / (1 - margin)", () => {
    const r = priceItem({ cost: 100, rules: all25 });
    expect(r).toMatchObject({ sellPrice: 133.33, profit: 33.33, marginPct: 25, source: "rule" });
  });

  it("applies a fixed profit amount", () => {
    expect(priceItem({ cost: 100, rules: [{ category: [], profitAmount: 40 }] }).sellPrice).toBe(140);
  });

  it("picks the most specific category rule, case-insensitively", () => {
    const rules = [
      { category: [], marginPct: 20 },
      { category: ["Hardware"], marginPct: 15 },
      { category: ["Hardware", "Laptops"], marginPct: 10 },
      { category: ["Software"], marginPct: 50 },
    ];
    expect(pickRule(rules, ["hardware", "LAPTOPS", "Business"])?.marginPct).toBe(10);
    expect(pickRule(rules, ["Hardware", "Monitors"])?.marginPct).toBe(15);
    expect(pickRule(rules, ["Services"])?.marginPct).toBe(20);
    expect(pickRule(rules.slice(1), ["Services"])).toBeUndefined();
    expect(priceItem({ cost: 90, categoryPath: ["Hardware", "Laptops"], rules }).sellPrice).toBe(100);
  });

  it("list price guard: cap at list, never below cost", () => {
    expect(priceItem({ cost: 100, listPrice: 120, rules: all25, guard: { mode: "cap" } }).sellPrice).toBe(120);
    expect(priceItem({ cost: 100, listPrice: 90, rules: all25, guard: { mode: "cap" } }).sellPrice).toBe(100);
    expect(priceItem({ cost: 100, listPrice: 120, rules: all25, guard: { mode: "ignore" } }).sellPrice).toBe(133.33);
  });

  it("list price guard: partial sacrifice (doc example: cost 100, 25%, list 120, guard 60% → 120)", () => {
    expect(priceItem({ cost: 100, listPrice: 120, rules: all25, guard: { mode: "partial", sacrificePct: 60 } }).sellPrice).toBe(120);
    // Only 30% may be given up: floor is 100 + 33.33 * 0.7 = 123.33, above list.
    expect(priceItem({ cost: 100, listPrice: 120, rules: all25, guard: { mode: "partial", sacrificePct: 30 } }).sellPrice).toBe(123.33);
  });

  it("group discount comes off the profit", () => {
    expect(priceItem({ cost: 100, rules: [{ category: [], profitAmount: 40 }], groupDiscountPct: 25 }).sellPrice).toBe(130);
  });

  it("overrides: fixed < bid; quoted beats fixed, and beats bid only when higher", () => {
    const base = { cost: 100, rules: all25 };
    expect(priceItem({ ...base, fixedPrice: 150 })).toMatchObject({ sellPrice: 150, source: "fixed" });
    expect(priceItem({ ...base, fixedPrice: 150, bidPrice: 110 })).toMatchObject({ sellPrice: 110, source: "bid" });
    expect(priceItem({ ...base, bidPrice: 110, quotedPrice: 115 })).toMatchObject({ sellPrice: 115, source: "quoted" });
    expect(priceItem({ ...base, bidPrice: 110, quotedPrice: 105 })).toMatchObject({ sellPrice: 110, source: "bid" });
    expect(priceItem({ ...base, fixedPrice: 150, quotedPrice: 140 })).toMatchObject({ sellPrice: 140, source: "quoted" });
  });

  it("explains each step and rejects bad input", () => {
    const r = priceItem({ cost: 100, listPrice: 120, rules: all25, guard: { mode: "cap" } });
    expect(r.steps).toEqual(["Cost $100.00", 'Rule "All products": margin 25% → $133.33', "List price guard (cap): limited to list $120.00 → $120.00"]);
    expect(() => priceItem({ cost: -1, rules: all25 })).toThrow();
    expect(() => priceItem({ cost: 1, rules: [{ category: [], marginPct: 100 }] })).toThrow();
  });
});

describe("cw_price_catalog", () => {
  beforeEach(() => setEnv());
  const tool = toolByName.get("cw_price_catalog")!;

  it("prices catalog items from cost and reports steps", async () => {
    const { calls } = mockCw(() => ({
      body: [
        { id: 1, identifier: "LAP-1", description: "Laptop", cost: 900, price: 1150 },
        { id: 2, identifier: "SVC-1", description: "Setup" },
      ],
    }));
    const r = await runTool(tool, { keyword: "lap", margin_pct: 25, list_price_guard: "cap" });
    expect(r.ok).toBe(true);
    expect(calls[0].method).toBe("GET");
    expect(calls[0].url.pathname).toMatch(/\/procurement\/catalog$/);
    if (r.ok)
      expect(r.data).toMatchObject({
        count: 2,
        items: [
          { id: 1, sku: "LAP-1", cost: 900, price: 1150, pricing: { sellPrice: 1150, profit: 250, marginPct: 21.74 } },
          { id: 2, pricing: { error: "no cost on catalog item" } },
        ],
      });
  });

  it("validates margin range and is exposed on REST", async () => {
    mockCw(() => ({ body: [] }));
    expect(await runTool(tool, { margin_pct: 100 })).toMatchObject({ ok: false, code: "invalid_input" });
    expect(matchRoute(["catalog", "pricing"])?.tool.name).toBe("cw_price_catalog");
  });
});
