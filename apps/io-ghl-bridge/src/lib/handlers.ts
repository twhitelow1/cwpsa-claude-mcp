import { z } from "zod";
import { ConfigError, getConfig, type Env } from "./config";
import { GhlClient } from "./ghl/client";
import { UpstreamError, log, secretMatches } from "./http";
import { IoClient } from "./io/client";
import { getStore } from "./store";
import { keys, syncGhlAppointment, syncGhlContact, syncIoLead, syncIoLeadById, type Deps, type SyncResult } from "./sync/engine";

export function makeDeps(env: Env = process.env): Deps {
  const cfg = getConfig(env);
  return { cfg, io: new IoClient(cfg.io), ghl: new GhlClient(cfg.ghl), store: getStore(env) };
}

const json = (body: unknown, status = 200) => Response.json(body, { status });

class Rejected extends Error {}
function reject(): never {
  throw new Rejected();
}

/**
 * Upstream failures return 502 so the sender retries (IO retries after 1 h, 8 h and 24 h).
 * Messages are already scrubbed of keys and personal data.
 */
async function run(route: string, fn: () => Promise<SyncResult | Record<string, unknown>>): Promise<Response> {
  try {
    return json(await fn());
  } catch (e) {
    if (e instanceof Rejected) {
      log({ route, error: "unauthorized" });
      return json({ error: "Unauthorized" }, 401);
    }
    if (e instanceof ConfigError) {
      log({ route, error: e.message });
      return json({ error: "Bridge is not configured" }, 500);
    }
    const msg = e instanceof UpstreamError ? e.message : "Internal error";
    log({ route, error: msg });
    return json({ error: msg }, 502);
  }
}

function presentedKey(req: Request): string | null {
  return req.headers.get("x-bridge-key") ?? new URL(req.url).searchParams.get("key");
}

const leadId = z.string().regex(/^\d{1,12}$/);
const ghlId = z.string().regex(/^[A-Za-z0-9]{6,64}$/);

/**
 * Inflatable Office automation "Send Data" webhook.
 * The body is form-encoded report columns and always includes ID (the lead id).
 * IO cannot set headers, so the secret travels as ?key=.
 */
export async function handleIoWebhook(req: Request, deps: () => Deps = makeDeps): Promise<Response> {
  return run("webhook/io", async () => {
    const d = deps();
    if (!secretMatches(presentedKey(req), d.cfg.secrets.io)) return reject();
    const raw = await req.text();
    const ct = req.headers.get("content-type") ?? "";
    const fields: Record<string, unknown> = ct.includes("json") ? safeJson(raw) : Object.fromEntries(new URLSearchParams(raw));
    const id = leadId.safeParse(String(fields.ID ?? fields.id ?? ""));
    if (!id.success) return { outcome: "skipped", reason: "no_lead_id" };
    return syncIoLeadById(d, id.data);
  });
}

/**
 * GoHighLevel workflow webhook ("Webhook" or "Custom Webhook" action).
 * Appointment triggers send calendar.appointmentId, and contact triggers send contact_id.
 * Custom Webhook bodies may use appointment_id / contact_id directly.
 * Records are always re-read from the API, so the payload only has to carry ids.
 */
export async function handleGhlWebhook(req: Request, deps: () => Deps = makeDeps): Promise<Response> {
  return run("webhook/ghl", async () => {
    const d = deps();
    if (!secretMatches(presentedKey(req), d.cfg.secrets.ghl)) return reject();
    const body = safeJson(await req.text());
    const cal = (body.calendar ?? {}) as Record<string, unknown>;
    const appt = (body.appointment ?? {}) as Record<string, unknown>;
    const apptId = ghlId.safeParse(cal.appointmentId ?? body.appointment_id ?? body.appointmentId ?? appt.id);
    if (apptId.success) return syncGhlAppointment(d, apptId.data);
    const contactId = ghlId.safeParse(body.contact_id ?? body.contactId ?? (body.contact as Record<string, unknown> | undefined)?.id);
    if (contactId.success) return syncGhlContact(d, contactId.data);
    return { outcome: "skipped", reason: "no_supported_id" };
  });
}

/**
 * Vercel cron safety net: re-syncs leads modified in the last day, in case a webhook was missed.
 * Uses one IO transaction per 25 leads and skips any lead whose modified time it has already synced.
 */
export async function handleCron(req: Request, deps: () => Deps = makeDeps): Promise<Response> {
  return run("cron/poll-io", async () => {
    const d = deps();
    const auth = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? null;
    if (!secretMatches(auth, d.cfg.secrets.cron)) return reject();
    const { leads, truncated } = await d.io.listModifiedLeads("past_days_1");
    const counts: Record<string, number> = {};
    for (const lead of leads) {
      const id = String(lead.id);
      if (lead.modifiedtime_ts && (await d.store.get(keys.seenLead(id))) === String(lead.modifiedtime_ts)) {
        counts.seen = (counts.seen ?? 0) + 1;
        continue;
      }
      const r = await syncIoLead(d, lead);
      counts[r.outcome] = (counts[r.outcome] ?? 0) + 1;
    }
    log({ route: "cron/poll-io", leads: leads.length, truncated, ...counts });
    return { leads: leads.length, truncated, ...counts };
  });
}

function safeJson(raw: string): Record<string, unknown> {
  try {
    const v = JSON.parse(raw);
    return v && typeof v === "object" ? v : {};
  } catch {
    return {};
  }
}

