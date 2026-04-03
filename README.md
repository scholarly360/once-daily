# once-daily

Run a callback at most once per calendar day. Pluggable storage: memory, file, or Redis. Zero dependencies.

```ts
import { onceDaily } from "once-daily";

await onceDaily("send-digest", sendEmailDigest);
// → runs sendEmailDigest and records today's date

await onceDaily("send-digest", sendEmailDigest);
// → { ran: false } — already ran today, callback skipped
```

## Install

```sh
npm install once-daily
```

---

## API

### `onceDaily(key, callback, options?)`

Runs `callback` if it hasn't run today for `key`. Returns a `RunResult`.

```ts
async function onceDaily<T>(
  key: string,
  callback: () => T | Promise<T>,
  options?: OnceDailyOptions
): Promise<RunResult & { result?: T }>
```

**Returns:**

| Field | Type | Description |
|-------|------|-------------|
| `ran` | `boolean` | `true` if the callback executed this call |
| `date` | `string` | The `YYYY-MM-DD` date string that was recorded |
| `result` | `T \| undefined` | The callback's return value (only set when `ran: true`) |

**Options:**

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `store` | `StorageAdapter` | `memoryAdapter()` | Where last-run dates are persisted |
| `timezone` | `string` | `"UTC"` | IANA timezone name for determining the current day |
| `force` | `boolean` | `false` | Run even if already ran today |

---

### `OnceDailyTask`

A stateful class that holds its own store and options — useful when you have many named tasks sharing one adapter.

```ts
import { OnceDailyTask, fileAdapter } from "once-daily";

const task = new OnceDailyTask("send-digest", sendEmailDigest, {
  store: fileAdapter(),
  timezone: "America/New_York",
});

await task.run();             // runs if not yet run today
await task.run(true);         // force: runs regardless
await task.hasRunToday();     // → boolean
await task.lastRunDate();     // → "2026-04-03" | null
await task.reset();           // clear record so it runs again next call
```

---

## Storage adapters

### `memoryAdapter()` — default

In-process memory. Zero dependencies. Resets when the process restarts.
Best for scripts, lambdas, or tests.

```ts
import { onceDaily, memoryAdapter } from "once-daily";

await onceDaily("job", run, { store: memoryAdapter() });
```

---

### `fileAdapter(options?)` — persist across restarts

Reads and writes a single JSON file. Best for long-running single-process servers or CLI tools.

```ts
import { onceDaily, fileAdapter } from "once-daily";

await onceDaily("job", run, {
  store: fileAdapter({ path: "./.cache/daily-runs.json" }),
});
```

`path` defaults to `.once-daily.json` in the current working directory.

The JSON file looks like:

```json
{
  "send-digest": "2026-04-03",
  "generate-report": "2026-04-02"
}
```

---

### `redisAdapter(client)` — distributed / multi-process

Works with any Redis client that exposes `get` and `set` — ioredis, node-redis, Upstash, etc.
Best for horizontally-scaled deployments where multiple processes must share state.

```ts
import { createClient } from "redis";
import { onceDaily, redisAdapter } from "once-daily";

const redis = createClient();
await redis.connect();

await onceDaily("job", run, {
  store: redisAdapter(redis),
});
```

Keys are namespaced automatically as `once-daily:<key>` to avoid collisions.

---

### Custom adapter

Implement `StorageAdapter` to use any backend — SQLite, DynamoDB, a plain object, etc.

```ts
import type { StorageAdapter } from "once-daily";

const myAdapter: StorageAdapter = {
  async get(key) {
    return db.get(`once_daily_${key}`);
  },
  async set(key, date) {
    await db.set(`once_daily_${key}`, date);
  },
};
```

`get` and `set` may be sync or async — both are supported.

---

## Timezones

By default, "today" is determined in UTC. Pass an IANA timezone name to use a different rollover point.

```ts
// Rolls over at midnight New York time, not UTC.
await onceDaily("morning-brief", run, {
  store: fileAdapter(),
  timezone: "America/New_York",
});
```

This matters near midnight: at 11:30 PM New York time it's still "today" in New York even though UTC has already flipped to tomorrow.

Valid timezone names: any entry from the [IANA Time Zone Database](https://en.wikipedia.org/wiki/List_of_tz_database_time_zones) — `"Europe/London"`, `"Asia/Tokyo"`, `"Australia/Sydney"`, etc.

---

## Recipes

### Skip gracefully without throwing

```ts
const { ran } = await onceDaily("report", generateReport, { store: fileAdapter() });
if (!ran) {
  console.log("Report already generated today — skipping.");
}
```

### Use the callback's return value

```ts
const { ran, result } = await onceDaily("fetch-rates", fetchExchangeRates, {
  store: fileAdapter(),
});

if (ran) {
  await saveRates(result); // result is typed as the return type of fetchExchangeRates
}
```

### Force a re-run (e.g. in a CLI --force flag)

```ts
const force = process.argv.includes("--force");
await onceDaily("job", run, { store: fileAdapter(), force });
```

### Multiple tasks sharing one file adapter

```ts
import { OnceDailyTask, fileAdapter } from "once-daily";

const store = fileAdapter({ path: ".daily-tasks.json" });

const digest  = new OnceDailyTask("digest",  sendDigest,  { store });
const report  = new OnceDailyTask("report",  buildReport, { store });
const cleanup = new OnceDailyTask("cleanup", pruneOldFiles, { store });

await Promise.all([digest.run(), report.run(), cleanup.run()]);
```

All three tasks share one JSON file. Each key is independent.

### Check status without running

```ts
const task = new OnceDailyTask("digest", sendDigest, { store: fileAdapter() });

if (await task.hasRunToday()) {
  console.log("Already sent today.");
} else {
  await task.run();
}
```

### Reset from a script

```ts
// reset-daily.ts — run this to force the next invocation to execute
import { OnceDailyTask, fileAdapter } from "once-daily";

const task = new OnceDailyTask("send-digest", () => {}, { store: fileAdapter() });
await task.reset();
console.log("Reset. Next run will execute the task.");
```

### Serverless / Lambda — use Redis to coordinate across cold starts

```ts
import { Redis } from "@upstash/redis";
import { onceDaily, redisAdapter } from "once-daily";

const redis = new Redis({ url: process.env.UPSTASH_URL!, token: process.env.UPSTASH_TOKEN! });

export const handler = async () => {
  const { ran } = await onceDaily("daily-sync", syncData, {
    store: redisAdapter(redis),
    timezone: "America/Chicago",
  });
  return { statusCode: 200, body: ran ? "ran" : "skipped" };
};
```

---

## Error behaviour

If the callback throws, the run is **not recorded**. The next call will try again. This is intentional — once-daily gives you at-least-once semantics, not at-most-once. If your task failed, you want it to retry next time, not be silently skipped.

```ts
// First call: callback throws → date is NOT written
await onceDaily("job", () => { throw new Error("oops"); }, { store });
// → throws Error("oops")

// Second call: tries again because the first run wasn't recorded
await onceDaily("job", workingCallback, { store });
// → { ran: true, date: "2026-04-03" }
```

---

## License

MIT
