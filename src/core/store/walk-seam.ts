/**
 * The WALKING read — the prose of a row an index is walking past, not of a
 * memory anyone asked for.
 *
 * It exists because five call sites outside `store/` used to read prose by PATH
 * (`readProseFile(store.absolutePath(row.prose_path), id)`), which was the last
 * reason anything above the store knew there was a filesystem under it. Taking
 * them off the layout means giving them a read that keeps the two exemptions
 * they already had — and both of them are exemptions from a GATE, so this is not
 * a convenience and must not sit where a caller finds it by accident.
 *
 *   1. **No archived-read telemetry.** `store.archived.read` answers "did anyone
 *      look at archived CONTENT" (CONTRACT §5 G13). `Schemas.load` scans every
 *      schema row at every open, so routing it through `Store.read` would file
 *      one archived-read per archived schema row per session and invert what the
 *      event means. An index build is a look at the address.
 *   2. **No deny-list refusal — the dangerous half, and the reason for this
 *      file.** A `dark`-stage removal marks the id and leaves the row and the
 *      file until the chase, so a refusal here is the next session failing to
 *      start rather than one memory hidden. The refusal belongs where the OWNER
 *      is answered: `Store.read`, `resolve`, `readVersion` and the render seams.
 *
 * It lives here rather than on `Store` for the reason `chaseRemoved` does
 * (`owner-op-seam.ts`): `Counterpart.store` is public, so a method on
 * `Store.prototype` beside `read` and `readProse` is a removal bypass every
 * adapter and every future contributor gets without asking for it, and §4's
 * "owner-initiated removal is unreachable from any model path" would stop being
 * true of the store's own surface. Reaching this one takes a deliberate import
 * from one of two files — `schemas/index.ts` and `adapters/cli/commands.ts`,
 * four call sites between them — and `test/cli.test.ts` pins that list.
 *
 * **It is still a hole.** One hole, with a name on it, in the seam where it can
 * be seen and one day closed — `schemas/index.ts` skipping removed rows closes
 * it where it actually matters (2026-09-18).
 */
import { StoreError } from "./errors.js";
import { readProseFile } from "./prose.js";
import type { MemoryRow } from "./operational.js";
import type { ProseDoc } from "./prose.js";
import type { Store } from "./index.js";

/**
 * `row` is the caller's own `row(id)` when it already has one — every one of
 * these walks reads the row's columns too, and looking it up twice per id
 * measured 54% of a 16,000-row walk (650 ms → 990 ms), which is most of the walk
 * once the body IS the row and there is no file read to dominate. A row for a
 * DIFFERENT id is refused by name rather than answered with the wrong memory's
 * body: `readProseFile`'s own `expectId` check catches it today, and the line
 * here outlives that check.
 */
export function readProseWalking(store: Store, id: string, row?: MemoryRow): ProseDoc {
  const r = row ?? store.row(id);
  if (r === undefined) throw new StoreError("ID_UNKNOWN", { id });
  if (r.id !== id) throw new StoreError("PROSE_PAYLOAD_MISMATCH", { expected: id, found: r.id });
  return readProseFile(store.absolutePath(r.prose_path), id);
}
