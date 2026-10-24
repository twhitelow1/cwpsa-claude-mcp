import type { IoCustomer, IoLead, IoStatus } from "./io/client";
import { truthy } from "./io/client";
import type { GhlAppointment, GhlContact } from "./ghl/client";

/**
 * System-neutral shapes. Each side is converted to these before comparing with the
 * last-synced snapshot, so a webhook echoing our own write compares equal and is skipped.
 * That is the loop guard.
 */
export type Person = {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  street: string;
  city: string;
  state: string;
  zip: string;
  company: string;
};

export type BookingStatus = "booked" | "confirmed" | "cancelled";

export type Booking = {
  title: string;
  startMs: number;
  endMs: number;
  status: BookingStatus;
  /** Owned by Inflatable Office: GHL edits to these are not written back. */
  address: string;
  ioStatusName: string;
  total: number;
};

const s = (v: unknown) => (typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : "");

/** Digits only, US numbers reduced to 10 digits so "+1 (330) 555-0144" equals "3305550144". */
export function normPhone(v: unknown): string {
  const d = s(v).replace(/\D/g, "");
  return d.length === 11 && d.startsWith("1") ? d.slice(1) : d;
}

export function toE164(phone: string): string {
  if (!phone) return "";
  return phone.length === 10 ? `+1${phone}` : `+${phone}`;
}

export function personFromIo(c: IoCustomer): Person {
  return {
    firstName: s(c.firstname),
    lastName: s(c.lastname),
    email: s(c.email).toLowerCase(),
    phone: normPhone(c.cellphone) || normPhone(c.homephone) || normPhone(c.officephone),
    street: s(c.street),
    city: s(c.city),
    state: s(c.state),
    zip: s(c.zip),
    company: s(c.organization),
  };
}

export function personFromGhl(c: GhlContact): Person {
  return {
    firstName: s(c.firstName),
    lastName: s(c.lastName),
    email: s(c.email).toLowerCase(),
    phone: normPhone(c.phone),
    street: s(c.address1),
    city: s(c.city),
    state: s(c.state),
    zip: s(c.postalCode),
    company: s(c.companyName),
  };
}

export function personToGhl(p: Person): Record<string, unknown> {
  return {
    firstName: p.firstName || undefined,
    lastName: p.lastName || undefined,
    email: p.email || undefined,
    phone: p.phone ? toE164(p.phone) : undefined,
    address1: p.street || undefined,
    city: p.city || undefined,
    state: p.state || undefined,
    postalCode: p.zip || undefined,
    companyName: p.company || undefined,
  };
}

export function personToIo(p: Person): Record<string, unknown> {
  const out: Record<string, unknown> = {
    firstname: p.firstName,
    lastname: p.lastName,
    email: p.email,
    cellphone: p.phone,
    street: p.street,
    city: p.city,
    state: p.state,
    zip: p.zip,
    organization: p.company,
  };
  for (const k of Object.keys(out)) if (out[k] === "") delete out[k];
  return out;
}

/**
 * Blank incoming fields keep the previous value, so a GHL contact without an
 * address never wipes the address Inflatable Office has (and vice versa).
 */
export function mergePerson(prev: Person | null, incoming: Person): Person {
  if (!prev) return incoming;
  const out = { ...prev };
  for (const k of Object.keys(incoming) as (keyof Person)[]) if (incoming[k]) out[k] = incoming[k];
  return out;
}

/** Lead status flags: from the embedded status record if present, else from the cached status list. */
export function ioStatusOf(lead: IoLead, statuses: IoStatus[]): { name: string; status: BookingStatus } {
  const embedded = lead.status;
  let name = "";
  let cancel = false;
  let confirmed = false;
  if (embedded && typeof embedded === "object") {
    const e = embedded as Record<string, unknown>;
    name = s(e.name);
    cancel = truthy(e.cancel);
    confirmed = truthy(e.confirmed) || truthy(e.complete);
  } else {
    const st = statuses.find((x) => x.id === s(lead.statusid));
    if (st) {
      name = st.name;
      cancel = st.cancel;
      confirmed = st.confirmed || st.complete;
    } else if (typeof embedded === "string") {
      name = embedded.trim();
    }
  }
  return { name, status: cancel ? "cancelled" : confirmed ? "confirmed" : "booked" };
}

function num(v: unknown): number | undefined {
  const n = typeof v === "number" ? v : Number(s(v));
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

export function bookingFromIo(lead: IoLead, statuses: IoStatus[]): Booking | null {
  const startSec = num(lead.eventstarttime_ts);
  if (!startSec) return null;
  const endSec = num(lead.eventendtime_ts) ?? num(lead.fullend_ts) ?? startSec + (num(lead.eventduration) ?? 1) * 3600;
  const { name, status } = ioStatusOf(lead, statuses);
  const address = [s(lead.eventstreet), s(lead.eventcity), [s(lead.eventstate), s(lead.eventzip)].filter(Boolean).join(" ")]
    .filter(Boolean)
    .join(", ");
  return {
    title: s(lead.eventname) || "Rental event",
    startMs: startSec * 1000,
    endMs: endSec * 1000,
    status,
    address,
    ioStatusName: name,
    total: Math.round((num(lead.total) ?? 0) * 100) / 100,
  };
}

export function ghlStatusOf(appointmentStatus: unknown): BookingStatus {
  const v = s(appointmentStatus).toLowerCase();
  if (v === "cancelled" || v === "invalid") return "cancelled";
  if (v === "confirmed" || v === "showed" || v === "completed") return "confirmed";
  return "booked";
}

/**
 * GHL appointment → Booking. IO-owned fields come from the previous snapshot
 * because GHL cannot change them.
 */
export function bookingFromGhl(a: GhlAppointment, prev: Booking | null): Booking | null {
  const startMs = Date.parse(s(a.startTime));
  if (Number.isNaN(startMs)) return null;
  const endParsed = Date.parse(s(a.endTime));
  return {
    title: s(a.title) || prev?.title || "Rental event",
    startMs,
    endMs: Number.isNaN(endParsed) ? startMs + 3600_000 : endParsed,
    status: ghlStatusOf(a.appointmentStatus ?? a.status),
    address: prev?.address ?? "",
    ioStatusName: prev?.ioStatusName ?? "",
    total: prev?.total ?? 0,
  };
}

export const ghlAppointmentStatus: Record<BookingStatus, string> = { booked: "new", confirmed: "confirmed", cancelled: "cancelled" };

export function samePerson(a: Person | null, b: Person): boolean {
  return !!a && (Object.keys(b) as (keyof Person)[]).every((k) => a[k] === b[k]);
}

export function sameBooking(a: Booking | null, b: Booking): boolean {
  return !!a && (Object.keys(b) as (keyof Booking)[]).every((k) => a[k] === b[k]);
}
