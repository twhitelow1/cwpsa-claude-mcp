import type { Config } from "../config";
import type { GhlClient, GhlContact } from "../ghl/client";
import { UpstreamError, log } from "../http";
import type { IoClient, IoCustomer, IoLead, IoStatus } from "../io/client";
import {
  bookingFromGhl,
  bookingFromIo,
  ghlAppointmentStatus,
  mergePerson,
  personFromGhl,
  personFromIo,
  personToGhl,
  personToIo,
  sameBooking,
  samePerson,
  type Booking,
  type Person,
} from "../normalize";
import { getJson, setJson, type Store } from "../store";

export type Deps = { cfg: Config; io: IoClient; ghl: GhlClient; store: Store };

export type Outcome = "created" | "updated" | "unchanged" | "skipped" | "busy";
export type SyncResult = { outcome: Outcome; reason?: string; person?: Outcome; booking?: Outcome };

type BookingLink = { appointmentId?: string; opportunityId?: string };

export const keys = {
  personByIo: (id: string) => `link:person:io:${id}`,
  personByGhl: (id: string) => `link:person:ghl:${id}`,
  personSnap: (ioCustomerId: string) => `snap:person:${ioCustomerId}`,
  bookingByIo: (leadId: string) => `link:booking:io:${leadId}`,
  bookingByGhl: (appointmentId: string) => `link:booking:ghl:${appointmentId}`,
  bookingSnap: (leadId: string) => `snap:booking:${leadId}`,
  seenLead: (leadId: string) => `seen:io-lead:${leadId}`,
  statuses: "cache:io:statuses",
};

const LOCK_TTL_SEC = 60;
const STATUS_CACHE_SEC = 24 * 3600;

/** Serialises work on one record so a burst of webhooks cannot create duplicates. */
async function withLock(store: Store, name: string, fn: () => Promise<SyncResult>): Promise<SyncResult> {
  const key = `lock:${name}`;
  if (!(await store.setNx(key, "1", LOCK_TTL_SEC))) return { outcome: "busy" };
  try {
    return await fn();
  } finally {
    await store.del(key);
  }
}

async function ioStatuses(d: Deps): Promise<IoStatus[]> {
  const cached = await getJson<IoStatus[]>(d.store, keys.statuses);
  if (cached) return cached;
  const list = await d.io.listStatuses();
  await setJson(d.store, keys.statuses, list, STATUS_CACHE_SEC);
  return list;
}

const iso = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");
const isNotFound = (e: unknown) => e instanceof UpstreamError && e.status === 404;

// ───────────────────────────── Inflatable Office → GHL ─────────────────────────────

export async function syncIoLeadById(d: Deps, leadId: string): Promise<SyncResult> {
  const lead = await d.io.getLead(leadId);
  if (!lead) return { outcome: "skipped", reason: "lead_not_found" };
  return syncIoLead(d, lead);
}

export async function syncIoLead(d: Deps, lead: IoLead): Promise<SyncResult> {
  const leadId = String(lead.id);
  return withLock(d.store, `io-lead:${leadId}`, async () => {
    let cust: IoCustomer | null = lead.cust && typeof lead.cust === "object" && (lead.cust as IoCustomer).id ? (lead.cust as IoCustomer) : null;
    const customerId = String(lead.contactid ?? cust?.id ?? "");
    if (!cust && /^\d+$/.test(customerId)) cust = await d.io.getCustomer(customerId);
    if (!cust) return { outcome: "skipped", reason: "lead_has_no_customer" };

    const p = await pushPersonToGhl(d, cust);
    const needsStatuses = !(lead.status && typeof lead.status === "object");
    const booking = bookingFromIo(lead, needsStatuses ? await ioStatuses(d) : []);
    const b = booking ? await pushBookingToGhl(d, leadId, booking, p.contactId) : "skipped";

    if (lead.modifiedtime_ts) await d.store.set(keys.seenLead(leadId), String(lead.modifiedtime_ts), 30 * 24 * 3600);
    log({ dir: "io->ghl", leadId, ioCustomerId: String(cust.id), ghlContactId: p.contactId, person: p.outcome, booking: b });
    return { outcome: p.outcome === "unchanged" && (b === "unchanged" || b === "skipped") ? "unchanged" : "updated", person: p.outcome, booking: b };
  });
}

