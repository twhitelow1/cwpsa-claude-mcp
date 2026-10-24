import { describe, expect, it } from "vitest";
import { handleCron, handleGhlWebhook, handleIoWebhook } from "@/lib/handlers";
import { normPhone } from "@/lib/normalize";
import { ioLead, makeTestDeps, on } from "./helpers";

const ioOk = () =>
  makeTestDeps([
    on("GET", /\/api6\/leads\/520247$/, ioLead()),
    on("GET", /\/api6\/leads$/, { items: [ioLead()] }),
    on("POST", /\/contacts\/upsert$/, { new: true, contact: { id: "ghlContact001" } }),
    on("POST", /\/tags$/, {}),
    on("POST", /\/calendars\/events\/appointments$/, { id: "ghlAppt0001" }),
  ]);

describe("webhook auth and parsing", () => {
  it("rejects a wrong IO secret without touching either API", async () => {
    const { deps, calls } = ioOk();
    const res = await handleIoWebhook(new Request("https://b.test/api/webhooks/io?key=wrong", { method: "POST", body: "ID=520247" }), () => deps);
    expect(res.status).toBe(401);
    expect(calls).toHaveLength(0);
  });

  it("accepts the IO form-encoded Send Data post", async () => {
    const { deps } = ioOk();
    const res = await handleIoWebhook(
      new Request(`https://b.test/api/webhooks/io?key=${"i".repeat(32)}`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: "ID=520247&Customer=Jordan+Rivera&Total=%24425.13",
      }),
      () => deps,
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ person: "created", booking: "created" });
  });

  it("routes a GHL appointment trigger by calendar.appointmentId", async () => {
    const { deps, calls } = makeTestDeps([on("GET", /\/calendars\/events\/appointments\/ghlAppt0009$/, {}, 404)]);
    const res = await handleGhlWebhook(
      new Request("https://b.test/api/webhooks/ghl", {
        method: "POST",
        headers: { "x-bridge-key": "g".repeat(32) },
        body: JSON.stringify({ contact_id: "ghlContact001", calendar: { appointmentId: "ghlAppt0009" } }),
      }),
      () => deps,
    );
    expect(await res.json()).toMatchObject({ outcome: "skipped", reason: "appointment_not_found" });
    expect(calls).toHaveLength(1);
  });

  it("returns 502 with a scrubbed message when upstream fails, so IO retries", async () => {
    const { deps } = makeTestDeps([on("GET", /\/api6\/leads\/520247$/, { message: "Permission access restricted" }, 403)]);
    const res = await handleIoWebhook(new Request(`https://b.test/x?key=${"i".repeat(32)}`, { method: "POST", body: "ID=520247" }), () => deps);
    expect(res.status).toBe(502);
    const text = await res.text();
    expect(text).toContain("Permission access restricted");
    expect(text).not.toContain("io-test-key"); // secret-scan: allow
  });

  it("cron requires the bearer secret and skips leads it has already seen", async () => {
    const { deps, calls } = ioOk();
    const unauth = await handleCron(new Request("https://b.test/api/cron/poll-io"), () => deps);
    expect(unauth.status).toBe(401);

    const req = () => new Request("https://b.test/api/cron/poll-io", { headers: { authorization: `Bearer ${"c".repeat(32)}` } });
    expect(await (await handleCron(req(), () => deps)).json()).toMatchObject({ leads: 1, updated: 1 });
    calls.length = 0;
    expect(await (await handleCron(req(), () => deps)).json()).toMatchObject({ leads: 1, seen: 1 });
    expect(calls).toHaveLength(1); // just the list call
  });
});

describe("retries", () => {
  it("waits out an IO 429 using Retry-After", async () => {
    let n = 0;
    const { deps } = makeTestDeps([
      (c) => (c.url.pathname.endsWith("/leads/520247") && n++ === 0 ? { status: 429, body: {}, headers: { "retry-after": "2" } } : undefined),
      on("GET", /\/api6\/leads\/520247$/, ioLead()),
      on("POST", /\/contacts\/upsert$/, { new: true, contact: { id: "ghlContact001" } }),
      on("POST", /\/tags$/, {}),
      on("POST", /\/calendars\/events\/appointments$/, { id: "ghlAppt0001" }),
    ]);
    const { syncIoLeadById } = await import("@/lib/sync/engine");
    expect((await syncIoLeadById(deps, "520247")).person).toBe("created");
    expect(n).toBe(2);
  });
});

describe("normalize", () => {
  it("compares phones across formats", () => {
    expect(normPhone("+1 (330) 555-0144")).toBe("3305550144");
    expect(normPhone("330.555.0144")).toBe("3305550144");
  });
});
