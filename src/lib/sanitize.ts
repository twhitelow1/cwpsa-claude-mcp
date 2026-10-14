/** Strip HTML tags/entities and collapse whitespace. */
export function stripHtml(input: unknown): string {
  if (typeof input !== "string") return "";
  return input
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|tr)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n")
    .trim();
}

export function truncate(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max)}… [truncated ${s.length - max} chars]`;
}

export function clean(input: unknown, max = 2000): string {
  return truncate(stripHtml(input), max);
}

/** Remove undefined/null/empty values so JSON output stays compact. */
export function compact<T extends Record<string, unknown>>(obj: T): Partial<T> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null || v === "") continue;
    out[k] = v;
  }
  return out as Partial<T>;
}

/** Shorten CW references {id, name, identifier, _info} to a compact form. */
export function ref(r: unknown): { id: number; name?: string } | undefined {
  if (!r || typeof r !== "object") return undefined;
  const o = r as Record<string, unknown>;
  if (typeof o.id !== "number") return undefined;
  const name = (o.name ?? o.identifier) as string | undefined;
  return name ? { id: o.id, name } : { id: o.id };
}
