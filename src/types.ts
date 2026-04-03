/** ISO 8601 date string, e.g. "2026-04-03" */
export type DateString = string;

/**
 * A storage adapter tells once-daily how to persist "last-run" dates.
 * Implement this interface to plug in any backend.
 */
export interface StorageAdapter {
  /** Return the last-run date string for the given key, or null if never run. */
  get(key: string): Promise<DateString | null> | DateString | null;
  /** Persist a last-run date string for the given key. */
  set(key: string, date: DateString): Promise<void> | void;
}

export interface FileAdapterOptions {
  /**
   * Path to the JSON file used as the store.
   * Defaults to `.once-daily.json` in the current working directory.
   */
  path?: string;
}

export interface RedisLike {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<unknown>;
}

export interface OnceDailyOptions {
  /**
   * Storage adapter. Defaults to in-memory storage.
   * Use `fileAdapter` for persistence across process restarts,
   * or `redisAdapter` for distributed environments.
   */
  store?: StorageAdapter;

  /**
   * IANA timezone name used to determine when a "new day" starts.
   * Defaults to "UTC".
   * @example "America/New_York", "Europe/London", "Asia/Tokyo"
   */
  timezone?: string;

  /**
   * If true, the callback runs even if it already ran today.
   * @default false
   */
  force?: boolean;
}

export interface RunResult {
  /** Whether the callback was executed on this call. */
  ran: boolean;
  /** ISO date string of the day that was recorded (or already recorded). */
  date: DateString;
}
