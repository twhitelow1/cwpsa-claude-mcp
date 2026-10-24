import { describe, expect, it } from "vitest";
import { keys, syncGhlAppointment, syncGhlContact, syncIoLeadById } from "@/lib/sync/engine";
import { ioLead, makeTestDeps, on } from "./helpers";

const ghlContact = {
  id: "ghlContact001",
  firstName: "Jordan",
  lastName: "Rivera",
  email: "jordan.rivera@example.com",
  phone: "+13305550144",
  address1: "123 Main St",
  city: "Akron",
  state: "OH",
  postalCode: "44301",
};

const writes = <T extends { method: string }>(calls: T[]) => calls.filter((c) => c.method !== "GET");

describe("Inflatable Office → GHL", () => {
  it("creates the contact and appointment, then skips an unchanged re-sync", async () => {
    const { deps, calls } = makeTestDeps([
      on("GET", /\/api6\/leads\/520247$/, ioLead()),
      on("POST", /\/contacts\/upsert$/, { new: true, contact: { id: "ghlContact001" } }),
      on("POST", /\/contacts\/ghlContact001\/tags$/, {}),
      on("POST", /\/calendars\/events\/appointments$/, { id: "ghlAppt0001" }),
    ]);

    const r1 = await syncIoLeadById(deps, "520247");
    expect(r1).toMatchObject({ person: "created", booking: "created" });

    const upsert = calls.find((c) => c.url.pathname.endsWith("/contacts/upsert"))!;
    expect(upsert.body).toMatchObject({ locationId: "loc123456", email: "jordan.rivera@example.com", phone: "+13305550144" });
    expect(upsert.headers.Authorization).toBe("Bearer pit-test-token-0000"); // secret-scan: allow
    expect(upsert.headers.Version).toBe("2021-07-28");

    const appt = calls.find((c) => c.url.pathname.endsWith("/calendars/events/appointments"))!;
    expect(appt.headers.Version).toBe("2021-04-15");
    expect(appt.body).toMatchObject({
      calendarId: "cal123456",
      locationId: "loc123456",
      contactId: "ghlContact001",
      startTime: "2026-07-15T20:00:00Z",
      endTime: "2026-07-15T22:00:00Z",
      appointmentStatus: "new",
      address: "123 Main St, Akron, OH 44301",
      ignoreFreeSlotValidation: true,
      toNotify: false,
    });

    // The IO key is sent as a query param on GET and never to GHL.
    const ioGet = calls.find((c) => c.url.hostname === "rental.software")!;
    expect(ioGet.url.searchParams.get("apiKey")).toBe("io-test-key-0000"); // secret-scan: allow
    expect(calls.filter((c) => c.url.hostname !== "rental.software").every((c) => !c.url.search.includes("apiKey"))).toBe(true);

    calls.length = 0;
    const r2 = await syncIoLeadById(deps, "520247");
    expect(r2.outcome).toBe("unchanged");
    expect(writes(calls)).toHaveLength(0);
  });

  it("moves the GHL appointment when the IO event is rescheduled or cancelled", async () => {
    let lead = ioLead();
    const { deps, calls } = makeTestDeps([
      on("GET", /\/api6\/leads\/520247$/, () => lead),
      on("POST", /\/contacts\/upsert$/, { new: true, contact: { id: "ghlContact001" } }),
      on("POST", /\/tags$/, {}),
      on("POST", /\/calendars\/events\/appointments$/, { id: "ghlAppt0001" }),
      on("PUT", /\/calendars\/events\/appointments\/ghlAppt0001$/, {}),
    ]);
    await syncIoLeadById(deps, "520247");
    calls.length = 0;

    lead = ioLead({ eventstarttime_ts: "1784232000", eventendtime_ts: "1784239200", status: { name: "Cancelled", cancel: "1" } });
    const r = await syncIoLeadById(deps, "520247");
    expect(r).toMatchObject({ person: "unchanged", booking: "updated" });
    const put = writes(calls);
    expect(put).toHaveLength(1);
    expect(put[0].body).toMatchObject({ startTime: "2026-07-16T20:00:00Z", appointmentStatus: "cancelled" });
  });

  it("mirrors the lead as an opportunity when a pipeline is configured", async () => {
    const { deps, calls } = makeTestDeps(
      [
        on("GET", /\/api6\/leads\/520247$/, ioLead()),
        on("POST", /\/contacts\/upsert$/, { new: false, contact: { id: "ghlContact001" } }),
        on("POST", /\/tags$/, {}),
        on("POST", /\/calendars\/events\/appointments$/, { id: "ghlAppt0001" }),
        on("POST", /\/opportunities\/$/, { opportunity: { id: "ghlOpp00001" } }),
      ],
      { GHL_PIPELINE_ID: "pipe12345", GHL_DEFAULT_STAGE_ID: "stageDefault", GHL_STAGE_MAP: '{"Hold":"stageHold1"}' },
    );
    await syncIoLeadById(deps, "520247");
    const opp = calls.find((c) => c.url.pathname.endsWith("/opportunities/"))!;
    expect(opp.body).toMatchObject({ pipelineId: "pipe12345", pipelineStageId: "stageHold1", monetaryValue: 425.13, status: "open", contactId: "ghlContact001" });
  });
});

