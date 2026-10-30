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
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
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

describe("fetching the tested tarball", () => {
  const SHA = "a".repeat(40);
  let serial = 0;

  /** A stand-in `gh` serving one run and one artifact; `tweak` breaks what a test wants broken. */
  function fetch(tweak: { conclusion?: string; tamper?: boolean; loggedHash?: string; commit?: string; repoVersion?: string; noArtifact?: boolean } = {}) {
    const dir = join(WORK, `fetch${++serial}`);
    const artifact = join(dir, "artifact");
    const pkg = join(dir, "pkg", "package");
    mkdirSync(artifact, { recursive: true });
    mkdirSync(pkg, { recursive: true });
    mkdirSync(join(dir, "bin"));
    writeFileSync(join(pkg, "package.json"), '{\n  "name": "counterparts",\n  "version": "9.9.9"\n}\n');
    const name = "counterparts-9.9.9.tgz";
    expect(Bun.spawnSync(["tar", "-czf", join(artifact, name), "-C", join(dir, "pkg"), "package"]).exitCode).toBe(0);
    const hash = new Bun.CryptoHasher("sha256").update(readFileSync(join(artifact, name))).digest("hex");
    writeFileSync(join(artifact, "SHA256"), `${hash}  ${name}\n`);
    writeFileSync(join(artifact, "COMMIT"), `${tweak.commit ?? SHA}\n`);
    if (tweak.tamper) writeFileSync(join(artifact, name), "not the file that was tested");
    writeFileSync(join(dir, "log"), `x TARBALL_SHA256=${tweak.loggedHash ?? hash} ${name} commit ${SHA}\n`);
    writeFileSync(join(dir, "repo-package.json"), `{\n  "version": "${tweak.repoVersion ?? "9.9.9"}"\n}\n`);
    // `--jq` isn't evaluated here: each call answers with what the real filter would print.
    const gh = `#!/bin/bash
case "$*" in
  *"workflows/tests.yml/runs"*) echo "77 completed ${tweak.conclusion ?? "success"} https://example.test/run/77" ;;
  *"run download"*) ${tweak.noArtifact ? "exit 1" : `cp -R "${artifact}" "\${@: -1}"`} ;;
  *"/runs/77/jobs"*) echo 88 ;;
  *"/jobs/88/logs"*) cat "${join(dir, "log")}" ;;
  *"contents/package.json"*) cat "${join(dir, "repo-package.json")}" ;;
  *) echo "unexpected gh call: $*" >&2; exit 9 ;;
esac
`;
    writeFileSync(join(dir, "bin", "gh"), gh, { mode: 0o755 });
    const folder = join(dir, "release-folder");
    const r = Bun.spawnSync(["bash", join(ROOT, "tools/release/fetch-tarball.sh"), SHA, folder], {
      env: { ...process.env, PATH: `${join(dir, "bin")}:${process.env["PATH"]}` },
      stdout: "pipe",
      stderr: "pipe",
    });
    return { code: r.exitCode, out: r.stdout.toString() + r.stderr.toString(), folder, hash };
  }

  test("a green run with matching hashes writes the file, SHA256 and COMMIT", () => {
    const r = fetch();
    expect(r.out).toContain(`sha256 ${r.hash}`);
    expect(r.code).toBe(0);
    expect(readFileSync(join(r.folder, "SHA256"), "utf8")).toContain(r.hash);
    expect(readFileSync(join(r.folder, "COMMIT"), "utf8").trim()).toBe(SHA);
    const check = Bun.spawnSync(["shasum", "-a", "256", "-c", "SHA256"], { cwd: r.folder, stdout: "pipe" });
    expect(check.exitCode).toBe(0);
  });

  for (const [what, tweak, says] of [
    ["a run that didn't pass", { conclusion: "failure" }, "didn't pass"],
    ["a file that doesn't match its SHA256", { tamper: true }, "doesn't match"],
    ["a file that doesn't match the job's log", { loggedHash: "b".repeat(64) }, "the job's log says"],
    ["an artifact packed from another commit", { commit: "c".repeat(40) }, "was packed from"],
    ["a tarball of another version", { repoVersion: "9.9.8" }, "the commit says"],
    ["a run with no artifact", { noArtifact: true }, "no tarball artifact"],
  ] as const) {
    test(`${what} stops it and writes nothing`, () => {
      const r = fetch(tweak);
      expect(r.code).toBe(1);
      expect(r.out).toContain("STOP:");
      expect(r.out).toContain(says);
      expect(existsSync(r.folder)).toBe(false);
    });
  }
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
