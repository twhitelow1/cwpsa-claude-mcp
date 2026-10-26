# DubLow ConnectWise Bridge

A secure Next.js service on Vercel that wraps the **ConnectWise PSA (Manage) REST API** and exposes it two ways:

1. **Remote MCP server** at `/api/mcp` (streamable HTTP), so Claude can use it as a custom connector.
2. **Read-only REST API** at `/api/v1/...` for other automations (Rewst, GoHighLevel, etc.), with an OpenAPI 3 spec at `/api/openapi.json`.

Owner: Todd, DubLow Digital.

## Architecture

```
Claude / Rewst / GHL
        │  Authorization: Bearer <BRIDGE_API_TOKEN>
        ▼
┌──────────────────────── Vercel (Node runtime) ────────────────────────┐
│ /api/mcp  (mcp-handler)      /api/v1/[...path]      /api/openapi.json │
│        └──────────┬───────────────┘                                   │
│              guard(): origin check → constant-time bearer → rate limit│
│                   │                                                   │
│              runTool(): zod validation → handler → audit log line     │
│                   │                                                   │
│   read tools ─────┤      write tools ── runWrite(): WRITES_ENABLED?   │
│                   │                     dry run → HMAC confirm_token  │
│                   │                     → execute exactly that plan   │
│                   ▼                                                   │
│              CwClient: Basic auth + clientId, ≤5 concurrent,          │
│              retry 429/5xx with backoff + Retry-After, pagination     │
└───────────────────┬───────────────────────────────────────────────────┘
                    ▼
     https://${CW_HOST}/${CW_API_PATH}  (ConnectWise PSA)
```

| Path | What |
|---|---|
| `src/lib/cw/client.ts` | ConnectWise HTTP client (auth headers, retries, concurrency cap, pagination) |
| `src/lib/cw/conditions.ts` | Safe `conditions` string builder: escapes quotes, validates field names |
| `src/lib/tools/*` | Tool definitions shared by MCP and REST (zod schemas + handlers) |
| `src/lib/writes.ts`, `src/lib/confirm.ts` | Two-step write flow and HMAC confirm tokens |
| `src/lib/auth.ts`, `src/lib/guard.ts`, `src/lib/ratelimit.ts` | Bearer auth, origin allow-list, rate limit |
| `src/lib/audit.ts` | JSON-line audit log (shows up in Vercel logs) |
| `src/lib/pricing.ts` | Pure pricing engine: margin rules, list price guard, overrides (see `docs/quote-manager-rebuild.md`) |
| `src/lib/distributors/` | `DistributorAdapter` interface + stubs (design only, see `docs/distributors.md`) |

There's no database. The audit log goes to stdout as JSON lines, and Vercel captures it. You can add a log drain if you need retention.

## Tools

**Read tools (always on):** `cw_search_tickets`, `cw_get_ticket`, `cw_list_ticket_notes`, `cw_search_time_entries`, `cw_time_summary`,
`cw_search_companies`, `cw_get_company`, `cw_search_contacts`, `cw_search_configurations`, `cw_get_agreements`,
`cw_search_catalog`, `cw_price_catalog`, `cw_list_members`, `cw_list_boards_statuses`.

**Write tools:** `cw_add_ticket_note`, `cw_add_time_entry`, `cw_update_ticket`, `cw_create_opportunity`, `cw_create_sales_order` and `cw_add_sales_order_line`.
- They are only registered when `WRITES_ENABLED=true`.
- Every write takes two calls. The first call (no `confirm_token`) returns `dry_run: true`, the exact requests that would be sent, and a `confirm_token`.
- The second call, with identical arguments plus that token, executes. The token is valid for 10 minutes and works once.
- The token is HMAC-signed and bound to a hash of the planned requests, so any change to the arguments is rejected.
- There are **no delete operations**.

## REST API (read-only)

All endpoints are `GET` and need `Authorization: Bearer <token>`. Query params match the tool inputs (see `/api/openapi.json`).

| Endpoint | Tool |
|---|---|
| `/api/v1/tickets` | cw_search_tickets |
| `/api/v1/tickets/{id}` | cw_get_ticket |
| `/api/v1/tickets/{id}/notes` | cw_list_ticket_notes |
| `/api/v1/time-entries` | cw_search_time_entries |
| `/api/v1/time-summary` | cw_time_summary |
| `/api/v1/companies`, `/api/v1/companies/{id}` | cw_search_companies, cw_get_company |
| `/api/v1/contacts`, `/api/v1/configurations`, `/api/v1/agreements` | searches |
| `/api/v1/catalog`, `/api/v1/members`, `/api/v1/boards` | lookups |
| `/api/v1/catalog/pricing` | cw_price_catalog (proposed sell prices from margin rules) |

```bash
curl -H "Authorization: Bearer $BRIDGE_API_TOKEN" \
  "https://<deployment>/api/v1/tickets?company_name=Acme&limit=10"
```

## Environment variables

Set these in **Vercel → Project → Settings → Environment Variables** for Production and Preview. Mark the secrets as *Sensitive*. Never commit them. `.env.example` lists the variable names only.

