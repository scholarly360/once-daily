import type { OnceDailyOptions, RunResult, StorageAdapter } from "./types.js";
import { memoryAdapter } from "./adapters.js";

// ─── Date helpers ─────────────────────────────────────────────────────────────

/**
 * Returns today's date string (YYYY-MM-DD) in the given IANA timezone.
 * Falls back to UTC for environments without full Intl support.
 */
export function todayInTimezone(timezone: string): string {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
  } catch {
    // en-CA locale produces "YYYY-MM-DD" natively — no string munging needed.
    return new Intl.DateTimeFormat("en-CA", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
  }
}

// ─── Core ─────────────────────────────────────────────────────────────────────

/**
 * Run `callback` at most once per calendar day for the given `key`.
 *
 * Returns a `RunResult` describing whether the callback ran and which date
 * was recorded.
 *
 * @example
 * // Runs sendDigest at most once per UTC day.
 * const { ran } = await onceDaily("send-digest", sendDigest);
 * if (!ran) console.log("Already ran today — skipping.");
 *
 * @example
 * // Persist state across restarts with the file adapter.
 * import { fileAdapter } from "once-daily";
 * await onceDaily("daily-report", generateReport, {
 *   store: fileAdapter(),
 *   timezone: "America/New_York",
 * });
 */
export async function onceDaily<T>(
  key: string,
  callback: () => T | Promise<T>,
  options: OnceDailyOptions = {}
): Promise<RunResult & { result?: T }> {
  const {
    store = memoryAdapter(),
    timezone = "UTC",
    force = false,
  } = options;

  const today = todayInTimezone(timezone);
  const lastRun = await store.get(key);

  if (!force && lastRun === today) {
    return { ran: false, date: today };
  }

  const result = await callback();
  await store.set(key, today);

  return { ran: true, date: today, result };
}

// ─── Class API ────────────────────────────────────────────────────────────────

/**
 * Stateful task wrapper — holds its own store so you don't pass options
 * on every call. Useful when you have many named tasks sharing one adapter.
 *
 * @example
 * import { OnceDailyTask, fileAdapter } from "once-daily";
 *
 * const task = new OnceDailyTask("send-digest", sendDigest, {
 *   store: fileAdapter(),
 *   timezone: "Europe/London",
 * });
 *
 * await task.run();        // runs if not yet run today
 * await task.reset();      // clears the record so it will run again
 * const ran = await task.hasRunToday(); // check without running
 */
export class OnceDailyTask<T = unknown> {
  private readonly key: string;
  private readonly callback: () => T | Promise<T>;
  private readonly store: StorageAdapter;
  private readonly timezone: string;

  constructor(
    key: string,
    callback: () => T | Promise<T>,
    options: Omit<OnceDailyOptions, "force"> = {}
  ) {
    this.key = key;
    this.callback = callback;
    this.store = options.store ?? memoryAdapter();
    this.timezone = options.timezone ?? "UTC";
  }

  /** Run the callback if it hasn't run today. */
  async run(force = false): Promise<RunResult & { result?: T }> {
    return onceDaily(this.key, this.callback, {
      store: this.store,
      timezone: this.timezone,
      force,
    });
  }

  /** Returns true if the callback has already run today. */
  async hasRunToday(): Promise<boolean> {
    const today = todayInTimezone(this.timezone);
    const lastRun = await this.store.get(this.key);
    return lastRun === today;
  }

  /** Clear the stored date so the task will run again on the next call. */
  async reset(): Promise<void> {
    // Store has no delete — set to an impossible past date to invalidate.
    await this.store.set(this.key, "1970-01-01");
  }

  /** Return the date string of the last run, or null if never run. */
  async lastRunDate(): Promise<string | null> {
    return this.store.get(this.key);
  }
}