async function pushPersonToGhl(d: Deps, cust: IoCustomer): Promise<{ contactId: string; outcome: Outcome }> {
  const ioId = String(cust.id);
  const prev = await getJson<Person>(d.store, keys.personSnap(ioId));
  const person = mergePerson(prev, personFromIo(cust));
  let contactId = await d.store.get(keys.personByIo(ioId));
  if (contactId && samePerson(prev, person)) return { contactId, outcome: "unchanged" };

  let outcome: Outcome = "updated";
  if (contactId && !(await d.ghl.updateContact(contactId, personToGhl(person)))) contactId = null;
  if (!contactId) {
    const r = await d.ghl.upsertContact({ ...personToGhl(person), source: "Inflatable Office" });
    contactId = r.id;
    outcome = r.isNew ? "created" : "updated";
    await d.ghl.addTags(contactId, [d.cfg.ghl.syncTag]);
  }
  await linkPerson(d, ioId, contactId, person);
  return { contactId, outcome };
}

async function pushBookingToGhl(d: Deps, leadId: string, booking: Booking, contactId: string): Promise<Outcome> {
  const prev = await getJson<Booking>(d.store, keys.bookingSnap(leadId));
  const link = (await getJson<BookingLink>(d.store, keys.bookingByIo(leadId))) ?? {};
  if (link.appointmentId && sameBooking(prev, booking)) return "unchanged";

  const appt = {
    calendarId: d.cfg.ghl.calendarId,
    contactId,
    title: booking.title,
    startTime: iso(booking.startMs),
    endTime: iso(booking.endMs),
    appointmentStatus: ghlAppointmentStatus[booking.status],
    address: booking.address || undefined,
    ignoreDateRange: true,
    ignoreFreeSlotValidation: true,
    toNotify: d.cfg.ghl.notify,
  };
  let outcome: Outcome = "updated";
  if (link.appointmentId && !(await d.ghl.updateAppointment(link.appointmentId, appt))) link.appointmentId = undefined;
  if (!link.appointmentId) {
    link.appointmentId = await d.ghl.createAppointment(appt);
    outcome = "created";
  }

  const pipeline = d.cfg.ghl.pipeline;
  if (pipeline) {
    const opp = {
      pipelineId: pipeline.id,
      pipelineStageId: pipeline.stageMap[booking.ioStatusName] ?? pipeline.defaultStageId,
      name: `${booking.title} (${iso(booking.startMs).slice(0, 10)})`,
      status: booking.status === "cancelled" ? "lost" : "open",
      monetaryValue: booking.total,
      contactId,
    };
    if (link.opportunityId && !(await d.ghl.updateOpportunity(link.opportunityId, opp))) link.opportunityId = undefined;
    if (!link.opportunityId) link.opportunityId = await d.ghl.createOpportunity(opp);
  }

  await setJson(d.store, keys.bookingByIo(leadId), link);
  await d.store.set(keys.bookingByGhl(link.appointmentId), leadId);
  await setJson(d.store, keys.bookingSnap(leadId), booking);
  return outcome;
}

// ───────────────────────────── GHL → Inflatable Office ─────────────────────────────

export async function syncGhlContact(d: Deps, contactId: string): Promise<SyncResult> {
  return withLock(d.store, `ghl-contact:${contactId}`, async () => {
    const contact = await d.ghl.getContact(contactId);
    if (!contact) return { outcome: "skipped", reason: "contact_not_found" };
    const r = await pullPersonToIo(d, contact);
    log({ dir: "ghl->io", ghlContactId: contactId, ioCustomerId: r.ioCustomerId, person: r.outcome });
    return { outcome: r.outcome, person: r.outcome };
  });
}

