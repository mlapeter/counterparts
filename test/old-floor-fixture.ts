/**
 * A REAL old-floor store, built by the build that wrote old-floor stores.
 *
 * **Why it is not hand-made.** N1's whole claim is that `start-fresh` moves a
 * store the running build refuses to open, and leaves it byte-identical. A
 * fixture assembled here out of `mkdir prose` and a hand-written
 * `operational.sqlite` would prove that the command tolerates three FILENAMES —
 * which is not the claim. The claim is about cut-over day: new code, and on disk
 * a store with sixteen thousand markdown bodies, archived versions, a journal,
 * spans, a cache, and — since F1 — a WAL whose `-wal` holds committed pages the
 * database file does not. Only the old build can produce that.
 *
 * So this extracts the pinned tag `floor/v5-last` (the last commit that can open
 * a v5 store, `store/paths.ts#PRE_ROWS_READABLE_BY`) into a temp directory with
 * `git archive` — never `git worktree add`, which touches the shared repository —
 * and runs ITS `Store` API, in a child process, to write the store.
 *
 * Hermetic, as everything here must be: the extract and the store both live in
 * fresh temp dirs the caller removes. The child gets a fake `HOME` and
 * `BUN_RUNTIME_TRANSPILER_CACHE_PATH=0`, because bun writes its transpiler cache
 * under `HOME` and would otherwise re-create a directory after teardown
 * (`test/hook-standdown.test.ts#hookEnv`).
 *
 * **It is extracted ONCE per suite run** and reused, because `git archive` plus a
 * child bun process is the most expensive thing in this file by an order of
 * magnitude. Only `src/` is extracted: the store has no runtime dependencies, so
 * that is the whole of what the child needs.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** The tag, spelled here as `store/paths.ts` spells it. A mismatch is a failure
 *  worth seeing, so it is asserted rather than imported blindly. */
export const PINNED_TAG = "floor/v5-last";

/** This repository, from this file's own location — never a working directory. */
const REPO = dirname(dirname(fileURLToPath(import.meta.url)));

let extracted: string | null = null;
const cleanup: string[] = [];

/**
 * The pinned build's `src/`, extracted once. Throws with the exact command if
 * the tag is not there — a repository without it cannot prove the one thing
 * this fixture exists to prove, and skipping quietly would turn that into a
 * green run.
 */
export function pinnedBuild(): string {
  if (extracted !== null) return extracted;
  const dir = mkdtempSync(join(tmpdir(), "counterparts-v5build-"));
  cleanup.push(dir);
  const tar = join(dir, "src.tar");
  const archive = spawnSync("git", ["-C", REPO, "archive", PINNED_TAG, "-o", tar, "src"], {
    encoding: "utf8",
  });
  if (archive.status !== 0) {
    throw new Error(
      `could not extract the pinned build: git -C ${REPO} archive ${PINNED_TAG} -o <tmp> src ` +
        `exited ${String(archive.status)}: ${archive.stderr || archive.stdout || "no output"}. ` +
        "That tag is what makes the old-floor fixture REAL rather than three hand-made filenames.",
    );
  }
  const untar = spawnSync("tar", ["-x", "-C", dir, "-f", tar], { encoding: "utf8" });
  if (untar.status !== 0) throw new Error(`could not unpack the pinned build: ${untar.stderr}`);
  rmSync(tar, { force: true });
  extracted = dir;
  return dir;
}

export interface OldFloorStore {
  /** The data directory holding the v5 store. */
  dir: string;
  /** The fake HOME it was built under; remove this and everything goes. */
  home: string;
  cleanup(): void;
}

/**
 * A v5 store with words in it: three memories, one of them revised (so
 * `versions/` is real), a journal episode, and enough small committed writes
 * that the `-wal` carries frames the database file does not.
 *
 * The `-wal` is the sharp part. On the fixture as measured, `operational.sqlite`
 * is 4 KB and `operational.sqlite-wal` is ~600 KB: essentially the whole
 * database is in the sidecar. Anything that so much as OPENS this store may
 * checkpoint on close and move those 600 KB into the file — so "byte-identical"
 * is not a formality here, it is the difference between a store that is
 * untouched and one that is not.
 */
export function makeOldFloorStore(): OldFloorStore {
  const build = pinnedBuild();
  const home = mkdtempSync(join(tmpdir(), "counterparts-v5home-"));
  const dir = join(home, "store");
  mkdirSync(dir, { recursive: true });

  const script = join(build, "seed-old-floor.ts");
  if (!existsSync(script)) {
    writeFileSync(
      script,
      [
        'import { Store } from "./src/core/store/index.js";',
        "const dir = process.argv[2]!;",
        "const s = Store.open({ dir });",
        's.put({ type: "memory", kind: "fact", title: "espresso", body: "the espresso machine is a Rancilio Silvia", salience: 0.6 });',
        's.put({ type: "memory", kind: "fact", title: "boat", body: "the sailboat is a Catalina 30", salience: 0.5 });',
        's.put({ type: "memory", kind: "person", title: "Nina", body: "Nina prefers decisions in conversation", salience: 0.7 });',
        "// A revision, so `versions/` holds a real archived prior body.",
        "const first = s.list()[0]!;",
        's.revise(first, { body: "the espresso machine is a Rancilio Silvia Pro" });',
        "// The journal, which on this floor is `prose/episodes/`.",
        's.put({ type: "episode", kind: "self", title: "a day", body: "what happened, in the old floor\'s own words", salience: 0.5 });',
        "// Committed pages that stay in the `-wal`: well under the 1000-page",
        "// autocheckpoint, so nothing moves them into the database file.",
        "for (let i = 0; i < 40; i += 1) s.setMeta(`n1.fixture.${String(i)}`, \"x\".repeat(200));",
        "s.close();",
      ].join("\n"),
      "utf8",
    );
  }

  const run = spawnSync(process.execPath, ["run", script, dir], {
    encoding: "utf8",
    env: {
      PATH: process.env["PATH"] ?? "",
      HOME: home,
      USERPROFILE: home,
      // The store never resolves a home when it is handed a dir, but the guard
      // is armed everywhere in this repo and a child is no exception.
      COUNTERPARTS_REQUIRE_EXPLICIT_DIR: "1",
      // bun writes its transpiler cache under HOME and re-creates the directory
      // after teardown if it is left on.
      BUN_RUNTIME_TRANSPILER_CACHE_PATH: "0",
    },
  });
  if (run.status !== 0) {
    rmSync(home, { recursive: true, force: true });
    throw new Error(
      `the pinned build could not write a v5 store: ${run.stderr || run.stdout || "no output"}`,
    );
  }

  return {
    dir,
    home,
    cleanup: (): void => {
      rmSync(home, { recursive: true, force: true });
    },
  };
}

/** Remove the extracted build. Called from one root `afterAll`. */
export function forgetPinnedBuild(): void {
  while (cleanup.length > 0) {
    const dir = cleanup.pop();
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
  }
  extracted = null;
}
