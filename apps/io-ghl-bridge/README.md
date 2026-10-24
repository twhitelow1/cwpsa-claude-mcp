# DubLow IO ↔ GHL Bridge

A two-way sync between **Inflatable Office** (rental.software API6) and the client's **GoHighLevel sub-account** in the Lead Alchemist white label. It replaces Zapier.

| Inflatable Office | ↔ | GoHighLevel | Direction |
|---|---|---|---|
| Customer | ↔ | Contact (tagged `inflatable-office`) | both ways |
| Lead (event date/time, status) | ↔ | Appointment on one chosen calendar | both ways |
| Lead (status, total) | → | Opportunity in a pipeline (optional) | IO → GHL |

It is a standalone Next.js app, deployed as its own Vercel project with **Root Directory = `apps/io-ghl-bridge`**. It shares nothing with the ConnectWise bridge at the repo root.

## How it works

```
Inflatable Office                         Vercel: io-ghl-bridge                       GoHighLevel sub-account
─────────────────                         ─────────────────────                       ───────────────────────
Automation "Send Data" ──POST ?key=──▶ /api/webhooks/io ──┐
  (lead ID only)                                          │  re-read lead + customer (API6)
                                                          ├─▶ upsert contact, create/move appointment ──▶ Contacts / Calendar
Vercel Cron (every 3 h) ─▶ /api/cron/poll-io ─────────────┘     (+ opportunity if pipeline set)
  leads modified in last day; safety net
                                                                                     Workflow "Webhook" action
                         /api/webhooks/ghl ◀──POST x-bridge-key── (contact changed / appointment booked or changed)
                               │  re-read contact / appointment (API v2)
   Customers / Leads ◀─────────┘  create/update customer, create/move lead
```

- **Loop guard.** Every record is converted to a neutral shape and compared with the last-synced snapshot. When a webhook echoes the bridge's own write, the comparison matches and the bridge does nothing. That stops the ping-pong a naive two-way sync falls into.
- **Id links and snapshots** live in Upstash Redis. A short per-record lock stops a burst of webhooks from creating duplicates.
- **Blank never overwrites.** A GHL contact with no address won't wipe the address Inflatable Office has, and the same holds the other way.
- **Inflatable Office owns** the event address, the lead total and the lead status name. GHL owns nothing exclusively. Last write wins on the shared fields: name, email, phone, title, start and end time, and booked/confirmed/cancelled.
- **Payloads are only triggers.** Both webhooks re-read the record from the API, so the payloads only need to carry ids.
- **No deletes.** A cancelled IO lead becomes a cancelled GHL appointment, and the same holds the other way if the cancel status is mapped.

### Inflatable Office API costs and limits

- The first 500 API calls a month are free. After that each call is billed (Settings → API Preferences can cap spend).
- The bridge uses one call per webhook (one more if a lead carries no customer), plus one call per 25 changed leads per cron run.
- About 240 cron calls a month at the default 3-hour schedule. Change `vercel.json` to tune it.
- Calls are spaced at least 550 ms apart and a 429 `Retry-After` is honored. That fits the 15/10 s, 300/5 min and 2/s limits.

## Setup (about 30 minutes)

### 1. Inflatable Office
1. Settings → Subscription: make sure the **API & WordPress** module is active.
2. Settings → API Keys → new key named "GHL Bridge". Set these permissions:
   - **Customers:** Full Access
   - **Leads:** Full Access
   - **Leads Create:** Full Access
3. Leave IP restrictions empty: Vercel has no fixed egress IP unless you pay for Secure Compute.
4. Note the exact names of your lead statuses for "confirmed" and "cancelled" (Settings → Lead Statuses).

### 2. GoHighLevel (inside the client's sub-account, not the agency)
1. Settings → Private Integrations → create "Inflatable Office Bridge" with these scopes:
   - `contacts.readonly`, `contacts.write`
   - `calendars.readonly`, `calendars/events.readonly`, `calendars/events.write`
   - `opportunities.readonly`, `opportunities.write` (only if you use the pipeline)
