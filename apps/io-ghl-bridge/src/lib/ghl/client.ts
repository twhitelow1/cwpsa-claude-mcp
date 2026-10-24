import type { Config } from "../config";
import { UpstreamError, fetchWithRetry, realSleep, type Sleep } from "../http";

/**
 * GoHighLevel API v2 client for one sub-account, using a Private Integration token
 * (Settings → Private Integrations in the sub-account).
 * Contacts and opportunities use GHL_CONTACTS_VERSION. Calendar events use GHL_CALENDARS_VERSION.
 */
export type GhlContact = Record<string, unknown> & { id: string };
export type GhlAppointment = Record<string, unknown> & { id: string };

type Opts = { fetchImpl?: typeof fetch; sleep?: Sleep };

export class GhlClient {
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: Sleep;

  constructor(
    private readonly cfg: Config["ghl"],
    opts: Opts = {},
  ) {
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.sleep = opts.sleep ?? realSleep;
  }

  private async call<T>(method: "GET" | "POST" | "PUT", path: string, version: string, body?: unknown): Promise<{ status: number; data: T }> {
    if (!/^\/[a-z0-9_/-]+$/i.test(path)) throw new UpstreamError("ghl", 500, "Invalid GoHighLevel path");
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.cfg.token}`,
      Version: version,
      Accept: "application/json",
    };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    const res = await fetchWithRetry(
      this.cfg.baseUrl + path,
      { method, headers, body: body === undefined ? undefined : JSON.stringify(body) },
      { fetchImpl: this.fetchImpl, sleep: this.sleep, maxRetries: 3, baseDelayMs: 500, maxWaitMs: 10_000 },
    );
    const data = (await res.json().catch(() => ({}))) as T & { message?: unknown };
    if (res.ok || res.status === 404) return { status: res.status, data };
    // Never echo 401/403/5xx bodies; they can contain account details.
    const detail = res.status === 400 || res.status === 422 ? ` ${String(data?.message ?? "").slice(0, 160)}` : "";
    throw new UpstreamError("ghl", res.status, `GoHighLevel ${method} ${path.replace(/\/[A-Za-z0-9]{12,}/g, "/:id")} failed: ${res.status}${detail}`);
  }

  async getContact(id: string): Promise<GhlContact | null> {
    const r = await this.call<{ contact?: GhlContact }>("GET", `/contacts/${id}`, this.cfg.contactsVersion);
    return r.status === 404 ? null : (r.data.contact ?? null);
  }

  /** Create or match (per the location's duplicate rules) a contact. */
  async upsertContact(fields: Record<string, unknown>): Promise<{ id: string; isNew: boolean }> {
    const r = await this.call<{ new?: boolean; contact?: { id?: string } }>("POST", "/contacts/upsert", this.cfg.contactsVersion, {
      ...fields,
      locationId: this.cfg.locationId,
    });
    const id = r.data.contact?.id;
    if (!id) throw new UpstreamError("ghl", 502, "GoHighLevel upsert returned no contact id");
    return { id, isNew: r.data.new === true };
  }

  async updateContact(id: string, fields: Record<string, unknown>): Promise<boolean> {
    const r = await this.call("PUT", `/contacts/${id}`, this.cfg.contactsVersion, fields);
    return r.status !== 404;
  }

  async addTags(id: string, tags: string[]): Promise<void> {
    await this.call("POST", `/contacts/${id}/tags`, this.cfg.contactsVersion, { tags });
  }

  async getAppointment(id: string): Promise<GhlAppointment | null> {
    const r = await this.call<{ appointment?: GhlAppointment; event?: GhlAppointment } & Partial<GhlAppointment>>(
      "GET",
      `/calendars/events/appointments/${id}`,
      this.cfg.calendarsVersion,
    );
    if (r.status === 404) return null;
    const appt = r.data.appointment ?? r.data.event ?? (r.data.id ? (r.data as GhlAppointment) : null);
    return appt;
  }

  async createAppointment(fields: Record<string, unknown>): Promise<string> {
    const r = await this.call<{ id?: string }>("POST", "/calendars/events/appointments", this.cfg.calendarsVersion, {
      ...fields,
      calendarId: this.cfg.calendarId,
      locationId: this.cfg.locationId,
    });
    if (!r.data.id) throw new UpstreamError("ghl", 502, "GoHighLevel did not return an appointment id");
    return r.data.id;
  }

  /** Returns false if the appointment no longer exists. */
  async updateAppointment(id: string, fields: Record<string, unknown>): Promise<boolean> {
    const r = await this.call("PUT", `/calendars/events/appointments/${id}`, this.cfg.calendarsVersion, fields);
    return r.status !== 404;
  }

  async createOpportunity(fields: Record<string, unknown>): Promise<string> {
    const r = await this.call<{ opportunity?: { id?: string } }>("POST", "/opportunities/", this.cfg.contactsVersion, {
      ...fields,
      locationId: this.cfg.locationId,
    });
    const id = r.data.opportunity?.id;
    if (!id) throw new UpstreamError("ghl", 502, "GoHighLevel did not return an opportunity id");
    return id;
  }

  async updateOpportunity(id: string, fields: Record<string, unknown>): Promise<boolean> {
    const r = await this.call("PUT", `/opportunities/${id}`, this.cfg.contactsVersion, fields);
    return r.status !== 404;
  }
}
