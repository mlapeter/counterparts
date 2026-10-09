/**
 * THE SINGLE BINARY'S ENTRY (spike, 2026-10-09 — docs/notes/single-binary-spike.md).
 *
 * `bun build --compile` packs this file, everything it reaches and the files
 * `assets.gen.ts` embeds into one executable that needs no Bun or Node on the
 * machine. Its first argument picks the entry, matching `plugin-run.sh`'s modes:
 *
 *   counterparts-bin hook | mcp | cli … | dashboard …   (what a host runs)
 *   counterparts-bin runner | nightly                    (what it spawns of itself:
 *                                                        adapters/runtime.ts#scriptArgs)
 *   counterparts-bin selfcheck                           (the release step's check)
 *
 * Inside the binary every module shares one `import.meta.url`, so no entry's
 * "am I the main script" guard fires (`isEntryPoint` says no when compiled);
 * this file calls the chosen entry's `start()` instead. The mode is taken out
 * of `process.argv` first: every entry reads its own arguments from index 2.
 * The entries are imported lazily, so a hook evaluates only the hook's graph.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";

// Written by build.ts before every compile and not committed, so a fresh
// checkout's typecheck has no file to resolve.
// @ts-ignore
import { EMBEDDED as embedded } from "./assets.gen.js";

const EMBEDDED = embedded as readonly string[];

type Entry = { start: () => void | Promise<void> };

const MODES: Record<string, () => Promise<Entry>> = {
  hook: () => import("../../src/adapters/claude-code/bin/hook.js"),
  mcp: () => import("../../src/adapters/mcp/bin/serve.js"),
  cli: () => import("../../src/adapters/cli/bin/counterparts.js"),
  dashboard: () => import("../../src/adapters/dashboard/bin/dashboard.js"),
  runner: () => import("../../src/adapters/claude-code/bin/runner.js"),
  nightly: () => import("../../src/adapters/claude-code/bin/nightly.js"),
};

async function selfcheck(): Promise<number> {
  const { BINARY, packagePath, bundledModelDir } = await import("../../src/adapters/runtime.js");
  const missing = EMBEDDED.filter((p) => !existsSync(p));
  const pkg = EMBEDDED.find((p) => /[\\/]package\.json$/.test(p) && !p.includes("node_modules"));
  const model = bundledModelDir();
  const report = {
    binary: BINARY,
    embedded: EMBEDDED.length,
    missing,
    packageJsonAt: pkg ?? null,
    packagePathAgrees: pkg !== undefined && packagePath("package.json") === pkg,
    modelDir: model ?? null,
    modelFound: model !== undefined && existsSync(join(model, "model.safetensors")),
  };
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  return BINARY !== null && missing.length === 0 && report.packagePathAgrees && report.modelFound ? 0 : 1;
}

const mode = process.argv[2] ?? "";
if (mode === "selfcheck") {
  process.exit(await selfcheck());
}
if (mode === "--version" || mode === "-v") {
  const { packageVersion } = await import("../../src/adapters/cli/commands.js");
  process.stdout.write(`counterparts ${packageVersion()}\n`);
  process.exit(0);
}
const load = MODES[mode];
if (load === undefined) {
  process.stderr.write(
    `counterparts: the single binary takes a mode first: ${Object.keys(MODES).join(" | ")} (or --version, selfcheck)\n`,
  );
  process.exit(2);
}
process.argv.splice(2, 1);
await (await load()).start();
