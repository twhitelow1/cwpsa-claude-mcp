import { z } from "zod";

export const id = z.number().int().positive();
export const limit = (def: number, max = 1000) =>
  z.number().int().min(1).max(max).default(def).describe(`Max rows to return (default ${def}, max ${max})`);

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

export const dateInput = z
  .string()
  .refine((s) => !Number.isNaN(Date.parse(s)), "must be an ISO date (YYYY-MM-DD) or datetime")
  .describe("ISO date (YYYY-MM-DD, interpreted as UTC) or full ISO datetime");

/** Start of range: date-only → midnight UTC. */
export function rangeStart(s: string): Date {
  return new Date(DATE_ONLY.test(s) ? `${s}T00:00:00Z` : s);
}

/** End of range: date-only is inclusive → next midnight UTC (use with `<`). */
export function rangeEnd(s: string): Date {
  if (DATE_ONLY.test(s)) {
    const d = new Date(`${s}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + 1);
    return d;
  }
  return new Date(s);
}

export const memberIdentifier = z
  .string()
  .min(1)
  .max(30)
  .regex(/^[A-Za-z0-9._@-]+$/, "member identifier contains invalid characters")
  .describe("ConnectWise member identifier (login name), e.g. 'tlow'. Use cw_list_members to look it up.");

export const searchText = z.string().trim().min(1).max(100);
