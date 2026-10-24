import { z } from "zod";

/**
 * Environment configuration. Read lazily so `next build` works without
 * secrets present, and so tests can pass their own env. Never log the result.
 */
export type Env = Record<string, string | undefined>;

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

const secret = z.string().min(32, "must be at least 32 characters");
const optional = z
  .string()
  .optional()
  .transform((v) => (v && v.trim() ? v.trim() : undefined));

const schema = z.object({
  // Inflatable Office / rental.software API6
  IO_API_KEY: z.string().min(8),
  IO_BASE_URL: z.string().url().default("https://rental.software/api6"),
  IO_DEFAULT_ZIP: z.string().min(3),
  IO_CONFIRMED_STATUS: optional,
  IO_CANCEL_STATUS: optional,

  // GoHighLevel sub-account (Lead Alchemist), private integration token
  GHL_TOKEN: z.string().min(8),
  GHL_LOCATION_ID: z.string().min(4),
  GHL_CALENDAR_ID: z.string().min(4),
  GHL_BASE_URL: z.string().url().default("https://services.leadconnectorhq.com"),
  GHL_CONTACTS_VERSION: z.string().default("2021-07-28"),
  GHL_CALENDARS_VERSION: z.string().default("2021-04-15"),
  GHL_SYNC_TAG: z.string().default("inflatable-office"),
  GHL_NOTIFY: z.enum(["true", "false"]).default("false"),
  GHL_PIPELINE_ID: optional,
  GHL_DEFAULT_STAGE_ID: optional,
  GHL_STAGE_MAP: optional,

  // Inbound auth
  IO_WEBHOOK_SECRET: secret,
  GHL_WEBHOOK_SECRET: secret,
  CRON_SECRET: z.string().min(16),
});

export type Config = {
  io: {
    apiKey: string;
    baseUrl: string;
    defaultZip: string;
    confirmedStatus?: string;
    cancelStatus?: string;
  };
  ghl: {
    token: string;
    locationId: string;
    calendarId: string;
    baseUrl: string;
    contactsVersion: string;
    calendarsVersion: string;
    syncTag: string;
    notify: boolean;
    pipeline?: { id: string; defaultStageId: string; stageMap: Record<string, string> };
  };
  secrets: { io: string; ghl: string; cron: string };
};

export function getConfig(env: Env = process.env): Config {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    // Only report which variable names are missing/invalid — never values.
    const names = [...new Set(parsed.error.issues.map((i) => String(i.path[0])))];
    throw new ConfigError(`Bridge is not configured (check: ${names.join(", ")})`);
  }
  const c = parsed.data;

  let pipeline: Config["ghl"]["pipeline"];
  if (c.GHL_PIPELINE_ID) {
    if (!c.GHL_DEFAULT_STAGE_ID) throw new ConfigError("GHL_DEFAULT_STAGE_ID is required when GHL_PIPELINE_ID is set");
    let stageMap: Record<string, string> = {};
    if (c.GHL_STAGE_MAP) {
      const m = z.record(z.string(), z.string()).safeParse(safeJson(c.GHL_STAGE_MAP));
      if (!m.success) throw new ConfigError('GHL_STAGE_MAP must be JSON like {"Quote":"<stageId>"}');
      stageMap = m.data;
    }
    pipeline = { id: c.GHL_PIPELINE_ID, defaultStageId: c.GHL_DEFAULT_STAGE_ID, stageMap };
  }

  return {
    io: {
      apiKey: c.IO_API_KEY.trim(),
      baseUrl: c.IO_BASE_URL.replace(/\/+$/, ""),
      defaultZip: c.IO_DEFAULT_ZIP,
      confirmedStatus: c.IO_CONFIRMED_STATUS,
      cancelStatus: c.IO_CANCEL_STATUS,
    },
    ghl: {
      token: c.GHL_TOKEN.trim(),
      locationId: c.GHL_LOCATION_ID,
      calendarId: c.GHL_CALENDAR_ID,
      baseUrl: c.GHL_BASE_URL.replace(/\/+$/, ""),
      contactsVersion: c.GHL_CONTACTS_VERSION,
      calendarsVersion: c.GHL_CALENDARS_VERSION,
      syncTag: c.GHL_SYNC_TAG,
      notify: c.GHL_NOTIFY === "true",
      pipeline,
    },
    secrets: { io: c.IO_WEBHOOK_SECRET, ghl: c.GHL_WEBHOOK_SECRET, cron: c.CRON_SECRET },
  };
}

function safeJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return undefined;
  }
}
