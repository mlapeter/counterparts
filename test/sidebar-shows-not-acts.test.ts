/**
 * The sidebar the plugin directory carries shows memory; it does not act
 * (v1, the directory trim of 2026-10-14). Read as text, the way a reviewer's
 * scanner reads it: every hooks-module file the directory flavor ships
 * (`hooks/sidebar/hooks/`, less `speak-first.tsx` and `full.tsx`, which only
 * the full flavor carries) runs no command, calls no tool, starts no process
 * and submits no prompt; and every dashboard read names its one fixed address
 * whole, at the call, never a computed one.
 *
 * The fuller sidebar (the brain, the folder switch, the intro and dashboard
 * buttons) is kept on the branch `sidebar-full-0.3.22`.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const DIR = join(import.meta.dir, "..", "hooks", "sidebar", "hooks");
const FULL_ONLY = new Set(["speak-first.tsx", "full.tsx"]);
const shipped = readdirSync(DIR).filter((f) => /\.tsx?$/.test(f) && !FULL_ONLY.has(f)).sort();
const source = (f: string): string => readFileSync(join(DIR, f), "utf8");

describe("the directory's sidebar shows, and does not act", () => {
  test("it ships register.tsx and the files beside it", () => {
    expect(shipped).toContain("register.tsx");
    expect(shipped).toContain("pane.tsx");
  });

  for (const call of ["$.command.run(", "$.mcp.call(", "$.process.run(", "$.prompt.submit(", "$.tool.list("]) {
    test(`no ${call}...) anywhere it ships`, () => {
      for (const f of shipped) expect({ f, has: source(f).includes(call) }).toEqual({ f, has: false });
    });
  }

  test("every $.http.fetch names http://127.0.0.1:4747 whole, at the call", () => {
    const sites: string[] = [];
    for (const f of shipped) {
      for (const m of source(f).matchAll(/\$\.http\.fetch\(\s*(.{0,40})/g)) sites.push(`${f}: ${m[1]}`);
    }
    expect(sites.length).toBeGreaterThan(0);
    for (const s of sites) expect(s).toMatch(/^[a-z-]+\.tsx?: (['`])http:\/\/127\.0\.0\.1:4747[/$]/);
  });

  test("no port is read from the environment", () => {
    for (const f of shipped) expect({ f, reads: /env\.get\(\s*['"`]COUNTERPARTS_DASHBOARD_PORT/.test(source(f)) }).toEqual({ f, reads: false });
  });

  test("the pane holds no Button: nothing in it can be pressed into an action", () => {
    for (const f of shipped) expect({ f, has: /<Button\b/.test(source(f)) }).toEqual({ f, has: false });
  });
});
