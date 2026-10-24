import type { Env } from "./config";
import { ConfigError } from "./config";
import { UpstreamError } from "./http";

/**
 * Key-value store for id links (IO ↔ GHL) and the last-synced snapshot of each record.
 * Production uses Upstash Redis over REST: add it from the Vercel Marketplace, which
 * injects KV_REST_API_URL / KV_REST_API_TOKEN. Tests use MemoryStore.
 */
export interface Store {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSec?: number): Promise<void>;
  /** Set only if absent. Returns true if this caller got it (used as a short lock). */
  setNx(key: string, value: string, ttlSec: number): Promise<boolean>;
  del(key: string): Promise<void>;
}

export class MemoryStore implements Store {
  readonly data = new Map<string, { v: string; exp?: number }>();
  async get(key: string) {
    const e = this.data.get(key);
    if (!e) return null;
    if (e.exp && e.exp < Date.now()) {
      this.data.delete(key);
      return null;
    }
    return e.v;
  }
  async set(key: string, value: string, ttlSec?: number) {
    this.data.set(key, { v: value, exp: ttlSec ? Date.now() + ttlSec * 1000 : undefined });
  }
  async setNx(key: string, value: string, ttlSec: number) {
    if ((await this.get(key)) !== null) return false;
    await this.set(key, value, ttlSec);
    return true;
  }
  async del(key: string) {
    this.data.delete(key);
  }
}

export class UpstashStore implements Store {
  constructor(
    private readonly url: string,
    private readonly token: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private async cmd<T>(...args: (string | number)[]): Promise<T> {
    const res = await this.fetchImpl(this.url, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.token}`, "Content-Type": "application/json" },
      body: JSON.stringify(args),
    });
    if (!res.ok) throw new UpstreamError("store", res.status, `Store command ${String(args[0])} failed: ${res.status}`);
    return ((await res.json()) as { result: T }).result;
  }

  async get(key: string) {
    return this.cmd<string | null>("GET", key);
  }
  async set(key: string, value: string, ttlSec?: number) {
    if (ttlSec) await this.cmd("SET", key, value, "EX", ttlSec);
    else await this.cmd("SET", key, value);
  }
  async setNx(key: string, value: string, ttlSec: number) {
    return (await this.cmd<string | null>("SET", key, value, "NX", "EX", ttlSec)) === "OK";
  }
  async del(key: string) {
    await this.cmd("DEL", key);
  }
}

let memoryFallback: MemoryStore | undefined;

export function getStore(env: Env = process.env): Store {
  const url = env.KV_REST_API_URL ?? env.UPSTASH_REDIS_REST_URL;
  const token = env.KV_REST_API_TOKEN ?? env.UPSTASH_REDIS_REST_TOKEN;
  if (url && token) return new UpstashStore(url.replace(/\/+$/, ""), token);
  // Without a durable store, links are lost between invocations, so records would duplicate.
  if (env.NODE_ENV === "production") throw new ConfigError("No store configured (add Upstash Redis: KV_REST_API_URL / KV_REST_API_TOKEN)");
  return (memoryFallback ??= new MemoryStore());
}

export async function getJson<T>(store: Store, key: string): Promise<T | null> {
  const raw = await store.get(key);
  if (raw === null) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export const setJson = (store: Store, key: string, value: unknown, ttlSec?: number) => store.set(key, JSON.stringify(value), ttlSec);
