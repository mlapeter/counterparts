/**
 * Per-file test times, from the junit file `bun test --reporter=junit` writes.
 *
 *   bun tools/ci/test-times.ts <junit.xml> [howMany=20]
 *
 * Prints the slowest files to stdout and, in CI, to the job summary. It never fails
 * a job: timing is for reading, so a missing or odd file is a line and exit 0.
 *
 * What the number is: the sum of a file's test cases, which is the test bodies with
 * their beforeEach and afterEach. bun's own file-level `time` leaves out every test
 * inside a describe, so it isn't used. Imports and beforeAll/afterAll belong to no
 * test case, so a file with heavy setup reads faster than it is; the gap between the
 * sum and the run's total is printed for that reason.
 */

import { appendFileSync, existsSync, readFileSync } from "node:fs";

export interface FileTime {
  file: string;
  seconds: number;
  tests: number;
}

const attr = (tag: string, name: string): string | undefined =>
  new RegExp(`\\s${name}="([^"]*)"`).exec(tag)?.[1];

/** One `<testcase …` opening, attribute by attribute: a test's name may hold a `>`. */
const TESTCASE = /<testcase\b(?:\s+[\w:-]+="[^"]*")*/g;

export function fileTimes(xml: string): FileTime[] {
  const byFile = new Map<string, FileTime>();
  for (const [tag] of xml.matchAll(TESTCASE)) {
    const file = attr(tag, "file") ?? "(no file)";
    const row = byFile.get(file) ?? { file, seconds: 0, tests: 0 };
    row.seconds += Number(attr(tag, "time") ?? 0) || 0;
    row.tests += 1;
    byFile.set(file, row);
  }
  return [...byFile.values()].sort((a, b) => b.seconds - a.seconds);
}

function main(): void {
  const path = process.argv[2];
  const howMany = Number(process.argv[3] ?? 20) || 20;
  if (!path || !existsSync(path)) {
    console.log(`test times: no junit file at ${path ?? "(none given)"}`);
    return;
  }
  const xml = readFileSync(path, "utf8");
  const rows = fileTimes(xml);
  const sum = rows.reduce((total, r) => total + r.seconds, 0);
  const wall = Number(attr(/<testsuites\b[^>]*>/.exec(xml)?.[0] ?? "", "time") ?? 0) || 0;
  const about = `${rows.length} files; ${sum.toFixed(0)} s in test cases of ${wall.toFixed(0)} s total (imports and beforeAll/afterAll are in the gap)`;

  console.log(`slowest ${Math.min(howMany, rows.length)} test files: ${about}`);
  for (const r of rows.slice(0, howMany)) {
    console.log(`${r.seconds.toFixed(1).padStart(8)} s ${String(r.tests).padStart(5)} tests  ${r.file}`);
  }
  const summary = process.env["GITHUB_STEP_SUMMARY"];
  if (summary) {
    const table = rows.slice(0, howMany).map((r) => `| ${r.seconds.toFixed(1)} | ${r.tests} | \`${r.file}\` |`);
    appendFileSync(
      summary,
      [`### Slowest ${Math.min(howMany, rows.length)} test files`, "", about, "", "| seconds | tests | file |", "|---:|---:|---|", ...table, ""].join("\n"),
    );
  }
}

if (import.meta.main) {
  try {
    main();
  } catch (err) {
    console.log(`test times: ${String(err)}`);
  }
}
