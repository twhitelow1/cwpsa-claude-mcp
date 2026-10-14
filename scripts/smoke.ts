/**
 * Live, READ-ONLY smoke test against a deployed bridge.
 *
 *   BRIDGE_URL=https://<deployment> BRIDGE_API_TOKEN=... SMOKE_MEMBER=<your cw identifier> npm run smoke
 *
 * Values can also live in .env.local (gitignored). Never pass the token on the
 * command line in shared shells (it lands in history).
 */
import { existsSync } from "node:fs";

if (existsSync(".env.local")) process.loadEnvFile?.(".env.local");

const base = (process.env.BRIDGE_URL ?? "").replace(/\/+$/, "");
const token = process.env.BRIDGE_API_TOKEN ?? "";
const member = process.env.SMOKE_MEMBER ?? "";
if (!base || !token) {
  console.error("Set BRIDGE_URL and BRIDGE_API_TOKEN (env or .env.local).");
  process.exit(2);
}

const auth = { Authorization: `Bearer ${token}` };
let failures = 0;

async function rest(path: string): Promise<any> {
  const res = await fetch(`${base}/api/v1/${path}`, { headers: auth });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${res.status} ${body.error ?? ""} ${body.message ?? ""}`.trim());
  return body;
}

async function step(name: string, fn: () => Promise<string>) {
  const t = Date.now();
  try {
    const out = await fn();
    console.log(`✔ ${name} (${Date.now() - t}ms)${out ? `\n    ${out.replace(/\n/g, "\n    ")}` : ""}`);
  } catch (e) {
    failures++;
    console.log(`✘ ${name}: ${(e as Error).message}`);
  }
}

const iso = (d: Date) => d.toISOString().slice(0, 10);
const today = new Date();
const weekAgo = new Date(today.getTime() - 6 * 864e5);

await step("auth is enforced (no token → 401)", async () => {
  const r = await fetch(`${base}/api/v1/members`);
  if (r.status !== 401) throw new Error(`expected 401, got ${r.status}`);
  return "";
});

await step("MCP initialize + tools/list", async () => {
  const headers = { ...auth, "Content-Type": "application/json", Accept: "application/json, text/event-stream" };
  const call = async (body: unknown) => {
    const r = await fetch(`${base}/api/mcp`, { method: "POST", headers, body: JSON.stringify(body) });
    const text = await r.text();
    const line = text.split("\n").find((l) => l.startsWith("data: "));
    return JSON.parse(line ? line.slice(6) : text);
  };
  const init = await call({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "smoke", version: "1" } } });
  const list = await call({ jsonrpc: "2.0", id: 2, method: "tools/list" });
  const names: string[] = list.result.tools.map((t: { name: string }) => t.name);
  const writes = names.filter((n) => /add_|update_|create_/.test(n));
  return `server ${init.result.serverInfo.name} ${init.result.serverInfo.version}; ${names.length} tools; write tools exposed: ${writes.length ? writes.join(", ") : "none (WRITES_ENABLED=false)"}`;
});

await step("open tickets", async () => {
  const r = await rest("tickets?limit=5");
  const rows = r.tickets.map((t: any) => `#${t.id} [${t.status?.name ?? "?"}] ${t.company?.name ?? ""} — ${String(t.summary).slice(0, 60)}`);
  return [`open ticket count: ${r.total}`, ...rows].join("\n");
});

await step("tickets entered in last 7 days (date condition check)", async () => {
  const r = await rest(`tickets?include_closed=true&entered_after=${iso(weekAgo)}&limit=1`);
  return `entered since ${iso(weekAgo)}: ${r.total}`;
});

await step("boards & priorities", async () => {
  const r = await rest("boards");
  return `${r.boards.length} boards (${r.boards.slice(0, 5).map((b: any) => b.name).join(", ")}${r.boards.length > 5 ? ", …" : ""}); ${r.priorities.length} priorities`;
});

await step("members", async () => {
  const r = await rest("members");
  return `${r.count} active members`;
});

await step("companies", async () => {
  const r = await rest("companies?limit=3");
  return r.companies.map((c: any) => `${c.id} ${c.name}`).join("; ");
});

await step("catalog", async () => {
  const r = await rest("catalog?limit=3");
  return `${r.count}${r.truncated ? "+" : ""} items, e.g. ${r.items.map((i: any) => i.sku).join(", ")}`;
});

if (member) {
  await step(`time entries for ${member}, ${iso(weekAgo)} → ${iso(today)}`, async () => {
    const r = await rest(`time-summary?member=${encodeURIComponent(member)}&start_date=${iso(weekAgo)}&end_date=${iso(today)}&group_by=day`);
    const days = r.groups.map((g: any) => `${g.key}: ${g.hours}h (billable ${g.billableHours}h)`);
    return [`total ${r.totals.hours}h — billable ${r.totals.billableHours}h, non-billable ${r.totals.nonBillableHours}h, ${r.totals.entries} entries`, ...days].join("\n");
  });
} else {
  console.log("… skipping time entries (set SMOKE_MEMBER to your ConnectWise member identifier)");
}

console.log(failures ? `\n${failures} check(s) failed` : "\nAll smoke checks passed");
process.exit(failures ? 1 : 0);
