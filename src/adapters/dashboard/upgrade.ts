/**
 * A store waiting for its one-time schema upgrade, as the dashboard meets it.
 * Its own small module so the terminal views can say the sentence without
 * loading the web server.
 */
import { SCHEMA_VERSION, isStoreError } from "../../core/store/index.js";

/**
 * A store on an OLDER schema this build can upgrade (v6 up): an observer meets
 * it as `STORE_UNINITIALIZED` with a `found` version, and it is waiting for the
 * first Claude Code session to copy and upgrade it. The dashboard is an
 * observer and never upgrades anything, so it says so and waits.
 */
export function upgradePending(err: unknown): boolean {
  if (!isStoreError(err, "STORE_UNINITIALIZED")) return false;
  const found = Number.parseInt(String(err.detail["found"] ?? ""), 10);
  return Number.isFinite(found) && found >= 6 && found < SCHEMA_VERSION;
}

/** The sentence a store waiting for its upgrade gets, on the page and in the terminal. */
export const UPGRADE_PENDING_SENTENCE =
  "This memory needs a one-time upgrade. Open a Claude Code session and it will upgrade itself; then reload.";

