#!/usr/bin/env node
// Blocks commits that contain likely secrets. Scans staged files by default,
// or every tracked file with --all. Zero dependencies.
import { execSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";

const all = process.argv.includes("--all");
const files = execSync(all ? "git ls-files" : "git diff --cached --name-only --diff-filter=ACMR", { encoding: "utf8" })
  .split("\n")
  .filter(Boolean);

const PATTERNS = [
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, "private key block"],
  [/\b(AKIA|ASIA)[A-Z0-9]{16}\b/, "AWS access key"],
  [/\bgh[pousr]_[A-Za-z0-9]{36,}\b/, "GitHub token"],
  [/\bsk-(ant-|proj-)?[A-Za-z0-9_-]{20,}\b/, "API secret key"],
  [/\bxox[abpr]-[A-Za-z0-9-]{10,}\b/, "Slack token"],
  [/\bvercel_[A-Za-z0-9]{20,}\b/i, "Vercel token"],
  [/Authorization:\s*Basic\s+[A-Za-z0-9+/]{16,}={0,2}/, "hardcoded Basic auth header"],
  [/\b(CW_PRIVATE_KEY|CW_PUBLIC_KEY|CW_CLIENT_ID|CW_COMPANY_ID|BRIDGE_API_TOKEN)\s*[=:]\s*["']?[A-Za-z0-9+/_-]{8,}/, "env secret assignment"],
];

const SKIP = [/^package-lock\.json$/, /\.(png|jpg|ico|woff2?)$/];
let found = 0;
for (const f of files) {
  if (SKIP.some((r) => r.test(f)) || !existsSync(f)) continue;
  if (/(^|\/)\.env(\..*)?$/.test(f) && !f.endsWith(".env.example")) {
    console.error(`✘ ${f}: env file must never be committed`);
    found++;
    continue;
  }
  const text = readFileSync(f, "utf8");
  text.split("\n").forEach((line, n) => {
    for (const [re, label] of PATTERNS) {
      if (re.test(line)) {
        console.error(`✘ ${f}:${n + 1}: possible ${label}`);
        found++;
      }
    }
  });
}
if (found) {
  console.error(`\nSecret scan failed (${found} finding${found > 1 ? "s" : ""}). Remove the secret; if it was ever pushed, rotate it.`);
  process.exit(1);
}
console.log(`secret-scan: ${files.length} file(s) clean`);
