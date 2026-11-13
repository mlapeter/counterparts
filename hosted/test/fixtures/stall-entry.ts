/**
 * Run as a CHILD by `loop-hold.test.ts`: a command through `main.ts`'s entry
 * point (`runEntry`) whose last await holds nothing open, the way a WB1
 * `migrate-keys` stalled under bun on Linux. Before the guard the process
 * exited 0 with nothing printed; it must exit 1 and say it stopped.
 *
 * `revived`: stderr's write callbacks come 1 s late, so the exit's wait for
 * stderr keeps the loop turning long enough for the command's wait to end. The
 * revived command must neither print its report nor change the exit code, and
 * its failure after that must not be told as one.
 */
import { runEntry } from "../../src/main.js";

const revived = process.argv[2] === "revived";
if (revived) {
  // Before runEntry, so its write tracking wraps this slow stderr.
  const write = process.stderr.write.bind(process.stderr) as (...args: unknown[]) => boolean;
  process.stderr.write = ((...args: unknown[]): boolean => {
    const cb = typeof args.at(-1) === "function" ? (args.pop() as (err?: Error | null) => void) : undefined;
    return write(...args, (err?: Error | null) => setTimeout(() => cb?.(err), 1000));
  }) as typeof process.stderr.write;
}

runEntry(async () => {
  // A wait nothing holds open: the event loop runs empty while this is pending.
  // 10 s unless revived, so a slow stderr write can't let "finished" land.
  await new Promise<void>((r) => setTimeout(r, revived ? 200 : 10_000).unref());
  process.stdout.write("finished\n");
  // Revived, it then fails: its rejection must not reach the entry point's handler either.
  if (revived) throw new Error("failed late");
});
