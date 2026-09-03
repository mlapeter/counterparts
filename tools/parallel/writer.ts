/**
 * `tools/parallel/writer.ts` — THE ONLY MODULE IN THIS TOOL THAT WRITES.
 *
 * CONTRACT §5 G1: "the instrument writes nothing but its own run directory."
 * That guarantee is kept by containment rather than by care: every filesystem
 * write API this tool touches is imported HERE, once, and `test/parallel.test.ts`
 * source-scans every other `.ts` under `tools/parallel/` (including `bin/`) for
 * those same identifiers. A write that grows anywhere else fails the suite
 * before it can reach a store — the pattern is `tools/migrate/read.ts`'s,
 * inverted (there the reader is scanned; here everything but the writer is).
 *
 * And every path this file will accept is under one run directory, checked by
 * containment on the resolved paths, so a caller cannot hand it `~/.bansai/x`
 * by way of a `..` (scar §2.13's rule, applied to the writing half).
 */
import { mkdirSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative } from "node:path";

import { overlaps, realpathOr } from "./readers.js";

export class WriterError extends Error {
  readonly code: string;
  readonly detail: Readonly<Record<string, string>>;
  constructor(code: string, detail: Record<string, string> = {}) {
    super(`${code} ${JSON.stringify(detail)}`);
    this.name = "WriterError";
    this.code = code;
    this.detail = detail;
  }
}

/**
 * The directories the run directory must not touch — the same four the
 * preflight's `datadirs.disjoint` row checks, named by the operator at the
 * command line. A run directory the operator typed one character wrong could
 * otherwise be created INSIDE a live store, and the instrument's one write
 * would land in the subject it exists to observe (CONTRACT §5 G1, scar §2.13).
 */
export interface LiveStores {
  readonly v1Dir: string;
  readonly v2DataDir: string;
  readonly engramDir: string;
  readonly abDir: string;
}

/**
 * A handle on ONE run directory. Nothing outside it can be written through
 * this object, and there is no other object.
 */
export class RunDir {
  readonly root: string;

  private constructor(root: string) {
    this.root = root;
  }

  /**
   * Opens (and creates) the run directory. The ONLY mkdir in the tool.
   *
   * The disjointness check runs BEFORE the mkdir, so a run directory nested
   * under a live store is refused without leaving a directory behind as
   * evidence of the attempt. `realpathOr` resolves both sides through their
   * nearest existing ancestor, so a not-yet-created run directory still
   * compares in the filesystem's own spelling.
   */
  static open(dir: string, stores: LiveStores): RunDir {
    const root = realpathOr(dir);
    const named: [string, string][] = [
      ["v1 dir", stores.v1Dir],
      ["v2 dataDir", stores.v2DataDir],
      ["engram dir", stores.engramDir],
      ["assignment dir", stores.abDir],
    ];
    for (const [name, path] of named) {
      if (path.trim().length === 0) continue;
      const other = realpathOr(path);
      if (overlaps(root, other)) {
        throw new WriterError("RUN_DIR_OVERLAPS_STORE", { runDir: root, store: name, path: other });
      }
    }
    mkdirSync(root, { recursive: true });
    return new RunDir(root);
  }

  /** Resolve a run-relative path, refusing anything that escapes the root. */
  path(...parts: readonly string[]): string {
    // REALPATH, not `resolve`: `resolve` collapses `..` textually and cannot
    // see a symlink that leaves the root entirely. The root is already
    // realpathed at open, so both sides are in one spelling (scar §2.13).
    const full = realpathOr(join(this.root, ...parts));
    const rel = relative(this.root, full);
    if (rel.startsWith("..") || isAbsolute(rel)) {
      throw new WriterError("RUN_DIR_ESCAPE", { root: this.root, path: full });
    }
    return full;
  }

  /**
   * Write UTF-8 text at a run-relative path, ATOMICALLY.
   *
   * tmp + rename, because the run record is read back on the next day's run:
   * a process killed mid-write left a truncated `run.json`, and the reader
   * treated an unparsable one as "no run yet" and silently restarted the day
   * count. Rename is atomic within a directory, so a reader sees the whole old
   * file or the whole new one and never a half.
   */
  writeText(rel: string, text: string): string {
    const full = this.path(rel);
    mkdirSync(dirname(full), { recursive: true });
    const tmp = `${full}.tmp-${process.pid}-${Date.now()}`;
    try {
      writeFileSync(tmp, text, "utf8");
      renameSync(tmp, full);
    } catch (err) {
      try {
        unlinkSync(tmp);
      } catch {
        /* the temp file never landed */
      }
      throw err;
    }
    return full;
  }

  /** Write pretty JSON, trailing newline — the shape every other tool writes. */
  writeJson(rel: string, value: unknown): string {
    return this.writeText(rel, `${JSON.stringify(value, null, 2)}\n`);
  }
}
