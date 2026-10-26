# CLAUDE.md — dublow-connectwise-bridge

Next.js (App Router) + TypeScript service on Vercel wrapping the ConnectWise PSA REST API as a remote MCP server (`/api/mcp`) and a read-only REST API (`/api/v1/*`). See README.md for architecture.

## Product reference

The proposal and quoting features are modeled on the full functionality of **Kaseya Quote Manager**. For any question about how a quoting, pricing, catalog, sales order, purchasing or PSA-sync feature should behave:
1. Check `docs/quote-manager-rebuild.md` first.
2. Then check the KQM help site: https://help.quotemanager.kaseya.com/

`docs/kaseya-quote-manager-reference.md` says how to use the reference, which source wins when they disagree, and lists where DubLow deliberately differs. The security rules below still win over KQM behavior.

## Commands

- `npm test`: vitest, all ConnectWise calls mocked (`tests/helpers.ts` → `mockCw`)
- `npm run typecheck`
- `npm run build`
- `npm run secret-scan -- --all`
- `npm run smoke`: live, read-only, against a deployment (needs `BRIDGE_URL`, `BRIDGE_API_TOKEN`, optional `SMOKE_MEMBER`)

Run typecheck + tests + secret scan before every commit. The pre-commit hook (`.githooks/pre-commit`) runs the secret scan.

## Security rules (non-negotiable)

1. **Every endpoint requires `Authorization: Bearer ${BRIDGE_API_TOKEN}`.** That covers MCP, REST and the OpenAPI spec. Use `guard()` from `src/lib/guard.ts` in every route handler. The compare is constant-time (sha256 + `timingSafeEqual`).
2. **Read tools work by default. Write tools are registered only when `WRITES_ENABLED === "true"`.** `runWrite()` re-checks this at call time.
3. **Every write uses the two-step confirm flow** in `runWrite()` (`src/lib/writes.ts`):
   - The first call returns a dry-run preview plus a `confirm_token`. The token is HMAC-signed, expires in 10 minutes, is single use, and is bound to the hash of the exact planned requests.
   - Only the second call with a valid token executes. Never add a write path that bypasses `runWrite()`.
4. **No delete operations anywhere.** There's a test asserting this. Don't add DELETE to `CwClient.request`'s method union.
5. **Audit every call** via `runTool()`, which writes one JSON line: ts, tool, ids, mode (read/dry_run/executed/rejected), status.
   - Never log credentials, tokens, full note/notes text, or request bodies.
   - `auditIds` returns ids only, never free text.
6. **Validate every tool input with zod.** Use `memberIdentifier`, `id`, `searchText` from `tools/common.ts`.
   - Errors reach callers only through `toPublicError()`, which scrubs URLs and credentials.
   - Never return raw upstream bodies on 401/403/5xx.
7. **Never commit secrets.** `.gitignore` covers `.env*`, and `.env.example` has variable names only. Secrets live in Vercel env vars. Never ask the user to paste secrets into chat.

## Conventions

- **ConnectWise conditions:** always build them with `cond.*` / `and()` / `or()` from `src/lib/cw/conditions.ts`. Never interpolate user input into a condition string by hand.
- **New tool:**
  1. `defineTool({...})` in `src/lib/tools/<area>.ts`.
  2. Register it in `tools/index.ts`.
  3. If it's a read tool, add a REST route in `src/lib/rest.ts` (the OpenAPI spec is generated from that).
  4. Add a mocked test.
- **Tool descriptions:** say when to use the tool and point to the lookup tools for ids.
- **Tool output** must stay compact:
  - map CW objects to small shapes (`compact()`, `ref()`)
  - strip HTML (`clean()`)
  - cap list sizes with `limit`
  - report `truncated`
- **Use the `fields` param** only with top-level field names that are known to exist.
- **CW client:** retries GET on 429/5xx/network errors, and POST/PATCH only on 429. It caps concurrency at 5 and honors Retry-After.
- **Write plans:** use `"$ref:N.id"` to reference the id created by request N (e.g. sales order → product lines).
- **Commits:** one logical change per commit, descriptive message, and `npm test` green.

## Endpoint facts (verified)

- Ticket notes require one of `detailDescriptionFlag` (customer-visible discussion), `internalAnalysisFlag` (internal) or `resolutionFlag`.
- Product lines are `POST /procurement/products` with `catalogItem`, `chargeToType` (`SalesOrder` | `Opportunity`), `chargeToId` and `billableOption`.
- Opportunity requires `name`, `company`, `contact`, `site`, `primarySalesRep`.
- Sales order requires `company`, `salesRep`, `status`.
- Ticket PATCH uses JSON Patch: `[{ op: "replace", path: "status", value: { id } }]`.
