/**
 * The tools a release's CI run leans on: the package scan's verdict and what it may
 * print (its log is public), the test-times table, and the install loop's refusal
 * of a named tarball that isn't there. The run itself is `.github/workflows/tests.yml`
 * on a push to release/*; these check the parts that decide.
 *
 * The strings that would trip the scan are built at run time, so this file adds no
 * hit to the tree's own inventory.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { fileTimes } from "../tools/ci/test-times.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const WORK = mkdtempSync(join(realpathSync(tmpdir()), "release-checks-"));
afterAll(() => rmSync(WORK, { recursive: true, force: true }));

let serial = 0;
/** A tarball shaped like npm's: everything under package/. */
function tarball(files: Record<string, string>): string {
  const dir = join(WORK, `t${++serial}`);
  for (const [path, text] of Object.entries({ "package.json": '{"name":"x","exports":{}}', ...files })) {
    mkdirSync(dirname(join(dir, "package", path)), { recursive: true });
    writeFileSync(join(dir, "package", path), text);
  }
  const out = join(dir, "x.tgz");
  const tar = Bun.spawnSync(["tar", "-czf", out, "-C", dir, "package"]);
  expect(tar.exitCode).toBe(0);
  return out;
}

function scan(now: string, was: string, env: Record<string, string> = {}) {
  const r = Bun.spawnSync([process.execPath, join(ROOT, "tools/audit/scan-personal.ts"), "--tarball", now, "--against", was], {
    cwd: ROOT,
    env: { ...process.env, ...env },
    stdout: "pipe",
    stderr: "pipe",
  });
  return { code: r.exitCode, out: r.stdout.toString() + r.stderr.toString() };
}

const SOMEONE_HOME = "/Us" + "ers/someone-private";
const MAILBOX = "someone.private" + "@gma" + "il.com";
const NAME = "Mi" + "ke";
const API_KEY_LINE = "api_" + 'key = "' + "q7Zp2Lx9".repeat(5) + '"';

describe("the package scan", () => {
  const base = { "src/a.ts": "export const a = 1;\n" };

  test("a clean package against the same list passes", () => {
    const r = scan(tarball(base), tarball(base));
    expect(r.out).toContain("PACKAGE SCAN: PASS");
    expect(r.code).toBe(0);
  });

  test("a new mailbox stops it, names the file, and never prints the match", () => {
    const r = scan(tarball({ ...base, "src/a.ts": `// ${MAILBOX}\n` }), tarball(base));
    expect(r.code).toBe(1);
    expect(r.out).toContain("PACKAGE SCAN: FAIL");
    expect(r.out).toContain("owner-email +1  src/a.ts");
    expect(r.out).not.toContain(MAILBOX);
  });

  test("a new home path and a new key stop it, without their text", () => {
    const r = scan(tarball({ ...base, "src/a.ts": `// ${SOMEONE_HOME}\n`, "src/b.ts": `${API_KEY_LINE}\n` }), tarball(base));
    expect(r.code).toBe(1);
    expect(r.out).toContain("absolute-home-path +1  src/a.ts");
    expect(r.out).toMatch(/key:[a-z-]+ \+1 {2}src\/b\.ts/);
    expect(r.out).not.toContain("someone-private");
    expect(r.out).not.toContain("q7Zp2Lx9");
  });

  test("a hit the last release already had is not new", () => {
    const old = { ...base, "src/a.ts": `// ${SOMEONE_HOME}\n` };
    const r = scan(tarball(old), tarball(old));
    expect(r.code).toBe(0);
    expect(r.out).toContain("new hits that stop the release (0)");
  });

  test("a new soft hit is listed to read and doesn't stop it", () => {
    const r = scan(tarball({ ...base, "src/a.ts": `// ${NAME} said so\n` }), tarball(base));
    expect(r.code).toBe(0);
    expect(r.out).toContain("owner-name +1  src/a.ts");
    expect(r.out).not.toContain("said so");
  });

  test("files that don't belong stop it; only the install loop's tools ship", () => {
    for (const path of ["test/x.test.ts", "hosted/server.ts", ".claude-plugin/binaries.json", "tools/audit/x.ts", "src/store.sqlite", "src/.env"]) {
      const r = scan(tarball({ ...base, [path]: "x\n" }), tarball(base));
      expect([path, r.code]).toEqual([path, 1]);
      expect(r.out).toContain(`  ${path}`);
    }
    expect(scan(tarball({ ...base, "tools/install-loop/run.sh": "x\n" }), tarball(base)).code).toBe(0);
  });

  test("new and gone files and a changed export are said, and the summary gets the same", () => {
    const summary = join(WORK, "summary.md");
    const now = tarball({ "package.json": '{"name":"x","exports":{".":"./a.ts"}}', "src/new.ts": "x\n" });
    const r = scan(now, tarball(base), { GITHUB_STEP_SUMMARY: summary });
    expect(r.code).toBe(0);
    expect(r.out).toContain("  + src/new.ts");
    expect(r.out).toContain("  - src/a.ts");
    expect(r.out).toContain("CHANGED");
    expect(readFileSync(summary, "utf8")).toContain("PACKAGE SCAN: PASS");
  });
});

