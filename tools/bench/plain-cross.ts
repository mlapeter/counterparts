/**
 * Bench (SO1 step 3, round 3 of #780): what the plain-reminder delivery costs per
 * call on a store with a few thousand dated rows. Hermetic: a temp store it makes
 * and removes. Run: `bun tools/bench/plain-cross.ts`. Prints p50/p90 ms for a
 * prompt's plain read (which never crosses), a session start's (which may), and
 * the crossing's own read with nothing to cross and with unsaid items.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { openAdapter } from "../../src/adapters/claude-code/index.js";
import { PLAIN_CROSS_NONE_KEY } from "../../src/core/counterpart.js";
import { addDays } from "../../src/core/time.js";

const root = mkdtempSync(join(tmpdir(), "cp-bench-"));
try {
  const dir = join(root, "store");
  const a = openAdapter({ dataDir: dir, injectionBudgetBytes: 20_000 }, { command: "/bin/true", args: ["runner"], spawner: () => ({ pid: 1 }) });
  const c = a.counterpart;
  const today = c.store.today();
  const put = (i: number, date: string, plain: boolean, scope: string): void => {
    c.store.put({ type: "memory", kind: "fact", body: `Dated thing ${String(i)} with some words in it.`, title: `Dated ${String(i)}`, eventDate: date, learnedOn: addDays(date, -5), about: "work", ...(plain ? { meta: { remind: "plain" } } : {}), salience: { relevance: 0.5, emotional: 0.2, predictive: 0.4 }, origin: { session: "s", scope } });
  };
  // 3,000 dated rows over two years, a tenth of them plain, all long past; a month of session starts.
  for (let i = 0; i < 3000; i++) put(i, addDays(today, -(i % 730) - 40), i % 10 === 0, "/x/garden");
  for (let d = 1; d <= 30; d++) c.store.appendEvent({ name: "adapter.wake.injected", day: c.store.livedDay(), payload: { date: addDays(today, -d), session: `s${String(d)}`, interactive: true, folder: "/x/bakery" } });
  const time = (label: string, f: () => unknown, n = 60, before?: () => void): void => {
    const ms: number[] = [];
    for (let i = 0; i < n; i++) {
      before?.();
      const t = performance.now();
      f();
      ms.push(performance.now() - t);
    }
    ms.sort((x, y) => x - y);
    console.log(`${label}: p50 ${(ms[Math.floor(n / 2)] ?? 0).toFixed(2)} ms, p90 ${(ms[Math.floor(n * 0.9)] ?? 0).toFixed(2)} ms`);
  };
  const input = { sessionId: "bench-1", scope: "/x/bakery", at: today, prompt: "hi" };
  const lc = a as unknown as { plainFor(i: unknown, o?: unknown): unknown };
  const forget = (): void => c.store.setMeta(PLAIN_CROSS_NONE_KEY, "");
  time("prompt plainFor (no crossing read)", () => lc.plainFor(input));
  time("start plainFor, nothing to cross, first of the day", () => lc.plainFor(input, { cross: true }), 60, forget);
  time("start plainFor, nothing to cross, memoised", () => lc.plainFor(input, { cross: true }));
  for (let i = 0; i < 5; i++) put(10_000 + i, addDays(today, -3 - i), true, "/x/garden");
  const lived = (): ReadonlySet<string> => new Set([addDays(today, -1), addDays(today, -2)]);
  time("crossing read, 5 unsaid (unclaimed, so not memoised)", () => c.plainCrossing({ at: today, lived }), 60, forget);
  time("crossing read, nothing unsaid, first of the day", () => c.plainCrossing({ at: addDays(today, 400), lived }), 60, forget);
  time("prompt plainFor, 5 unsaid", () => lc.plainFor(input));
  c.close();
} finally {
  rmSync(root, { recursive: true, force: true });
}
