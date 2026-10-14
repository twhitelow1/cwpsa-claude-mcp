/**
 * Distributor sourcing (design only — NOT wired into any tool or route in v1).
 * See docs/distributors.md.
 */
export type DistributorProduct = {
  distributor: string;
  sku: string; // distributor SKU
  mfrPartNumber?: string;
  manufacturer?: string;
  description: string;
  upc?: string;
};

export type DistributorPrice = {
  sku: string;
  currency: string;
  unitCost: number; // reseller cost
  msrp?: number;
  promo?: { unitCost: number; endsAt?: string };
  asOf: string; // ISO timestamp
};

export type DistributorStock = {
  sku: string;
  totalAvailable: number;
  warehouses: { id: string; name?: string; available: number; eta?: string }[];
  asOf: string;
};

export interface DistributorAdapter {
  readonly id: string;
  readonly name: string;
  /** Keyword / MPN / UPC search. */
  search(query: string, opts?: { limit?: number }): Promise<DistributorProduct[]>;
  getPrice(sku: string): Promise<DistributorPrice>;
  getStock(sku: string): Promise<DistributorStock>;
}

export class NotImplementedAdapterError extends Error {
  constructor(adapter: string, method: string) {
    super(`${adapter}.${method} is not implemented yet (distributor adapters are stubs in v1)`);
    this.name = "NotImplementedAdapterError";
  }
}
