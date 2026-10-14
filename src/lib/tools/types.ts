import type { z } from "zod";

export type ToolDef<S extends z.ZodObject = z.ZodObject> = {
  name: string;
  title: string;
  description: string;
  input: S;
  write: boolean;
  handler: (input: z.infer<S>) => Promise<unknown>;
  /** Ids worth recording in the audit log (never free text). */
  auditIds?: (input: z.infer<S>) => Record<string, number | string | undefined>;
};

export function defineTool<S extends z.ZodObject>(t: ToolDef<S>): ToolDef<S> {
  return t;
}

/** One HTTP call a write tool will make. Values like "$ref:0.id" are filled from earlier results. */
export type PlannedRequest = {
  method: "POST" | "PATCH";
  path: string;
  body: unknown;
  purpose: string;
};

export type WritePlan = { summary: string; requests: PlannedRequest[] };
