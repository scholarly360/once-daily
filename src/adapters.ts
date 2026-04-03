import type { StorageAdapter, DateString, FileAdapterOptions, RedisLike } from "./types.js";
import { readFileSync, writeFileSync } from "node:fs";

// ─── Memory adapter (default) ────────────────────────────────────────────────

/**
 * In-memory adapter. Fast, zero deps, but resets on process restart.
 * This is the default when no `store` option is provided.
 */
export function memoryAdapter(): StorageAdapter {
  const store = new Map<string, DateString>();
  return {
    get: (key) => store.get(key) ?? null,
    set: (key, date) => { store.set(key, date); },
  };
}

// ─── File adapter ─────────────────────────────────────────────────────────────

/**
 * File-backed adapter. Persists across process restarts.
 * Reads/writes a single JSON file — suitable for single-process deployments.
 *
 * @example
 * import { onceDaily, fileAdapter } from "once-daily";
 * await onceDaily("digest", send, { store: fileAdapter({ path: "./.cache/daily.json" }) });
 */
export function fileAdapter(options: FileAdapterOptions = {}): StorageAdapter {
  const filePath = options.path ?? ".once-daily.json";

  function read(): Record<string, DateString> {
    try {
      return JSON.parse(readFileSync(filePath, "utf8")) as Record<string, DateString>;
    } catch {
      return {};
    }
  }

  return {
    get(key) {
      return read()[key] ?? null;
    },
    set(key, date) {
      const data = read();
      data[key] = date;
      writeFileSync(filePath, JSON.stringify(data, null, 2), "utf8");
    },
  };
}

// ─── Redis adapter ────────────────────────────────────────────────────────────

/**
 * Redis-backed adapter for distributed / multi-process deployments.
 * Accepts any Redis client that exposes a `get` / `set` interface
 * (ioredis, node-redis, Upstash, etc.).
 *
 * @example
 * import { createClient } from "redis";
 * import { onceDaily, redisAdapter } from "once-daily";
 *
 * const client = createClient();
 * await client.connect();
 * await onceDaily("digest", send, { store: redisAdapter(client) });
 */
export function redisAdapter(client: RedisLike): StorageAdapter {
  return {
    async get(key) {
      return client.get(`once-daily:${key}`);
    },
    async set(key, date) {
      await client.set(`once-daily:${key}`, date);
    },
  };
}