| Var | Required | Notes |
|---|---|---|
| `CW_HOST` | yes | e.g. `api-na.myconnectwise.net` (hostname only) |
| `CW_API_PATH` | yes | e.g. `v4_6_release/apis/3.0` |
| `CW_COMPANY_ID` | yes | ConnectWise company id (login company) |
| `CW_PUBLIC_KEY` / `CW_PRIVATE_KEY` | yes | API member keys (Sensitive) |
| `CW_CLIENT_ID` | yes | from developer.connectwise.com (Sensitive) |
| `BRIDGE_API_TOKEN` | yes | ≥32 chars. Generate: `openssl rand -base64 48` (Sensitive) |
| `WRITES_ENABLED` | no | `"true"` turns write tools on. Anything else = off (default) |
| `ALLOWED_ORIGINS` | no | Comma-separated browser origins allowed (e.g. `https://claude.ai`). Requests without an `Origin` header (server-to-server) are allowed; the bearer token still applies |
| `RATE_LIMIT_PER_MINUTE` | no | Per token, per serverless instance (default 120) |
| `CW_MISC_CATALOG_ITEM_ID` | no | Catalog item used as the base for custom (non-catalog) sales lines |

**ConnectWise API member:** create a dedicated API member with a security role that has **Inquire** on Service Tickets, Time, Companies, Contacts, Configurations, Agreements, Procurement Catalog, Sales and System Members. Add **Add/Edit** on Ticket Notes, Time Entries, Opportunities, Sales Orders and Products only when you enable writes. Give it no Delete rights.

## Add the connector to Claude

**MCP URL:** `https://<deployment>/api/mcp` with header `Authorization: Bearer <BRIDGE_API_TOKEN>`.

**Claude Code:**
```bash
claude mcp add --transport http connectwise https://<deployment>/api/mcp \
  --header "Authorization: Bearer $BRIDGE_API_TOKEN"
```
or in `.mcp.json` (keep the token in your shell env, not the file):
```json
{ "mcpServers": { "connectwise": { "type": "http", "url": "https://<deployment>/api/mcp",
  "headers": { "Authorization": "Bearer ${CW_BRIDGE_TOKEN}" } } } }
```

**claude.ai / Claude Desktop (Settings → Connectors → Add custom connector):**
1. Enter the URL `https://<deployment>/api/mcp`.
2. Under *Request headers*, add `Authorization` = `Bearer <token>`.

Some catches with this route:
- The request-headers option is a beta that only some organizations have.
- The header is shared by everyone in the org.
- You can't edit auth settings after saving. To change them, remove the connector and add it again.

If your org doesn't have request headers, use Claude Code, or ask for OAuth support (planned for v2).

**Messages API (MCP connector):** use `mcp_servers: [{ type: "url", url: "https://<deployment>/api/mcp", name: "connectwise", authorization_token: "<token>" }]`.

## Rotating keys

- **Bridge token:**
  1. Generate a new value and update `BRIDGE_API_TOKEN` in Vercel.
  2. Redeploy (Deployments → … → Redeploy).
  3. Update every client (Claude connector, Rewst, GHL).

  Pending write `confirm_token`s are invalidated automatically, because they're signed with a key derived from this token.
- **ConnectWise keys:**
  1. In CW, open the API member, go to API Keys, and add a new key.
  2. Update `CW_PUBLIC_KEY` and `CW_PRIVATE_KEY` in Vercel and redeploy.
  3. Run `npm run smoke`, then delete the old key in CW.
- **If a secret leaks:** rotate it right away, then check the Vercel logs (`"type":"audit"` lines) for unexpected `tokenId`s.

## Enabling writes

1. Make sure the CW API member's role has the Add/Edit rights listed above.
2. Set `WRITES_ENABLED=true` in Vercel (start with Preview, test there, then Production) and redeploy.
3. In Claude, the write tools now appear. Each first call returns a preview. Approve it, and Claude re-calls with the `confirm_token`.
4. To turn writes off, set the variable to `false` (or remove it) and redeploy.

## Development

```bash
npm install            # also installs the pre-commit secret scan hook
npm test               # unit tests (mocked ConnectWise)
npm run typecheck
npm run secret-scan -- --all
npm run dev            # needs a .env.local (gitignored)
```

### Smoke test (live, read-only)

```bash
# .env.local:  BRIDGE_URL=https://<deployment>  BRIDGE_API_TOKEN=...  SMOKE_MEMBER=<your CW identifier>
npm run smoke
```
It checks that auth is enforced, runs MCP `initialize` and `tools/list`, and prints:
- the open ticket count and the last 7 days of ticket intake
- boards, members, companies and catalog
- your time entries for the last 7 days, by day, billable vs. non-billable

## Known limits (v1)

- The rate limit and confirm-token single-use tracking are in memory, so they apply per serverless instance. The 10-minute expiry and payload binding still hold everywhere. For a global guarantee, add Upstash/Vercel KV.
- Time ranges are interpreted in UTC.
- Static bearer auth only, no per-user OAuth yet.
