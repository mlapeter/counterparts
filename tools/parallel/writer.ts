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
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";

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
 * A handle on ONE run directory. Nothing outside it can be written through
 * this object, and there is no other object.
 */
export class RunDir {
  readonly root: string;

  private constructor(root: string) {
    this.root = root;
  }

  /** Opens (and creates) the run directory. The ONLY mkdir in the tool. */
  static open(dir: string): RunDir {
    const root = resolve(dir);
    mkdirSync(root, { recursive: true });
    return new RunDir(root);
  }

  /** Resolve a run-relative path, refusing anything that escapes the root. */
  path(...parts: readonly string[]): string {
    const full = resolve(join(this.root, ...parts));
    const rel = relative(this.root, full);
    if (rel.startsWith("..") || isAbsolute(rel)) {
      throw new WriterError("RUN_DIR_ESCAPE", { root: this.root, path: full });
    }
    return full;
  }

  /** Write UTF-8 text at a run-relative path, creating parent directories. */
  writeText(rel: string, text: string): string {
    const full = this.path(rel);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, text, "utf8");
    return full;
  }

  /** Write pretty JSON, trailing newline — the shape every other tool writes. */
  writeJson(rel: string, value: unknown): string {
    return this.writeText(rel, `${JSON.stringify(value, null, 2)}\n`);
  }
}
