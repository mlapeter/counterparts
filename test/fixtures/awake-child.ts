/**
 * A REAL WAITER FOR A STUCK CHILD, for `night-holes.test.ts` and `node-smoke.ts`: one
 * `startChild` over a `sleep` that never ends by itself, under a short watchdog, with a
 * short tick and gap. Says "ready" when it starts and, at the end, what became of it.
 *
 *   <runtime> test/fixtures/awake-child.ts <watchdog ms> <tick ms> <gap ms>
 */
import { startChild } from "../../src/adapters/claude-code/child.js";

const [watchdog, tickMs, gapMs] = process.argv.slice(2).map(Number) as [number, number, number];
const at = Date.now();
process.stdout.write("ready\n");
const out = await startChild(
  { command: "sleep", args: ["60"], stdin: "", env: { PATH: process.env["PATH"] ?? "/usr/bin:/bin" }, timeoutMs: watchdog },
  undefined,
  { tickMs, gapMs },
);
process.stdout.write(`${JSON.stringify({ ms: Date.now() - at, timedOut: out.timedOut, error: out.error })}\n`);
process.exit(0);