describe("test times", () => {
  const XML = `<?xml version="1.0"?>
<testsuites name="bun test" tests="4" time="9.5">
  <testsuite name="test/a.test.ts" file="test/a.test.ts" time="0">
    <testsuite name="d" file="test/a.test.ts" time="0.1">
      <testcase name="has a &gt; and > in it" classname="d" time="1.5" file="test/a.test.ts" line="1" />
      <testcase name="fails" classname="d" time="0.5" file="test/a.test.ts" line="2"><failure message="no" /></testcase>
    </testsuite>
  </testsuite>
  <testsuite name="test/b.test.ts" file="test/b.test.ts" time="3">
    <testcase name="top" classname="" time="3" file="test/b.test.ts" line="1" />
    <testcase name="skipped" classname="" time="0" file="test/b.test.ts" line="2"><skipped /></testcase>
  </testsuite>
</testsuites>`;

  test("a file's time is the sum of its test cases, nested ones too, slowest first", () => {
    expect(fileTimes(XML)).toEqual([
      { file: "test/b.test.ts", seconds: 3, tests: 2 },
      { file: "test/a.test.ts", seconds: 2, tests: 2 },
    ]);
  });

  test("it prints the table and fills the summary; a missing file is a line and exit 0", () => {
    const xml = join(WORK, "junit.xml");
    writeFileSync(xml, XML);
    const summary = join(WORK, "times.md");
    const run = (path: string) =>
      Bun.spawnSync([process.execPath, join(ROOT, "tools/ci/test-times.ts"), path], {
        env: { ...process.env, GITHUB_STEP_SUMMARY: summary },
        stdout: "pipe",
        stderr: "pipe",
      });
    const ok = run(xml);
    expect(ok.exitCode).toBe(0);
    expect(ok.stdout.toString()).toContain("5 s in test cases of 10 s total");
    expect(readFileSync(summary, "utf8")).toContain("| 3.0 | 2 | `test/b.test.ts` |");
    const gone = run(join(WORK, "not-there.xml"));
    expect(gone.exitCode).toBe(0);
    expect(gone.stdout.toString()).toContain("no junit file");
  });
});

describe("the install loop's named tarball", () => {
  test("a name that isn't a file is refused, not quietly packed", () => {
    const r = Bun.spawnSync(["bash", join(ROOT, "tools/install-loop/run.sh"), join(WORK, "loop")], {
      env: { ...process.env, HOME: join(WORK, "real-home"), INSTALL_LOOP_TARBALL: join(WORK, "not-there.tgz") },
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(r.exitCode).toBe(1);
    expect(r.stdout.toString()).toContain("REFUSED: INSTALL_LOOP_TARBALL names no file");
  });
});
