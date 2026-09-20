/**
 * One fixture for stores — the suite's single piece of layout knowledge.
 *
 * A memory's body was a markdown file under `prose/` and its archived versions
 * were files under `versions/`; since the floor (schema v6) both are columns on
 * a row and those directories do not exist. Every test that only wanted "what
 * does this memory SAY" had to know that, and sixteen files knowing it would
 * have been sixteen files in the floor's diff — the one diff in this rebuild
 * that can make a store unreadable, and so the one that had to stay legible.
 * It worked: the floor changed this file and two store suites.
 *
 * So the answers live here instead:
 *
 *   - `bodyOf` / `versionBodies` go through the `Store` API (`readProse`,
 *     `versions`, `readVersion`), which phase 5 keeps unchanged. They are
 *     layout-free already, and exist so no test reaches for a path again.
 *   - `makeBodyUnreadable` is the one function in `test/` that reaches past the
 *     `Store` API into the database underneath it, and it is here so the floor
 *     changed one function rather than four call sites in three suites. See its
 *     own note for what it does on the rows floor and why.
 *   - `makeStore` is the hand-rolled "fresh temp dir, opened store, clean up
 *     after" shape, for the tests that need a SECOND store beside the one their
 *     `beforeEach` already makes.
 *
 * Hermetic, as CLAUDE.md requires: the directory is a fresh `mkdtempSync` under
 * the OS temp dir, nothing is resolved from `$HOME`, the dir is always passed to
 * `Store.open` explicitly (so `COUNTERPARTS_REQUIRE_EXPLICIT_DIR=1` is satisfied
 * without an environment variable), and `cleanup()` closes before it removes.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Store, paths } from "../src/core/store/index.js";
import { openDb } from "../src/core/store/db.js";

/** A store nobody else shares, and the one call that takes it away again. */
export interface MadeStore {
  /** The data directory, so a test can name it in its own assertions. */
  dir: string;
  store: Store;
  /** Closes the store (tolerating an already-closed one) and removes the dir. */
  cleanup(): void;
}

/**
 * A fresh temp data dir with a store open on it.
 *
 * `opts` is `Store.open`'s options minus `dir` — `now` and the rest pass straight
 * through — plus a `prefix`, so a directory left behind says which fixture left
 * it. `observer: true` passes through too but will refuse here (measured:
 * `STORE_UNINITIALIZED`), because an instrument declines to CREATE a store; a
 * test that wants an observer opens one on a dir a writer made first.
 */
export function makeStore(
  opts: Omit<NonNullable<Parameters<typeof Store.open>[0]>, "dir"> & { prefix?: string } = {},
): MadeStore {
  const { prefix = "counterparts-fixture-", ...storeOpts } = opts;
  const dir = mkdtempSync(join(tmpdir(), prefix));
  const store = Store.open({ dir, ...storeOpts });
  return {
    dir,
    store,
    cleanup(): void {
      try {
        store.close();
      } catch {
        /* already closed by the test */
      }
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

/** What this memory currently SAYS — never where it is kept. */
export function bodyOf(store: Store, id: string): string {
  return store.readProse(id).body;
}

/** The bodies of this memory's archived versions, oldest first. */
export function versionBodies(store: Store, id: string): string[] {
  return store
    .versions(id)
    .slice()
    .sort((a, b) => a.seq - b.seq)
    .map((v) => store.readVersion(id, v.seq).body);
}

/**
 * Take a memory's words away UNDERNEATH the store, leaving its row intact.
 *
 * The state four tests need is "the row is there and its words are not": doctor
 * reading RED on a store no session can open, `Self` naming an element
 * *unreadable* rather than *removed*, and two removal-chase plans that have to
 * work with nothing but the row. It was one `rmSync` while a body was a file,
 * and F4 collected it here so the floor would have one function to answer
 * rather than four call sites in three suites.
 *
 * **THE ANSWER IS BLANK THE COLUMN, and the row's `content_hash` is what makes
 * it honest.** The floor gives the store a pair, not a flag:
 *
 *   - `body = '' AND content_hash = ''` is a TOMBSTONE. The owner removed this;
 *     the deny-list answers by name, and `Schemas.load` skips it so the next
 *     session still starts (#139).
 *   - `body = ''` with the hash still naming the words that were there is the
 *     FAULT — a row whose words went missing underneath the store. No write
 *     path in `store/` produces it: `put` and `revise` both refuse an empty
 *     body, and the chase blanks both halves together. So it is exactly the
 *     state this helper wants, and every read answers it `MEMORY_BODY_MISSING`.
 *
 * That is why the four tests are rewritten rather than retired: "unreadable"
 * still means something specific on this floor, it is still distinguishable
 * from "removed", and the mechanism the tests exercise — doctor's red Store
 * line, the hook's stand-down, `Self`'s `[unreadable]` — is unchanged.
 *
 * It writes through a SECOND connection rather than through the store's own,
 * which is the whole point: the store must meet this state having never made
 * it. Returns the id, where it used to return the path it removed — on this
 * floor there is no path, and `MEMORY_BODY_MISSING` carries `{ id }` for the
 * same reason.
 */
export function makeBodyUnreadable(store: Store, id: string): string {
  const row = store.row(id);
  // Asserted, not assumed: a helper that silently blanked nothing would make
  // every caller vacuous at once.
  if (row === undefined) throw new Error(`makeBodyUnreadable: ${id} is not in this store`);
  if (row.body.length === 0) throw new Error(`makeBodyUnreadable: ${id} already has no words`);
  if (row.content_hash.length === 0) {
    throw new Error(`makeBodyUnreadable: ${id} carries no content hash, so this would tombstone it`);
  }
  const db = openDb(paths.operational(store.dir));
  try {
    db.run("UPDATE memories SET body = '' WHERE id = ?", id);
  } finally {
    db.close();
  }
  return id;
}
