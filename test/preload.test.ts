/**
 * The guard guarded. If these fail, every other test in the suite is running
 * against the real home directory and one of them may be writing into it.
 */
import { describe, expect, test } from "bun:test";
import { existsSync, realpathSync, statSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { DATA_DIR_ENV, REQUIRE_EXPLICIT_DIR_ENV, dataDir } from "../src/core/store/paths.js";

/**
 * Captured at MODULE LOAD, before any test in this file runs: the claim is that
 * the variable is unset when a test file starts, not merely that some test can
 * unset it. Bun runs files in one process, so a file that leaked it would show up
 * here in a full-suite run.
 */
const DATA_DIR_AT_LOAD = process.env[DATA_DIR_ENV];
/** Same claim, same moment, for the guard the preload ARMS: a test that stood it
 *  down and forgot to re-arm it would show up here. */
const GUARD_AT_LOAD = process.env[REQUIRE_EXPLICIT_DIR_ENV];

const REAL_TMP = realpathSync(tmpdir());

describe("test/preload.ts — the home-directory guard", () => {
  test("homedir() is a fresh temp dir, not the real home", () => {
    const home = homedir();
    // Deliberately no hardcoded real-home path: the real home is never under
    // the OS temp dir, so this distinguishes them without naming either.
    expect(home.startsWith(`${REAL_TMP}/`)).toBe(true);
    expect(home).toContain("counterparts-test-home-");
    expect(statSync(home).isDirectory()).toBe(true);
    // And the variable agrees, for code that reads $HOME rather than calling homedir().
    expect(process.env["HOME"]).toBe(home);
    expect(process.env["USERPROFILE"]).toBe(home);
  });

  test("COUNTERPARTS_DATA_DIR is unset when a test file starts", () => {
    expect(DATA_DIR_AT_LOAD).toBeUndefined();
  });

  test("COUNTERPARTS_REQUIRE_EXPLICIT_DIR is armed when a test file starts — a forgetful test is REFUSED, not redirected", () => {
    expect(GUARD_AT_LOAD).toBe("1");
    // With the guard armed and no dir named, the fallback is never handed out:
    // the second layer (I21) names the forgetful test at the moment it forgets.
    const prior = process.env[DATA_DIR_ENV];
    try {
      delete process.env[DATA_DIR_ENV];
      let code: string | undefined;
      try {
        dataDir();
      } catch (e) {
        code = (e as { code?: string }).code;
      }
      expect(code).toBe("IMPLICIT_DEFAULT_DIR_REFUSED");
    } finally {
      if (prior === undefined) delete process.env[DATA_DIR_ENV];
      else process.env[DATA_DIR_ENV] = prior;
    }
  });

  test("dataDir()'s fallback lands under the temp home — the wound of 2026-09-04", () => {
    // `~/.counterparts` is not on FORBIDDEN_ROOT_NAMES and cannot be: the store
    // has to be able to open its own default dir. So the protection has to be
    // that `~` itself is temporary. This is that assertion — and it has to stand
    // the guard down to reach the fallback at all, which is the point of the
    // guard. Re-armed in `finally`; the test above catches a leak.
    const prior = process.env[DATA_DIR_ENV];
    delete process.env[REQUIRE_EXPLICIT_DIR_ENV];
    try {
      delete process.env[DATA_DIR_ENV];
      const fallback = dataDir();
      expect(fallback).toBe(join(homedir(), ".counterparts", "store"));
      expect(fallback.startsWith(`${REAL_TMP}/`)).toBe(true);
      // A tripwire, not a purity claim: if THIS fails, some test file loaded
      // earlier in the run fell back to the default data dir instead of setting
      // its own. The guard caught it — the skeleton is in the temp home, not the
      // owner's — but go find the test.
      expect(existsSync(fallback)).toBe(false);
    } finally {
      process.env[REQUIRE_EXPLICIT_DIR_ENV] = "1";
      if (prior === undefined) delete process.env[DATA_DIR_ENV];
      else process.env[DATA_DIR_ENV] = prior;
    }
  });
});
