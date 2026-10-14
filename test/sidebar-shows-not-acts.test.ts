/**
 * The sidebar the plugin directory carries shows memory; it does not act
 * (v1, the directory trim of 2026-10-14). Read as text, the way a reviewer's
 * scanner reads it: every hooks-module file the directory flavor ships
 * (`hooks/sidebar/hooks/`, less `speak-first.tsx` and `full.tsx`, which only
 * the full flavor carries) runs no command, calls no tool, starts no process,
 * submits no prompt and fetches nothing: what it shows comes from the status
 * file core writes beside the configuration (`src/adapters/sidebar-status.ts`),
 * read with `$.fs.read`. The dashboard is only ever a link.
 *
 * And no file the directory flavor ships names the SVG namespace URL in code
 * (the directory's review read it beside an environment read, or an
 * identifier called `key`, as a credential leaving the machine): the fox has
 * no SVG drawing any more, and the dashboard's favicon is a static image file
 * of its own, the one place the namespace stays (an SVG document served as an
 * image draws nothing without it).
 *
 * The fuller sidebar (the brain, the folder switch, the intro and dashboard
 * buttons) is kept on the branch `sidebar-full-0.3.22`.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { planBundle } from "../tools/plugin-bundle/build.js";

const REPO = join(import.meta.dir, "..");
const DIR = join(REPO, "hooks", "sidebar", "hooks");
const FULL_ONLY = new Set(["speak-first.tsx", "full.tsx"]);
const shipped = readdirSync(DIR).filter((f) => /\.tsx?$/.test(f) && !FULL_ONLY.has(f)).sort();
const source = (f: string): string => readFileSync(join(DIR, f), "utf8");

describe("the directory's sidebar shows, and does not act", () => {
  test("it ships register.tsx and the files beside it", () => {
    expect(shipped).toContain("register.tsx");
    expect(shipped).toContain("pane.tsx");
    expect(shipped).toContain("status.ts");
  });

  for (const call of ["$.command.run(", "$.mcp.call(", "$.process.run(", "$.prompt.submit(", "$.tool.list(", "$.http.fetch("]) {
    test(`no ${call}...) anywhere it ships`, () => {
      for (const f of shipped) expect({ f, has: source(f).includes(call) }).toEqual({ f, has: false });
    });
  }

  test("no network at all: no fetch by any spelling, no address it could read from", () => {
    for (const f of shipped) {
      const text = source(f);
      expect({ f, fetch: /\bhttp\s*\.\s*fetch\b|\bfetch\s*\(/.test(text) }).toEqual({ f, fetch: false });
      expect({ f, api: /\/api\//.test(text) }).toEqual({ f, api: false });
    }
  });

  test("what it shows, it reads from the status file beside the configuration", () => {
    expect(source("register.tsx")).toContain("$.fs.read(file)");
    expect(source("status.ts")).toContain("export const STATUS_FILE = 'sidebar.json'");
  });

  test("no port is read from the environment", () => {
    for (const f of shipped) expect({ f, reads: /env\.get\(\s*['"`]COUNTERPARTS_DASHBOARD_PORT/.test(source(f)) }).toEqual({ f, reads: false });
  });

  test("the pane holds no Button: nothing in it can be pressed into an action", () => {
    for (const f of shipped) expect({ f, has: /<Button\b/.test(source(f)) }).toEqual({ f, has: false });
  });
});

describe("the directory flavor names no SVG namespace URL in code", () => {
  const plan = planBundle(REPO, "directory");
  const files: [string, string][] = [
    ...Object.entries(plan.generated),
    ...plan.copied.filter((f) => !/\.(png|woff2)$/.test(f)).map((f): [string, string] => [f, readFileSync(join(REPO, f), "utf8")]),
  ];

  test("it ships the sidebar and the dashboard's server", () => {
    const names = files.map(([f]) => f);
    expect(names).toContain("hooks/sidebar/hooks/register.tsx");
    expect(names).toContain("src/adapters/dashboard/web/server.js");
  });

  test("no shipped file holds www.w3.org but the favicon and the desktop fox's own file, which reads nothing", () => {
    const holding = files.filter(([, text]) => text.includes("www.w3.org")).map(([f]) => f).sort();
    expect(holding).toEqual(["hooks/sidebar/hooks/fox-svg.ts", "src/adapters/dashboard/web/favicon.svg"]);
    const fox = files.find(([f]) => f === "hooks/sidebar/hooks/fox-svg.ts")?.[1] ?? "";
    expect(/\benv\b|\$\.env|process\.env|\bkey\b|\btoken\b|\$\.fs|\$\.http/.test(fox)).toBe(false);
  });
});
