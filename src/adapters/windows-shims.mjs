/**
 * THE FOUR COMMANDS, MADE RUNNABLE FROM POWERSHELL AND CMD (W1, 2026-11-09).
 *
 * `package.json#scripts.postinstall` runs this after npm has linked the bins.
 * It acts only for a GLOBAL npm install on Windows (`npm_config_global`), and
 * anywhere else returns at once and touches nothing.
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
 * So this rewrites the `.cmd` and `.ps1` that npm wrote for THIS package's four
 * bins, in the global prefix, to run `node` (the one beside them, else on PATH,
 * as npm's own shims for a Node bin do) — and nothing else. A file is changed
 * only when it has npm's exact shim shape (the target line `read-cmd-shim`
 * reads) AND that target is this package's own bin for that name. A local
 * install (`npm i counterparts` in a project) is left alone: its launchers are
 * in `node_modules/.bin`, not on a person's PATH, and its project root may hold
 * files of the same name that are somebody else's (W1 review). The
 * extensionless shell script is left as npm wrote it; Git Bash runs it through
 * `/bin/sh` and the polyglot line as on Linux.
 *
 * It never fails the install: whatever goes wrong, it says one line and exits
 * 0. With `--ignore-scripts` it does not run; the commands then work from Git
 * Bash, and `docs/QUICKSTART.md` says how to run them from PowerShell.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** Each bin by the name npm links (`package.json#bin`) → its file under the package. */
export const BINS = {
  counterparts: "src/adapters/cli/bin/counterparts.mjs",
  "counterparts-hook": "src/adapters/claude-code/bin/hook.mjs",
  "counterparts-mcp": "src/adapters/mcp/bin/serve.mjs",
  "counterparts-dashboard": "src/adapters/dashboard/bin/dashboard.mjs",
};

/** The target line of npm's shims, as `read-cmd-shim` reads them: the `.cmd`
 *  (`%dp0%`, or `%~dp0` from older npm) and the `.ps1` (`$basedir`). */
const CMD_TARGET = /"%(?:dp0%|~dp0)\\([^"]+?)"\s+%\*/;
const PS1_TARGET = /"\$basedir\/([^"]+?)"\s+\$args/;

/** A shim's text with `/bin/sh` made `node`, or null when it is not npm's shim
 *  for exactly `target` (the bin's path from the prefix, `/`-separated) or
 *  names no `/bin/sh`. The longer spellings are replaced first. */
export function rewriteShim(text, ext, target) {
  const m = (ext === ".cmd" ? CMD_TARGET : PS1_TARGET).exec(text);
  if (m === null) return null;
  const named = (m[1] ?? "").replace(/\\/g, "/");
  if (named !== target) return null;
  if (!text.includes("/bin/sh")) return null;
  return text.split("\\/bin/sh").join("\\node").split("//bin/sh").join("/node").split("/bin/sh").join("node");
}

/** The global prefix npm linked this package's bins into, or null when this is
 *  not a global install there: `<prefix>\node_modules\<pkg>` → `<prefix>`, the
 *  layout of a Windows global install. */
export function globalBinDir(packageDir, env = process.env) {
  if (String(env.npm_config_global ?? "").toLowerCase() !== "true") return null;
  const parent = dirname(packageDir);
  if (basename(parent) !== "node_modules") return null;
  return dirname(parent);
}

/** Rewrite what needs it; the names of the files changed. */
export function fixShims(packageDir, platform = process.platform, env = process.env) {
  if (platform !== "win32") return [];
  const dir = globalBinDir(packageDir, env);
  if (dir === null) return [];
  const changed = [];
  const pkgName = basename(packageDir);
  for (const [name, file] of Object.entries(BINS)) {
    const target = `node_modules/${pkgName}/${file}`;
    for (const ext of [".cmd", ".ps1"]) {
      const shim = join(dir, `${name}${ext}`);
      if (!existsSync(shim)) continue;
      const text = readFileSync(shim, "utf8");
      const next = rewriteShim(text, ext, target);
      if (next === null || next === text) continue;
      writeFileSync(shim, next, "utf8");
      changed.push(shim);
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
