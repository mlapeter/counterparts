/**
 * The hermetic-test rule, mechanized.
 *
 * CLAUDE.md says tests never touch a real store. That was an instruction, and an
 * instruction is a thing an agent can miss: on 2026-09-04 a test called
 * `Store.open({ dir: join(homedir(), ".counterparts", "x") })` inside a
 * `.not.toThrow()` and ran four times before anyone noticed — beside the owner's
 * LIVE `~/.counterparts`. `.counterparts` is deliberately NOT in
 * `FORBIDDEN_ROOT_NAMES` (the store must be able to open its own default dir), so
 * the path guard could not catch it. This preload closes the hole one level down:
 * for the whole test run there IS no real home to reach.
 *
 * Bun loads this before any test file (`bunfig.toml` → `[test] preload`). It:
 *   1. mints a fresh temp dir and makes `homedir()` return it;
 *   2. deletes `COUNTERPARTS_DATA_DIR` so a test that forgets to set its own dir
 *      falls back to the TEMP home's `.counterparts`, not the real one;
 *   3. sets `COUNTERPARTS_REQUIRE_EXPLICIT_DIR=1`, so that fallback is not even
 *      reached: a test that names no dir gets `IMPLICIT_DEFAULT_DIR_REFUSED`
 *      (`store/paths.ts`) rather than a store minted in the temp home. Two
 *      layers, because the second names the forgetful test at the moment it
 *      forgets, where the first only kept the damage in a directory nobody will
 *      read. A test OF the fallback unsets the variable for its own body and
 *      re-arms it in `finally`;
 *   4. removes the temp dir on exit.
 * It exports nothing: tests must not build on it, only be protected by it.
 *
 * WHY `mock.module` AND NOT `$HOME`: on Bun, `os.homedir()` does not read `$HOME`
 * at call time — it is fixed from the native environ at startup. That is measured,
 * and the repo already knew it (`tools/parallel/README.md`; the structural test at
 * `test/parallel.test.ts` "only `bin/` may resolve a home directory"). Setting
 * `process.env.HOME` alone would have redirected nothing while looking like it had,
 * which is the most dangerous shape a safety guard can take. `HOME`/`USERPROFILE`
 * are set anyway, for code that reads the variable directly and for children spawned
 * with an explicit `env`.
 *
 * WHERE THIS GUARD STOPS — read before you spawn anything. `mock.module` is
 * per-process. A child spawned with an explicit `env: { ...process.env }` inherits
 * the redirected `HOME` and Bun fixes `homedir()` from it at startup, so the child
 * IS covered. A child spawned with NO `env` option inherits Bun's original environ
 * snapshot and sees the REAL home — outside this guard entirely. Today's two spawn
 * sites are safe by construction, not by luck: `test/parallel.test.ts` (the daily
 * bin) passes every directory as an explicit flag, and `test/remember.test.ts`
 * passes an explicit `env`. If you add a third, do one of those two things.
 * `os.userInfo().homedir` is likewise unmocked; nothing in src/, tools/ or test/
 * calls it today.
 */
import { afterAll, mock } from "bun:test";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import * as nodeOs from "node:os";
import { join } from "node:path";

/** Snapshotted BEFORE the mock is installed, so the replacement is not self-referential. */
const realOs = { ...nodeOs };

const TEMP_HOME = mkdtempSync(join(realpathSync(nodeOs.tmpdir()), "counterparts-test-home-"));

process.env["HOME"] = TEMP_HOME;
process.env["USERPROFILE"] = TEMP_HOME;
delete process.env["COUNTERPARTS_DATA_DIR"];
process.env["COUNTERPARTS_REQUIRE_EXPLICIT_DIR"] = "1";

mock.module("node:os", () => ({
  ...realOs,
  homedir: () => TEMP_HOME,
  default: { ...realOs, homedir: () => TEMP_HOME },
}));

// Fail closed. If the redirect ever stops working — a Bun change, a moved import —
// the run aborts here rather than proceeding against the owner's real home.
const patched = await import("node:os");
if (patched.homedir() !== TEMP_HOME) {
  throw new Error(
    `test/preload.ts: home redirect FAILED — homedir() is ${patched.homedir()}, expected ${TEMP_HOME}. ` +
      "Refusing to run the suite against a real home directory.",
  );
}

/**
 * Cleanup. A root `afterAll` registered from a preload runs once, after the last
 * test file — measured to fire, where `process.on("exit")` alone did NOT under
 * `bun test`, which is why both are here. A leak on a hard crash is inert: it is
 * a directory under the OS temp dir.
 */
const sweep = (): void => {
  rmSync(TEMP_HOME, { recursive: true, force: true });
};
afterAll(sweep);
process.on("exit", sweep);
