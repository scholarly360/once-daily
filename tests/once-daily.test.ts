import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  onceDaily,
  OnceDailyTask,
  todayInTimezone,
  memoryAdapter,
  fileAdapter,
} from "../src/index.js";
import type { StorageAdapter } from "../src/index.js";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

// ─── helpers ──────────────────────────────────────────────────────────────────

function fakeStore(initial: Record<string, string> = {}): StorageAdapter {
  const data = { ...initial };
  return {
    get: (key) => data[key] ?? null,
    set: (key, val) => { data[key] = val; },
  };
}

/** Freeze Date so todayInTimezone returns a deterministic value. */
function freezeDate(isoString: string) {
  vi.setSystemTime(new Date(isoString));
}

// ─── todayInTimezone ──────────────────────────────────────────────────────────

describe("todayInTimezone()", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("returns a YYYY-MM-DD string", () => {
    freezeDate("2026-04-03T12:00:00Z");
    const result = todayInTimezone("UTC");
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("returns correct UTC date", () => {
    freezeDate("2026-04-03T10:00:00Z");
    expect(todayInTimezone("UTC")).toBe("2026-04-03");
  });

  it("respects timezone offset — eastern night is still previous UTC day", () => {
    // 2026-04-03 23:30 in New York = 2026-04-04 03:30 UTC
    freezeDate("2026-04-04T03:30:00Z");
    expect(todayInTimezone("America/New_York")).toBe("2026-04-03");
    expect(todayInTimezone("UTC")).toBe("2026-04-04");
  });

  it("falls back gracefully for invalid timezone", () => {
    freezeDate("2026-04-03T12:00:00Z");
    // Should not throw; falls back to UTC
    expect(() => todayInTimezone("Not/ATimezone")).not.toThrow();
  });
});

// ─── onceDaily() ─────────────────────────────────────────────────────────────

describe("onceDaily()", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("runs the callback on first call and marks ran: true", async () => {
    freezeDate("2026-04-03T12:00:00Z");
    const cb = vi.fn().mockResolvedValue("hello");
    const result = await onceDaily("test-1", cb, { store: fakeStore() });
    expect(result.ran).toBe(true);
    expect(result.date).toBe("2026-04-03");
    expect(result.result).toBe("hello");
    expect(cb).toHaveBeenCalledOnce();
  });

  it("skips the callback on second call same day", async () => {
    freezeDate("2026-04-03T12:00:00Z");
    const cb = vi.fn().mockResolvedValue("x");
    const store = fakeStore();
    await onceDaily("test-2", cb, { store });
    const second = await onceDaily("test-2", cb, { store });
    expect(second.ran).toBe(false);
    expect(second.result).toBeUndefined();
    expect(cb).toHaveBeenCalledOnce();
  });

  it("runs again the next day", async () => {
    const store = fakeStore();
    const cb = vi.fn().mockResolvedValue(1);

    freezeDate("2026-04-03T12:00:00Z");
    await onceDaily("test-3", cb, { store });

    freezeDate("2026-04-04T12:00:00Z");
    const next = await onceDaily("test-3", cb, { store });
    expect(next.ran).toBe(true);
    expect(next.date).toBe("2026-04-04");
    expect(cb).toHaveBeenCalledTimes(2);
  });

  it("force: true runs even if already ran today", async () => {
    freezeDate("2026-04-03T12:00:00Z");
    const store = fakeStore();
    const cb = vi.fn().mockResolvedValue("forced");
    await onceDaily("test-4", cb, { store });
    const forced = await onceDaily("test-4", cb, { store, force: true });
    expect(forced.ran).toBe(true);
    expect(cb).toHaveBeenCalledTimes(2);
  });

  it("different keys are independent", async () => {
    freezeDate("2026-04-03T12:00:00Z");
    const store = fakeStore();
    const cbA = vi.fn().mockResolvedValue("a");
    const cbB = vi.fn().mockResolvedValue("b");
    await onceDaily("key-a", cbA, { store });
    await onceDaily("key-b", cbB, { store });
    // second calls — only skipped for their own key
    const a2 = await onceDaily("key-a", cbA, { store });
    const b2 = await onceDaily("key-b", cbB, { store });
    expect(a2.ran).toBe(false);
    expect(b2.ran).toBe(false);
    expect(cbA).toHaveBeenCalledOnce();
    expect(cbB).toHaveBeenCalledOnce();
  });

  it("awaits async callback before marking run", async () => {
    freezeDate("2026-04-03T12:00:00Z");
    const order: string[] = [];
    const cb = async () => {
      order.push("start");
      await Promise.resolve();
      order.push("end");
    };
    await onceDaily("test-5", cb, { store: fakeStore() });
    expect(order).toEqual(["start", "end"]);
  });

  it("does not swallow callback errors", async () => {
    freezeDate("2026-04-03T12:00:00Z");
    const cb = vi.fn().mockRejectedValue(new Error("boom"));
    await expect(onceDaily("test-6", cb, { store: fakeStore() }))
      .rejects.toThrow("boom");
  });

  it("does not record the run if callback throws", async () => {
    freezeDate("2026-04-03T12:00:00Z");
    const store = fakeStore();
    const cb = vi.fn()
      .mockRejectedValueOnce(new Error("fail"))
      .mockResolvedValueOnce("ok");

    await onceDaily("test-7", cb, { store }).catch(() => {});
    // should try again since the first attempt was not recorded
    const retry = await onceDaily("test-7", cb, { store });
    expect(retry.ran).toBe(true);
    expect(cb).toHaveBeenCalledTimes(2);
  });

  it("uses a pre-seeded store correctly", async () => {
    freezeDate("2026-04-03T12:00:00Z");
    const store = fakeStore({ "pre-seeded": "2026-04-03" });
    const cb = vi.fn();
    const result = await onceDaily("pre-seeded", cb, { store });
    expect(result.ran).toBe(false);
    expect(cb).not.toHaveBeenCalled();
  });

  it("default store is memory (no options needed)", async () => {
    freezeDate("2026-04-03T12:00:00Z");
    const cb = vi.fn().mockResolvedValue(42);
    const result = await onceDaily("no-opts", cb);
    expect(result.ran).toBe(true);
    expect(result.result).toBe(42);
  });
});

