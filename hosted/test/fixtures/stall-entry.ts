/**
 * Run as a CHILD by `loop-hold.test.ts`: a command through `main.ts`'s entry
 * point (`runEntry`) whose last await holds nothing open, the way a WB1
 * `migrate-keys` stalled under bun on Linux. Before the guard the process
 * exited 0 with nothing printed; it must exit 1 and say it stopped.
 */
import { runEntry } from "../../src/main.js";

runEntry(async () => {
  // A wait nothing holds open: the event loop runs empty while this is pending.
  await new Promise<void>((r) => setTimeout(r, 200).unref());
  process.stdout.write("finished\n");
});