2. Copy the token. It is shown once.
3. Note the **Location ID** (Settings → Business Profile) and the **Calendar ID** of the calendar for rental events.
4. Optional: note the pipeline ID and stage IDs to mirror leads as opportunities.

### 3. Vercel
1. New Project → import `twhitelow1/cwpsa-claude-mcp` → **Root Directory: `apps/io-ghl-bridge`**.
2. Storage → Marketplace → **Upstash Redis** → connect it to the project. It sets `KV_REST_API_URL` and `KV_REST_API_TOKEN`.
3. Add the env vars from `.env.example`. Generate each secret with `openssl rand -hex 32`.
4. Deploy, then open `https://<app>/api/health`. It should return `{"ok":true}`, or list the variable names that are missing.

### 4. Wire the webhooks
**Inflatable Office → bridge**
1. Create a lead **Filter** such as "Modified today", or a narrower one like "Has event date".
2. Create a **Report** with at least the `ID` column.
3. Create an **Automation** on that filter with the action **Send Data**:
   - URL: `https://<app>/api/webhooks/io?key=<IO_WEBHOOK_SECRET>`
   - Report: the one from step 2.

**GHL → bridge.** In the sub-account, go to Automation → Workflows and create two workflows:
1. Trigger **Contact Created** + **Contact Changed**.
   - Optional filter: tag is/has, to sync only some contacts.
   - Action **Custom Webhook**: POST to `https://<app>/api/webhooks/ghl`, header `x-bridge-key: <GHL_WEBHOOK_SECRET>`, body `{"contact_id":"{{contact.id}}"}`.
2. Trigger **Customer Booked Appointment** + **Appointment Status** (filter: calendar = the rental calendar).
   - Action **Webhook** (the standard one): URL `https://<app>/api/webhooks/ghl?key=<GHL_WEBHOOK_SECRET>`. Its payload carries `calendar.appointmentId`, which is all the bridge needs.
   - Or use **Custom Webhook** with the `x-bridge-key` header and body `{"appointment_id":"<appointment id merge field>"}`.

Check the workflows' "Allow re-entry" so repeat changes keep syncing. The loop guard makes repeats harmless.

## Environment

See `.env.example`. Required:
- `IO_API_KEY`
- `IO_DEFAULT_ZIP` (IO requires a zip on every lead)
- `GHL_TOKEN`
- `GHL_LOCATION_ID`
- `GHL_CALENDAR_ID`
- `IO_WEBHOOK_SECRET`
- `GHL_WEBHOOK_SECRET`
- `CRON_SECRET`
- the Upstash vars

| Optional | Effect |
|---|---|
| `IO_CONFIRMED_STATUS`, `IO_CANCEL_STATUS` | Exact IO status names written when a GHL appointment is confirmed or cancelled. When unset, GHL status changes don't change the IO status. An unknown name would reset the lead to the default quote status, so the bridge never guesses. |
| `GHL_NOTIFY` | `true` lets GHL send its own appointment notifications for synced events (default `false`, so customers aren't double-messaged). |
| `GHL_PIPELINE_ID`, `GHL_DEFAULT_STAGE_ID`, `GHL_STAGE_MAP` | Mirror IO leads as opportunities. The map is `{"<IO status name>":"<stageId>"}`. |
| `GHL_CONTACTS_VERSION`, `GHL_CALENDARS_VERSION` | GHL API `Version` headers (default `2021-07-28` / `2021-04-15`). |

## Develop

```
cd apps/io-ghl-bridge
npm install
npm run typecheck && npm test && npm run build
```

All tests mock both APIs (`tests/helpers.ts`). No live calls are made.

## Known limits

- A new GHL contact creates a new IO customer. API6 has no customer search, so an IO customer that already exists with the same email is not matched. GHL → IO leads match customers by the stored link.
- Rentals and line items are not synced into GHL. Only the event, its status and the total are.
- Opportunity changes in GHL are not written back to IO.
- Sync starts from the moment it is turned on. To backfill older leads, run the cron with a wider range (change `past_days_1` in `handleCron`) once, then set it back.
