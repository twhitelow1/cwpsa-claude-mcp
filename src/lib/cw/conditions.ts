/**
 * Builders for ConnectWise `conditions` strings. All user-supplied values go
 * through these helpers so quoting/escaping is never done by hand.
 *
 * CW syntax: strings in double quotes (escape \ and "), numbers bare,
 * booleans true/false, datetimes in [square brackets], `like` uses % wildcards.
 */

const FIELD_RE = /^[A-Za-z_][A-Za-z0-9_]*(\/[A-Za-z_][A-Za-z0-9_]*)*$/;

function field(name: string): string {
  if (!FIELD_RE.test(name)) throw new Error(`Invalid condition field: ${name}`);
  return name;
}

export function quote(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/** CW has no escape for LIKE wildcards, so strip them from user text. */
function likeText(value: string): string {
  return value.replace(/[%*]/g, " ").trim();
}

export function cwDate(value: string | Date): string {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) throw new Error(`Invalid date: ${String(value)}`);
  return `[${d.toISOString().replace(/\.\d{3}Z$/, "Z")}]`;
}

type Op = "=" | "!=" | "<" | "<=" | ">" | ">=";

export const cond = {
  eq: (f: string, v: string | number | boolean) => `${field(f)} = ${lit(v)}`,
  ne: (f: string, v: string | number | boolean) => `${field(f)} != ${lit(v)}`,
  cmp: (f: string, op: Op, v: string | number) => `${field(f)} ${op} ${lit(v)}`,
  contains: (f: string, text: string) => `${field(f)} like ${quote(`%${likeText(text)}%`)}`,
  startsWith: (f: string, text: string) => `${field(f)} like ${quote(`${likeText(text)}%`)}`,
  dateGte: (f: string, d: string | Date) => `${field(f)} >= ${cwDate(d)}`,
  dateLt: (f: string, d: string | Date) => `${field(f)} < ${cwDate(d)}`,
  in: (f: string, values: number[]) => {
    if (!values.every((v) => Number.isInteger(v))) throw new Error("in() only accepts integer ids");
    return `${field(f)} in (${values.join(",")})`;
  },
};

function lit(v: string | number | boolean): string {
  if (typeof v === "number") {
    if (!Number.isFinite(v)) throw new Error("Non-finite number in condition");
    return String(v);
  }
  if (typeof v === "boolean") return v ? "true" : "false";
  return quote(v);
}

export function and(...parts: (string | undefined | false | null | 0)[]): string | undefined {
  const p = parts.filter((x): x is string => typeof x === "string" && x.length > 0);
  if (p.length === 0) return undefined;
  // or() already parenthesises its output, so plain joining keeps precedence correct.
  return p.join(" and ");
}

export function or(...parts: (string | undefined | false | null | 0)[]): string | undefined {
  const p = parts.filter((x): x is string => typeof x === "string" && x.length > 0);
  if (p.length === 0) return undefined;
  return p.length === 1 ? p[0] : `(${p.join(" or ")})`;
}
