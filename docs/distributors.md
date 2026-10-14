# Distributor sourcing — design (not built in v1)

Goal: let Claude answer "where can I get 10× this SKU cheapest and fastest?" and then feed the chosen
item into `cw_create_opportunity` / `cw_create_sales_order` as a catalog or custom line.

## Interface

`src/lib/distributors/types.ts`

```ts
interface DistributorAdapter {
  id: string; name: string;
  search(query: string, opts?: { limit?: number }): Promise<DistributorProduct[]>;
  getPrice(sku: string): Promise<DistributorPrice>;   // reseller cost, MSRP, promo
  getStock(sku: string): Promise<DistributorStock>;   // per-warehouse availability + ETA
}
```

Stubs (throw `NotImplementedAdapterError`) live in `src/lib/distributors/stubs.ts` for Ingram Micro,
TD SYNNEX, D&H and Pax8. **Placeholder list — to be replaced by the distributors DubLow actually uses.**

## Planned tools (after v1 is stable)

| Tool | Behaviour |
|---|---|
| `dist_search` | Fan out `search()` to enabled adapters (concurrency-capped), merge by MPN/UPC. |
| `dist_quote` | For one MPN: `getPrice` + `getStock` across adapters, sorted by landed cost then ETA. |
| `dist_to_cw_line` | Pure transform: chosen offer → `line_item` for the CW write tools (vendor = distributor company id in CW, `unit_cost` = distributor cost, `sku` = distributor SKU). Still goes through the normal dry-run/confirm flow. |

## Rules carried over from the bridge

- Read-only against distributors. Ordering (PO submission) is out of scope until explicitly approved.
- Credentials per distributor as env vars (`DIST_<ID>_*`), never logged; added to `.env.example` by name only.
- Responses trimmed to the fields above; prices returned with `asOf` because they go stale.
- Each adapter gets mocked unit tests (auth header shape, pagination, error sanitisation) before going live.
- Map each distributor to its ConnectWise vendor company id via config so lines carry the right `vendor`.

## Open questions for Todd

1. Which distributors (and which have API access enabled on your account)?
2. Should quotes prefer cost, stock, or a preferred-vendor order?
3. Do you want catalog items auto-created in CW for new SKUs, or always use custom lines?
