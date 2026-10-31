import { z } from "zod";
import { cw } from "../cw/client";
import { and, cond, or } from "../cw/conditions";
import { priceItem, type ListPriceGuard } from "../pricing";
import { clean, compact, ref } from "../sanitize";
import { limit, searchText } from "./common";
import { defineTool } from "./types";

type Raw = Record<string, any>;

export function mapCatalogItem(c: Raw) {
  return compact({
    id: c.id,
    sku: c.identifier,
    description: clean(c.description, 200),
    mfrPartNumber: c.manufacturerPartNumber,
    manufacturer: c.manufacturer?.name,
    vendor: ref(c.vendor),
    category: c.category?.name,
    subcategory: c.subcategory?.name,
    type: c.type?.name,
    productClass: c.productClass,
    price: c.price,
    cost: c.cost,
    inactive: c.inactiveFlag || undefined,
  });
}

export const searchCatalog = defineTool({
  name: "cw_search_catalog",
  title: "Search product catalog",
  description:
    "Search the ConnectWise procurement catalog by keyword (matches SKU/identifier or description), exact SKU / " +
    "manufacturer part number, or vendor name. Returns catalog item ids, price and cost — use the id as " +
    "catalog_item_id when creating opportunity or sales order lines.",
  input: z.object({
    keyword: searchText.optional(),
    sku: searchText.optional().describe("Exact catalog identifier or manufacturer part number"),
    vendor: searchText.optional().describe("Partial vendor company name"),
    include_inactive: z.boolean().default(false),
    limit: limit(25, 500),
  }),
  write: false,
  async handler(i) {
    const r = await listCatalog(i);
    return { count: r.items.length, truncated: r.truncated, items: r.items.map(mapCatalogItem) };
  },
});

type CatalogQuery = { keyword?: string; sku?: string; vendor?: string; include_inactive: boolean; limit: number };

function listCatalog(i: CatalogQuery) {
  const conditions = and(
    !i.include_inactive && cond.eq("inactiveFlag", false),
    i.keyword && or(cond.contains("identifier", i.keyword), cond.contains("description", i.keyword)),
    i.sku && or(cond.eq("identifier", i.sku), cond.eq("manufacturerPartNumber", i.sku)),
    i.vendor && cond.contains("vendor/name", i.vendor),
  );
  return cw().list<Raw>("/procurement/catalog", { conditions, orderBy: "identifier asc" }, i.limit);
}

const pct = z.number().min(0).max(99.99);

export const priceCatalog = defineTool({
  name: "cw_price_catalog",
  title: "Price catalog items with margin rules",
  description:
    "Find ConnectWise catalog items (same filters as cw_search_catalog) and compute a proposed sell price from each " +
    "item's catalog cost using a margin % (sell = cost / (1 - margin)) or a fixed profit amount, an optional list " +
    "price guard against the current catalog price, and an optional price-group discount off the profit. Read only: " +
    "nothing is changed in ConnectWise. Each item returns its proposed price, margin and the steps that produced it.",
  input: z.object({
    keyword: searchText.optional(),
    sku: searchText.optional().describe("Exact catalog identifier or manufacturer part number"),
    vendor: searchText.optional().describe("Partial vendor company name"),
    include_inactive: z.boolean().default(false),
    margin_pct: pct.default(25).describe("Target margin on sell price, in percent (default 25)"),
    profit_amount: z.number().min(0).max(1_000_000).optional().describe("Fixed profit per unit; overrides margin_pct"),
    list_price_guard: z
      .enum(["ignore", "cap", "partial"])
      .default("ignore")
      .describe("Guard against the current catalog price: ignore, cap (never above it, never below cost), or partial"),
    guard_sacrifice_pct: z.number().min(0).max(100).default(50).describe("For partial: max share of profit to give up to meet the catalog price"),
    group_discount_pct: z.number().min(0).max(100).optional().describe("Customer price-group discount, as percent off the profit"),
    limit: limit(25, 200),
  }),
  write: false,
  async handler(i) {
    const r = await listCatalog(i);
    const guard: ListPriceGuard =
      i.list_price_guard === "partial" ? { mode: "partial", sacrificePct: i.guard_sacrifice_pct } : { mode: i.list_price_guard };
    const rules = [{ category: [], marginPct: i.profit_amount === undefined ? i.margin_pct : undefined, profitAmount: i.profit_amount }];
    const items = r.items.map((c) => {
      const item = mapCatalogItem(c);
      if (typeof c.cost !== "number") return { ...item, pricing: { error: "no cost on catalog item" } };
      const p = priceItem({ cost: c.cost, listPrice: typeof c.price === "number" ? c.price : undefined, rules, guard, groupDiscountPct: i.group_discount_pct });
      return { ...item, pricing: { sellPrice: p.sellPrice, profit: p.profit, marginPct: p.marginPct, steps: p.steps } };
    });
    return { count: items.length, truncated: r.truncated, items };
  },
});
