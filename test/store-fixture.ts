/**
 * One fixture for stores — the suite's single piece of layout knowledge.
 *
 * Today a memory's body is a markdown file under `prose/` and its archived
 * versions are files under `versions/`; tomorrow (the floor, phase 5) both are
 * columns on a row and those directories do not exist. Every test that only
 * wanted "what does this memory SAY" had to know that, and sixteen files knowing
 * it is sixteen files in the floor's diff — the one diff in this rebuild that
 * can make a store unreadable, and so the one that has to stay legible.
 *
 * So the answers live here instead:
 *
 *   - `bodyOf` / `versionBodies` go through the `Store` API (`readProse`,
 *     `versions`, `readVersion`), which phase 5 keeps unchanged. They are
 *     layout-free already, and exist so no test reaches for a path again.
 *   - `makeBodyUnreadable` is the one function in `test/` that DOES know there is
 *     a file, and it is here so phase 5 changes one function rather than four
 *     call sites in three suites. See its own note — it may have no honest
 *     successor once bodies are in rows.
 *   - `makeStore` is the hand-rolled "fresh temp dir, opened store, clean up
 *     after" shape, for the tests that need a SECOND store beside the one their
 *     `beforeEach` already makes.
 *
 * Hermetic, as CLAUDE.md requires: the directory is a fresh `mkdtempSync` under
 * the OS temp dir, nothing is resolved from `$HOME`, the dir is always passed to
 * `Store.open` explicitly (so `COUNTERPARTS_REQUIRE_EXPLICIT_DIR=1` is satisfied
 * without an environment variable), and `cleanup()` closes before it removes.
 */
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Store } from "../src/core/store/index.js";

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
 * `opts` is `Store.open`'s options minus `dir` — `observer: true`, `now`, and the
 * rest pass straight through — plus a `prefix` so a failure says which fixture
 * left the directory behind.
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
 * Take a memory's body away UNDERNEATH the store, leaving its row intact.
 *
 * The state four tests need is "the row is there and its words are not": a
 * doctor reading red with `PROSE_FILE_MISSING`, `Self` naming an element
 * unreadable rather than removed, and two removal-chase plans that have to work
 * with nothing but the row. Today that is one `rmSync`, which is why this is the
 * only function in `test/` that resolves a stored path.
 *
 * It returns the absolute path it removed, because one caller
 * (`hook-standdown.test.ts`) asserts the store names that exact path back.
 *
 * PHASE 5: a body is a column, so there is no file to remove and no path to
 * return. The honest successor may be "blank the column" — or there may be
 * none, in which case these four tests are retired rather than rewritten. That
 * is a ruling for the floor, and it is a smaller one because it is asked here
 * once instead of in three suites.
 */
export function makeBodyUnreadable(store: Store, id: string): string {
  const path = store.absolutePath(store.row(id)?.prose_path ?? "");
  // Asserted, not assumed: a helper that silently removed nothing would make
  // every caller vacuous at once.
  if (!existsSync(path)) {
    throw new Error(`makeBodyUnreadable: ${id} has no body on disk at ${path}`);
  }
  rmSync(path, { force: true });
  return path;
}