async function pullPersonToIo(d: Deps, contact: GhlContact): Promise<{ ioCustomerId: string; person: Person; outcome: Outcome }> {
  const ghlId = String(contact.id);
  let ioId = await d.store.get(keys.personByGhl(ghlId));
  const prev = ioId ? await getJson<Person>(d.store, keys.personSnap(ioId)) : null;
  const person = mergePerson(prev, personFromGhl(contact));
  if (ioId && samePerson(prev, person)) return { ioCustomerId: ioId, person, outcome: "unchanged" };

  let outcome: Outcome = "updated";
  if (ioId) {
    try {
      await d.io.saveCustomer(personToIo(person), ioId);
    } catch (e) {
      if (!isNotFound(e)) throw e;
      ioId = null;
    }
  }
  if (!ioId) {
    ioId = await d.io.saveCustomer(personToIo(person));
    outcome = "created";
  }
  await linkPerson(d, ioId, ghlId, person);
  return { ioCustomerId: ioId, person, outcome };
}

export async function syncGhlAppointment(d: Deps, appointmentId: string): Promise<SyncResult> {
  return withLock(d.store, `ghl-appt:${appointmentId}`, async () => {
    const appt = await d.ghl.getAppointment(appointmentId);
    if (!appt) return { outcome: "skipped", reason: "appointment_not_found" };
    if (appt.calendarId && appt.calendarId !== d.cfg.ghl.calendarId) return { outcome: "skipped", reason: "other_calendar" };

    let leadId = await d.store.get(keys.bookingByGhl(appointmentId));
    const prev = leadId ? await getJson<Booking>(d.store, keys.bookingSnap(leadId)) : null;
    const booking = bookingFromGhl(appt, prev);
    if (!booking) return { outcome: "skipped", reason: "appointment_has_no_time" };
    if (leadId && sameBooking(prev, booking)) return { outcome: "unchanged", booking: "unchanged" };

    const contactId = typeof appt.contactId === "string" ? appt.contactId : "";
    const contact = contactId ? await d.ghl.getContact(contactId) : null;
    if (!contact) return { outcome: "skipped", reason: "appointment_has_no_contact" };
    const p = await pullPersonToIo(d, contact);

    const fields: Record<string, unknown> = {
      customerid: p.ioCustomerId,
      eventname: booking.title,
      eventstarttime: Math.round(booking.startMs / 1000),
      eventendtime: Math.round(booking.endMs / 1000),
    };
    // Only send a status the account is known to have; an unknown name resets the lead to the default quote status.
    const statusName = booking.status === "confirmed" ? d.cfg.io.confirmedStatus : booking.status === "cancelled" ? d.cfg.io.cancelStatus : undefined;
    if (statusName) {
      fields.status = statusName;
      booking.ioStatusName = statusName;
    } else {
      booking.status = prev?.status ?? "booked";
    }

    let outcome: Outcome = "updated";
    if (leadId) {
      try {
        await d.io.saveLead(fields, leadId);
      } catch (e) {
        if (!isNotFound(e)) throw e;
        leadId = null;
      }
    }
    if (!leadId) {
      leadId = await d.io.saveLead({ ...fields, eventzip: p.person.zip || d.cfg.io.defaultZip });
      outcome = "created";
    }

    const link = (await getJson<BookingLink>(d.store, keys.bookingByIo(leadId))) ?? {};
    link.appointmentId = appointmentId;
    await setJson(d.store, keys.bookingByIo(leadId), link);
    await d.store.set(keys.bookingByGhl(appointmentId), leadId);
    await setJson(d.store, keys.bookingSnap(leadId), booking);
    log({ dir: "ghl->io", ghlAppointmentId: appointmentId, leadId, ioCustomerId: p.ioCustomerId, person: p.outcome, booking: outcome });
    return { outcome, person: p.outcome, booking: outcome };
  });
}

async function linkPerson(d: Deps, ioCustomerId: string, ghlContactId: string, person: Person) {
  await d.store.set(keys.personByIo(ioCustomerId), ghlContactId);
  await d.store.set(keys.personByGhl(ghlContactId), ioCustomerId);
  await setJson(d.store, keys.personSnap(ioCustomerId), person);
}
