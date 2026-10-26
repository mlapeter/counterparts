/**
 * The hosted package stays out of the npm core: nothing under `src/` imports
 * `hosted/`, and the published `files` never include it.
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";

const REPO = fileURLToPath(new URL("../../", import.meta.url));

function tsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...tsFiles(p));
    else if (/\.(ts|mjs|js)$/.test(name)) out.push(p);
  }
  return out;
}

describe("the boundary between the core and the hosted server", () => {
  test("nothing under src/ imports hosted/", () => {
    const offenders = tsFiles(join(REPO, "src")).filter((f) => /from\s+["'][^"']*\/hosted\//.test(readFileSync(f, "utf8")) || /import\(\s*["'][^"']*\/hosted\//.test(readFileSync(f, "utf8")));
    assert.deepEqual(offenders, []);
  });

  test("the published files never include hosted/, and the hosted package is private", () => {
    const pkg = JSON.parse(readFileSync(join(REPO, "package.json"), "utf8")) as { files: string[] };
    assert.ok(pkg.files.every((f) => !f.startsWith("hosted")));
    assert.ok(pkg.files.includes("src/"));
    const hosted = JSON.parse(readFileSync(join(REPO, "hosted", "package.json"), "utf8")) as { private: boolean };
    assert.equal(hosted.private, true);
  });
});
