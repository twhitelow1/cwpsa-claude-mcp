import { NotImplementedAdapterError, type DistributorAdapter } from "./types";

function stub(id: string, name: string): DistributorAdapter {
  return {
    id,
    name,
    async search() {
      throw new NotImplementedAdapterError(id, "search");
    },
    async getPrice() {
      throw new NotImplementedAdapterError(id, "getPrice");
    },
    async getStock() {
      throw new NotImplementedAdapterError(id, "getStock");
    },
  };
}

// Placeholder list until Todd confirms which distributors DubLow uses.
export const ingramMicro = stub("ingram", "Ingram Micro");
export const tdSynnex = stub("tdsynnex", "TD SYNNEX");
export const dandh = stub("dandh", "D&H Distributing");
export const pax8 = stub("pax8", "Pax8");

export const distributorAdapters: DistributorAdapter[] = [ingramMicro, tdSynnex, dandh, pax8];
