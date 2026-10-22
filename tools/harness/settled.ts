/**
 * SETTLED THINGS, ON A RUN'S STORE (2026-10-22, lane R): the console's
 * measure (`settledReading`, the `./cli` seam) read over the whole record a
 * run leaves — every settled pair, everything after its settle day — for the
 * run's record and the compare table. The same function the console calls,
 * so the two cannot disagree about what counts.
 *
 * In a physics-only replay it mostly reads 0: no session draws on anything
 * and no dream flags anything new. It earns its keep in model-seat runs
 * (`night --model`, `week`), where sessions and dreams are written fresh.
 */
import { Store } from "../../src/core/store/index.js";
import { settledReading } from "../../src/adapters/cli/commands.js";
import type { SettledReading } from "../../src/adapters/cli/commands.js";

/** The reading, or null when the store will not open as an observer (the record says so by the null). */
export function settledOf(dir: string): SettledReading | null {
  let store: Store;
  try {
    store = Store.open({ dir, observer: true });
  } catch {
    return null;
  }
  try {
    // `today` only names the reading's end: the whole record is read.
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: store.zone() }).format(Date.now());
    return settledReading(store, today, "all");
  } catch {
    return null;
  } finally {
    store.close();
  }
}