// ─── OnceDailyTask ────────────────────────────────────────────────────────────

describe("OnceDailyTask", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("run() behaves like onceDaily()", async () => {
    freezeDate("2026-04-03T12:00:00Z");
    const cb = vi.fn().mockResolvedValue("task-result");
    const task = new OnceDailyTask("task-1", cb, { store: fakeStore() });
    const r1 = await task.run();
    expect(r1.ran).toBe(true);
    expect(r1.result).toBe("task-result");
    const r2 = await task.run();
    expect(r2.ran).toBe(false);
    expect(cb).toHaveBeenCalledOnce();
  });

  it("run(true) forces execution", async () => {
    freezeDate("2026-04-03T12:00:00Z");
    const cb = vi.fn().mockResolvedValue("x");
    const task = new OnceDailyTask("task-2", cb, { store: fakeStore() });
    await task.run();
    await task.run(true);
    expect(cb).toHaveBeenCalledTimes(2);
  });

  it("hasRunToday() returns false before run, true after", async () => {
    freezeDate("2026-04-03T12:00:00Z");
    const task = new OnceDailyTask("task-3", vi.fn(), { store: fakeStore() });
    expect(await task.hasRunToday()).toBe(false);
    await task.run();
    expect(await task.hasRunToday()).toBe(true);
  });

  it("reset() causes the next run() to execute", async () => {
    freezeDate("2026-04-03T12:00:00Z");
    const cb = vi.fn().mockResolvedValue(1);
    const task = new OnceDailyTask("task-4", cb, { store: fakeStore() });
    await task.run();
    await task.reset();
    const r = await task.run();
    expect(r.ran).toBe(true);
    expect(cb).toHaveBeenCalledTimes(2);
  });

  it("lastRunDate() returns null before first run", async () => {
    freezeDate("2026-04-03T12:00:00Z");
    const task = new OnceDailyTask("task-5", vi.fn(), { store: fakeStore() });
    expect(await task.lastRunDate()).toBeNull();
  });

  it("lastRunDate() returns date string after run", async () => {
    freezeDate("2026-04-03T12:00:00Z");
    const task = new OnceDailyTask("task-6", vi.fn(), { store: fakeStore() });
    await task.run();
    expect(await task.lastRunDate()).toBe("2026-04-03");
  });
});

// ─── memoryAdapter ────────────────────────────────────────────────────────────

describe("memoryAdapter()", () => {
  it("returns null for unknown keys", () => {
    const store = memoryAdapter();
    expect(store.get("nope")).toBeNull();
  });

  it("stores and retrieves values", () => {
    const store = memoryAdapter();
    store.set("k", "2026-04-03");
    expect(store.get("k")).toBe("2026-04-03");
  });

  it("different adapter instances do not share state", () => {
    const a = memoryAdapter();
    const b = memoryAdapter();
    a.set("x", "2026-04-03");
    expect(b.get("x")).toBeNull();
  });
});

// ─── fileAdapter ──────────────────────────────────────────────────────────────

describe("fileAdapter()", () => {
  let tmpFile: string;

  beforeEach(() => {
    tmpFile = path.join(os.tmpdir(), `once-daily-test-${Date.now()}.json`);
  });

  afterEach(() => {
    try { fs.unlinkSync(tmpFile); } catch { /* ok */ }
  });

  it("returns null for missing key on fresh file", () => {
    const store = fileAdapter({ path: tmpFile });
    expect(store.get("missing")).toBeNull();
  });

  it("stores and retrieves a value", () => {
    const store = fileAdapter({ path: tmpFile });
    store.set("job", "2026-04-03");
    expect(store.get("job")).toBe("2026-04-03");
  });

  it("persists across new adapter instances pointing to the same file", () => {
    fileAdapter({ path: tmpFile }).set("job", "2026-04-03");
    expect(fileAdapter({ path: tmpFile }).get("job")).toBe("2026-04-03");
  });

  it("stores multiple keys in one file", () => {
    const store = fileAdapter({ path: tmpFile });
    store.set("a", "2026-04-01");
    store.set("b", "2026-04-02");
    expect(store.get("a")).toBe("2026-04-01");
    expect(store.get("b")).toBe("2026-04-02");
  });

  it("handles corrupted JSON file gracefully", () => {
    fs.writeFileSync(tmpFile, "not json", "utf8");
    const store = fileAdapter({ path: tmpFile });
    expect(store.get("k")).toBeNull(); // treats as empty store
    expect(() => store.set("k", "2026-04-03")).not.toThrow();
  });
});
