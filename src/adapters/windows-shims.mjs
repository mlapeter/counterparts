/**
 * THE FOUR COMMANDS, MADE RUNNABLE FROM POWERSHELL AND CMD (W1, 2026-11-09).
 *
 * `package.json#scripts.postinstall` runs this after npm has linked the bins.
 * Anywhere but Windows it returns at once and touches nothing.
 *
 * Why it exists: each bin (`cli/bin/counterparts.mjs` and its three siblings)
 * is a shell script and an ES module at once, its first line `#!/bin/sh`, so
 * that on macOS and Linux the shell half picks Bun when it is on PATH, else
 * Node (`launch.mjs`). On Windows npm makes a `counterparts.cmd` and a
 * `counterparts.ps1` beside an extensionless shell script, and writes into
 * both whatever the first line named: `/bin/sh`, which neither cmd.exe nor
 * PowerShell can find. Typed in PowerShell, `counterparts` was "not
 * recognized". The first line cannot name Node instead: the kernel reads the
 * same line on macOS and Linux, and a machine with Bun and no Node (`bun add
 * -g counterparts`) would lose the console.
 *
 * So, on Windows only, this rewrites the `.cmd` and `.ps1` that npm wrote for
 * THIS package's four bins to run `node` (the one beside them, else on PATH,
 * as npm's own shims for a Node bin do) — and nothing else: a file is changed
 * only when it is npm's shim, names `/bin/sh`, and points at this package's
 * own bin file. The extensionless shell script is left as npm wrote it; Git
 * Bash runs it through `/bin/sh` and the polyglot line as on Linux.
 *
 * It never fails the install: whatever goes wrong, it says one line and exits
 * 0. With `--ignore-scripts` it does not run; the commands then work from Git
 * Bash, and `docs/QUICKSTART.md` says how to run them from PowerShell.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** The four bins, by the name npm links (`package.json#bin`). */
export const BIN_NAMES = ["counterparts", "counterparts-hook", "counterparts-mcp", "counterparts-dashboard"];

/** A shim's text with `/bin/sh` made `node`, or null when it is not npm's
 *  shim for this package's bin (`marker`: the bin's path under the package,
 *  as the shim names it). The order of the replacements matters: the longer
 *  spellings first. */
export function rewriteShim(text, marker) {
  if (!text.includes("/bin/sh") || !text.includes(marker)) return null;
  return text.split("\\/bin/sh").join("\\node").split("//bin/sh").join("/node").split("/bin/sh").join("node");
}

/** The directories npm may have linked this package's bins into: the global
 *  prefix (`<prefix>\node_modules\counterparts` → `<prefix>`) and a project's
 *  `node_modules\.bin`. */
export function binDirs(packageDir) {
  const parent = dirname(packageDir);
  if (basename(parent) !== "node_modules") return [];
  return [dirname(parent), join(parent, ".bin")];
}

/** Rewrite what needs it; the names of the files changed. */
export function fixShims(packageDir, platform = process.platform) {
  if (platform !== "win32") return [];
  const changed = [];
  const pkgName = basename(packageDir);
  for (const dir of binDirs(packageDir)) {
    for (const name of BIN_NAMES) {
      for (const ext of [".cmd", ".ps1"]) {
        const file = join(dir, `${name}${ext}`);
        if (!existsSync(file)) continue;
        const text = readFileSync(file, "utf8");
        // The bin's path as the shim names it: `\` in the .cmd, `/` in the .ps1.
        const marker = ext === ".cmd" ? `${pkgName}\\src\\adapters\\` : `${pkgName}/src/adapters/`;
        const next = rewriteShim(text, marker);
        if (next === null || next === text) continue;
        writeFileSync(file, next, "utf8");
        changed.push(file);
      }
    }
  }
  return changed;
}

const self = fileURLToPath(import.meta.url);
if (process.argv[1] !== undefined && basename(process.argv[1]) === basename(self)) {
  try {
    fixShims(join(dirname(self), "..", ".."));
  } catch (err) {
    process.stderr.write(`counterparts: could not adjust the Windows launchers (${err instanceof Error ? err.message : String(err)}); run it from Git Bash, or see docs/QUICKSTART.md.\n`);
  }
}
