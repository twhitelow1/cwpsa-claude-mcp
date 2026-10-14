import { z } from "zod";

/**
 * Environment configuration. Read lazily so `next build` works without
 * secrets present, and so tests can swap process.env between cases.
 * Never log the returned object.
 */
const cwSchema = z.object({
  CW_HOST: z
    .string()
    .min(1)
    .regex(/^[a-z0-9.-]+$/i, "CW_HOST must be a bare hostname (no scheme or path)"),
  CW_API_PATH: z.string().min(1).default("v4_6_release/apis/3.0"),
  CW_COMPANY_ID: z.string().min(1),
  CW_PUBLIC_KEY: z.string().min(1),
  CW_PRIVATE_KEY: z.string().min(1),
  CW_CLIENT_ID: z.string().min(1),
});

export type Env = Record<string, string | undefined>;

export type CwConfig = {
  baseUrl: string;
  authHeader: string;
  clientId: string;
};

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

export function getCwConfig(env: Env = process.env): CwConfig {
  const parsed = cwSchema.safeParse(env);
  if (!parsed.success) {
    // Only report which variable names are missing/invalid — never values.
    const names = [...new Set(parsed.error.issues.map((i) => String(i.path[0])))];
    throw new ConfigError(`ConnectWise is not configured (check: ${names.join(", ")})`);
  }
  const c = parsed.data;
  const path = c.CW_API_PATH.replace(/^\/+|\/+$/g, "");
  const basic = Buffer.from(`${c.CW_COMPANY_ID}+${c.CW_PUBLIC_KEY}:${c.CW_PRIVATE_KEY}`).toString("base64");
  return {
    baseUrl: `https://${c.CW_HOST}/${path}`,
    authHeader: `Basic ${basic}`,
    clientId: c.CW_CLIENT_ID,
  };
}

export function getBridgeToken(env: Env = process.env): string {
  const t = env.BRIDGE_API_TOKEN ?? "";
  if (t.length < 32) {
    throw new ConfigError("BRIDGE_API_TOKEN is missing or shorter than 32 characters");
  }
  return t;
}

export function writesEnabled(env: Env = process.env): boolean {
  return env.WRITES_ENABLED === "true";
}

export function allowedOrigins(env: Env = process.env): string[] {
  return (env.ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((s) => s.trim().replace(/\/+$/, ""))
    .filter(Boolean);
}

export function rateLimitPerMinute(env: Env = process.env): number {
  const n = Number(env.RATE_LIMIT_PER_MINUTE ?? "120");
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 120;
}

export function miscCatalogItemId(env: Env = process.env): number | undefined {
  const n = Number(env.CW_MISC_CATALOG_ITEM_ID);
  return Number.isInteger(n) && n > 0 ? n : undefined;
}
