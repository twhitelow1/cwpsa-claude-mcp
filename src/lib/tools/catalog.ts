import { z } from "zod";
import { cw } from "../cw/client";
import { and, cond, or } from "../cw/conditions";
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
    const conditions = and(
      !i.include_inactive && cond.eq("inactiveFlag", false),
      i.keyword && or(cond.contains("identifier", i.keyword), cond.contains("description", i.keyword)),
      i.sku && or(cond.eq("identifier", i.sku), cond.eq("manufacturerPartNumber", i.sku)),
      i.vendor && cond.contains("vendor/name", i.vendor),
    );
    const r = await cw().list<Raw>("/procurement/catalog", { conditions, orderBy: "identifier asc" }, i.limit);
    return { count: r.items.length, truncated: r.truncated, items: r.items.map(mapCatalogItem) };
  },
});