describe("GHL → Inflatable Office", () => {
  it("ignores the GHL webhook that echoes our own write (loop guard)", async () => {
    const { deps, calls } = makeTestDeps([
      on("GET", /\/api6\/leads\/520247$/, ioLead()),
      on("POST", /\/contacts\/upsert$/, { new: true, contact: { id: "ghlContact001" } }),
      on("POST", /\/tags$/, {}),
      on("POST", /\/calendars\/events\/appointments$/, { id: "ghlAppt0001" }),
      on("GET", /\/contacts\/ghlContact001$/, { contact: ghlContact }),
      on("GET", /\/calendars\/events\/appointments\/ghlAppt0001$/, {
        appointment: { id: "ghlAppt0001", calendarId: "cal123456", contactId: "ghlContact001", title: "Birthday Party", startTime: "2026-07-15T16:00:00-04:00", endTime: "2026-07-15T18:00:00-04:00", appointmentStatus: "new" },
      }),
    ]);
    await syncIoLeadById(deps, "520247");
    calls.length = 0;

    expect((await syncGhlContact(deps, "ghlContact001")).outcome).toBe("unchanged");
    expect((await syncGhlAppointment(deps, "ghlAppt0001")).outcome).toBe("unchanged");
    expect(calls.filter((c) => c.url.hostname === "rental.software")).toHaveLength(0);
  });

  it("creates an IO customer and lead from a new GHL booking", async () => {
    const { deps, calls, store } = makeTestDeps([
      on("GET", /\/calendars\/events\/appointments\/ghlAppt0002$/, {
        appointment: { id: "ghlAppt0002", calendarId: "cal123456", contactId: "ghlContact002", title: "Water slide party", startTime: "2026-08-01T14:00:00-04:00", endTime: "2026-08-01T18:00:00-04:00", appointmentStatus: "confirmed" },
      }),
      on("GET", /\/contacts\/ghlContact002$/, { contact: { id: "ghlContact002", firstName: "Sam", lastName: "Lee", email: "sam@example.com", phone: "+1 330-555-0100" } }),
      on("POST", /\/api6\/customers$/, { status: 201, recordid: 700001 }, 201),
      on("POST", /\/api6\/leads$/, { status: 201, recordid: 800001 }, 201),
    ]);
    const r = await syncGhlAppointment(deps, "ghlAppt0002");
    expect(r).toMatchObject({ outcome: "created", person: "created" });

    const cust = calls.find((c) => c.url.pathname === "/api6/customers")!;
    expect(cust.body).toMatchObject({ apiKey: "io-test-key-0000", firstname: "Sam", email: "sam@example.com", cellphone: "3305550100" }); // secret-scan: allow
    expect(cust.url.searchParams.has("apiKey")).toBe(false);

    const lead = calls.find((c) => c.url.pathname === "/api6/leads")!;
    expect(lead.body).toMatchObject({
      customerid: "700001",
      eventname: "Water slide party",
      eventstarttime: 1785607200,
      eventendtime: 1785621600,
      eventzip: "44301",
      status: "Confirmed",
    });
    expect(await store.get(keys.bookingByGhl("ghlAppt0002"))).toBe("800001");
    expect(await store.get(keys.personByGhl("ghlContact002"))).toBe("700001");
  });

  it("does not send a lead status the account has not mapped", async () => {
    const { deps, calls } = makeTestDeps(
      [
        on("GET", /\/calendars\/events\/appointments\/ghlAppt0003$/, {
          appointment: { id: "ghlAppt0003", calendarId: "cal123456", contactId: "ghlContact002", startTime: "2026-08-01T14:00:00Z", appointmentStatus: "confirmed" },
        }),
        on("GET", /\/contacts\/ghlContact002$/, { contact: { id: "ghlContact002", firstName: "Sam", postalCode: "44222" } }),
        on("POST", /\/api6\/customers$/, { recordid: 700001 }, 201),
        on("POST", /\/api6\/leads$/, { recordid: 800002 }, 201),
      ],
      { IO_CONFIRMED_STATUS: "" },
    );
    await syncGhlAppointment(deps, "ghlAppt0003");
    const lead = calls.find((c) => c.url.pathname === "/api6/leads")!;
    expect(lead.body).not.toHaveProperty("status");
    expect(lead.body).toMatchObject({ eventzip: "44222" });
  });

  it("skips appointments on other calendars", async () => {
    const { deps, calls } = makeTestDeps([
      on("GET", /\/calendars\/events\/appointments\/ghlAppt0004$/, { appointment: { id: "ghlAppt0004", calendarId: "otherCal99", startTime: "2026-08-01T14:00:00Z" } }),
    ]);
    expect(await syncGhlAppointment(deps, "ghlAppt0004")).toMatchObject({ outcome: "skipped", reason: "other_calendar" });
    expect(writes(calls)).toHaveLength(0);
  });

  it("updates the linked IO customer without blanking fields GHL does not have", async () => {
    const { deps, calls } = makeTestDeps([
      on("GET", /\/api6\/leads\/520247$/, ioLead()),
      on("POST", /\/contacts\/upsert$/, { new: true, contact: { id: "ghlContact001" } }),
      on("POST", /\/tags$/, {}),
      on("POST", /\/calendars\/events\/appointments$/, { id: "ghlAppt0001" }),
      on("GET", /\/contacts\/ghlContact001$/, { contact: { id: "ghlContact001", firstName: "Jordan", lastName: "Rivera-Smith", email: "jordan.rivera@example.com" } }),
      on("POST", /\/api6\/customers\/533268$/, { status: 200, recordid: 533268 }),
    ]);
    await syncIoLeadById(deps, "520247");
    calls.length = 0;

    expect((await syncGhlContact(deps, "ghlContact001")).outcome).toBe("updated");
    const upd = calls.find((c) => c.url.pathname === "/api6/customers/533268")!;
    expect(upd.body).toMatchObject({ lastname: "Rivera-Smith", street: "123 Main St", cellphone: "3305550144" });
  });
});
