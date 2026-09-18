/**
 * THE PAGE'S OTHER SURFACES — the owner's console, the "what fired" view, the
 * doctor line and the dashboard.
 *
 * Its own file rather than an addition to `cli.test.ts`, `doctor.test.ts` or
 * `fired.test.ts`: those three are the shared ones, and a page that lands in
 * parallel with other work should not be the reason a merge fights.
 *
 * Hermetic: a fresh temp dir per test, removed afterwards. Page bodies are
 * neutral placeholder prose.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { COMMAND_FLAGS, EXIT, commandHelp, run, unknownFlag, usage } from "../src/adapters/cli/index.js";
import type { Io } from "../src/adapters/cli/index.js";
import { firedReport } from "../src/adapters/fired.js";
import { expandHandle } from "../src/adapters/mcp/deliberate.js";
import { activate, TUNABLES as RECALL_TUNABLES } from "../src/core/recall/index.js";
import { selfPageFindings } from "../src/adapters/claude-code/doctor.js";
import { sourceOf } from "../src/adapters/dashboard/source.js";
import { mindView } from "../src/adapters/dashboard/web/views.js";
import { Counterpart } from "../src/core/counterpart.js";
import { Store, dateOf } from "../src/core/store/index.js";
import { PAGE_CORE_HEADING, PAGE_LATELY_HEADING } from "../src/core/self/index.js";

const PAGE = `## ${PAGE_CORE_HEADING}\n\nCore: placeholder.\n\n## ${PAGE_LATELY_HEADING}\n\nLately: placeholder.`;
const PAGE_TWO = `## ${PAGE_CORE_HEADING}\n\nCore: placeholder two.\n\n## ${PAGE_LATELY_HEADING}\n\nLately: placeholder two.`;

let root: string;
let dir: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "counterparts-page-cli-"));
  dir = join(root, "store");
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

interface Console_ {
  readonly io: Io;
  readonly out: string[];
  readonly err: string[];
}

function consoleWith(): Console_ {
  const out: string[] = [];
  const err: string[] = [];
  return { io: { out: (l) => out.push(l), err: (l) => err.push(l) }, out, err };
}

/** A store on disk, and whatever page the test wants in it. */
function withPage(body: string | null): void {
  const c = Counterpart.open({ dir });
  if (body !== null) c.revisePage(body, { reason: "a placeholder first page", by: "owner" });
  c.store.close();
}

function pageFile(body: string): string {
  const path = join(root, "page.md");
  writeFileSync(path, body, "utf8");
  return path;
}

// ── the console ─────────────────────────────────────────────────────────────

describe("counterparts self-page", () => {
  test("a store with no page prints the honest absence and a way to start", async () => {
    withPage(null);
    const c = consoleWith();
    const code = await run(["self-page", `--dir=${dir}`], { io: c.io, env: {} });
    expect(code).toBe(EXIT.ok);
    const said = c.out.join("\n");
    expect(said).toContain("still forming");
    expect(said).toContain("--write --file");
    expect(said).toContain(`## ${PAGE_CORE_HEADING}`);
  });

  test("--write --file replaces the page whole and says when it will be read", async () => {
    withPage(null);
    const c = consoleWith();
    const code = await run(
      ["self-page", "--write", `--file=${pageFile(PAGE)}`, "--reason=a placeholder first page", `--dir=${dir}`],
      { io: c.io, env: {} },
    );
    expect(code).toBe(EXIT.ok);
    expect(c.out.join("\n")).toContain("Wrote the page");
    expect(c.out.join("\n")).toContain("next boundary");

    const store = Store.open({ dir, observer: true });
    const page = Counterpart.open({ dir, observer: true });
    expect(page.selfPage()?.body).toBe(PAGE);
    expect(page.selfPage()?.by).toBe("owner");
    expect(store.eventLog({ name: "self.page.revised" })).toHaveLength(1);
    store.close();
    page.store.close();
  });

  test("--write --stdin reads the page from a pipe, and refuses a terminal", async () => {
    withPage(null);
    const piped = consoleWith();
    const code = await run(["self-page", "--write", "--stdin", `--dir=${dir}`], {
      io: piped.io,
      env: {},
      stdin: { isTty: false, read: async () => PAGE },
    });
    expect(code).toBe(EXIT.ok);

    const tty = consoleWith();
    const refused = await run(["self-page", "--write", "--stdin", `--dir=${dir}`], {
      io: tty.io,
      env: {},
      stdin: { isTty: true, read: async () => PAGE_TWO },
    });
    expect(refused).toBe(EXIT.usage);
    expect(tty.err.join("\n")).toContain("stdin is a terminal");
    const c = Counterpart.open({ dir, observer: true });
    expect(c.selfPage()?.body).toBe(PAGE);
    c.store.close();
  });

  test("--write with neither --file nor --stdin refuses before opening anything", async () => {
    withPage(null);
    const c = consoleWith();
    const code = await run(["self-page", "--write", `--dir=${dir}`], { io: c.io, env: {} });
    expect(code).toBe(EXIT.usage);
    expect(c.err.join("\n")).toContain("--write needs the page");
  });

  test("--versions lists what it used to say, and --version prints one in full", async () => {
    withPage(PAGE);
    const c0 = Counterpart.open({ dir });
    c0.revisePage(PAGE_TWO, { reason: "a placeholder second page", by: "session" });
    c0.store.close();

    const list = consoleWith();
    expect(await run(["self-page", "--versions", `--dir=${dir}`], { io: list.io, env: {} })).toBe(EXIT.ok);
    expect(list.out.join("\n")).toContain("1 earlier version");
    expect(list.out.join("\n")).toContain("a placeholder second page");

    const one = consoleWith();
    expect(await run(["self-page", "--version=1", `--dir=${dir}`], { io: one.io, env: {} })).toBe(EXIT.ok);
    expect(one.out.join("\n")).toContain(PAGE);

    const missing = consoleWith();
    expect(await run(["self-page", "--version=9", `--dir=${dir}`], { io: missing.io, env: {} })).toBe(EXIT.usage);
    expect(missing.err.join("\n")).toContain("no version 9");
  });

  test("reading works under observer; writing refuses there and changes nothing", async () => {
    withPage(PAGE);
    const read = consoleWith();
    expect(await run(["self-page", "--observer", `--dir=${dir}`], { io: read.io, env: {} })).toBe(EXIT.ok);
    expect(read.out.join("\n")).toContain("Core: placeholder.");

    const write = consoleWith();
    const code = await run(
      ["self-page", "--write", `--file=${pageFile(PAGE_TWO)}`, "--observer", `--dir=${dir}`],
      { io: write.io, env: {} },
    );
    expect(code).toBe(EXIT.refused);
    expect(write.err.join("\n")).toContain("observer stance");
    const c = Counterpart.open({ dir, observer: true });
    expect(c.selfPage()?.body).toBe(PAGE);
    expect(c.selfPageVersions()).toHaveLength(0);
    c.store.close();
  });

  test("a page past the hard limit is refused by the console, not cut", async () => {
    withPage(PAGE);
    const c = consoleWith();
    const code = await run(
      ["self-page", "--write", `--file=${pageFile("x".repeat(40_000))}`, `--dir=${dir}`],
      { io: c.io, env: {} },
    );
    expect(code).toBe(EXIT.refused);
    expect(c.err.join("\n")).toContain("past the hard limit");
    const after = Counterpart.open({ dir, observer: true });
    expect(after.selfPage()?.body).toBe(PAGE);
    after.store.close();
  });

  test("--clear unwrites the page, keeps it as a version, and --restore puts it back", async () => {
    withPage(PAGE);
    const cleared = consoleWith();
    expect(await run(["self-page", "--clear", "--reason=no longer true", `--dir=${dir}`], {
      io: cleared.io,
      env: {},
    })).toBe(EXIT.ok);
    expect(cleared.out.join("\n")).toContain("Cleared the page");

    // The store reads as having no page — which is what puts the wake back to
    // its empty-page behaviour — and nothing was destroyed.
    const after = consoleWith();
    await run(["self-page", `--dir=${dir}`], { io: after.io, env: {} });
    expect(after.out.join("\n")).toContain("still forming");

    const list = consoleWith();
    await run(["self-page", "--versions", `--dir=${dir}`], { io: list.io, env: {} });
    expect(list.out.join("\n")).toContain("1 earlier version");

    const back = consoleWith();
    expect(await run(["self-page", "--restore=1", `--dir=${dir}`], { io: back.io, env: {} })).toBe(EXIT.ok);
    const c = Counterpart.open({ dir, observer: true });
    expect(c.selfPage()?.body).toBe(PAGE);
    c.store.close();
  });

  test("--restore refuses a seq that is not there, and --clear on no page says so", async () => {
    withPage(null);
    const missing = consoleWith();
    expect(await run(["self-page", "--restore=4", `--dir=${dir}`], { io: missing.io, env: {} })).toBe(
      EXIT.usage,
    );
    expect(missing.err.join("\n")).toContain("no version 4");

    const nothing = consoleWith();
    expect(await run(["self-page", "--clear", `--dir=${dir}`], { io: nothing.io, env: {} })).toBe(
      EXIT.refused,
    );
    expect(nothing.err.join("\n")).toContain("a page has to say something");
  });

  test("--if-version guards a write, and two modes on one line are refused", async () => {
    withPage(PAGE);
    const stale = consoleWith();
    expect(
      await run(
        ["self-page", "--write", `--file=${pageFile(PAGE_TWO)}`, "--if-version=7", `--dir=${dir}`],
        { io: stale.io, env: {} },
      ),
    ).toBe(EXIT.refused);
    expect(stale.err.join("\n")).toContain("moved on");

    const fresh = consoleWith();
    expect(
      await run(
        ["self-page", "--write", `--file=${pageFile(PAGE_TWO)}`, "--if-version=0", `--dir=${dir}`],
        { io: fresh.io, env: {} },
      ),
    ).toBe(EXIT.ok);

    const both = consoleWith();
    expect(await run(["self-page", "--clear", "--versions", `--dir=${dir}`], { io: both.io, env: {} })).toBe(
      EXIT.usage,
    );
    expect(both.err.join("\n")).toContain("Pass one");
  });

  test("--version prints the body on stdout and its header on stderr, so a redirect is the page", async () => {
    withPage(PAGE);
    const c0 = Counterpart.open({ dir });
    c0.revisePage(PAGE_TWO, { reason: "second", by: "owner" });
    c0.store.close();
    const one = consoleWith();
    await run(["self-page", "--version=1", `--dir=${dir}`], { io: one.io, env: {} });
    expect(one.out.join("\n")).toBe(PAGE);
    expect(one.err.join("\n")).toContain("version 1");
  });

  test("a redaction is reported to the owner, who wrote the file himself", async () => {
    withPage(null);
    const c = consoleWith();
    const body = "## Core\n\nMy key is sk-ant-api03-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA and I use it.";
    await run(["self-page", "--write", `--file=${pageFile(body)}`, `--dir=${dir}`], { io: c.io, env: {} });
    expect(c.out.join("\n")).toContain("the gate redacted the page");
    const after = Counterpart.open({ dir, observer: true });
    expect(after.selfPage()?.body).not.toContain("sk-ant-api03");
    after.store.close();
  });

  test("remove refuses the page by name and points at the door that works", async () => {
    withPage(PAGE);
    const c0 = Counterpart.open({ dir, observer: true });
    const id = c0.selfPage()?.id as string;
    c0.store.close();

    const c = consoleWith();
    expect(await run(["remove", id, "--confirm", `--dir=${dir}`], { io: c.io, env: {} })).toBe(
      EXIT.refused,
    );
    expect(c.err.join("\n")).toContain("self-page --clear");
    // And the store still opens, which is the whole point.
    const after = Counterpart.open({ dir, observer: true });
    expect(after.selfPage()?.body).toBe(PAGE);
    after.store.close();
  });

  test("it is on the console's usage, its help lists its own flags, and a wrong flag is refused", () => {
    expect(usage()).toContain("self-page");
    const help = commandHelp("self-page");
    for (const flag of COMMAND_FLAGS["self-page"]) expect(help).toContain(`--${flag}`);
    expect(unknownFlag("self-page", ["--pages"])).not.toBeNull();
    expect(unknownFlag("self-page", ["--write"])).toBeNull();
  });
});

// ── the other three surfaces ────────────────────────────────────────────────

describe("the page is visible where mechanisms are", () => {
  test("`fired` carries one row for the page, blind before a write and firing after", () => {
    withPage(null);
    const before = Store.open({ dir, observer: true });
    const blind = firedReport(before, dateOf(Date.now())).rows.find((r) => r.id === "self-page");
    expect(blind).toBeDefined();
    // Never fired, and its evidence is younger than the window: `new`, which is
    // the state that says "not yet a worry" rather than "broken".
    expect(["never", "new"]).toContain(blind?.state ?? "");
    before.close();

    withPage(PAGE);
    const after = Store.open({ dir, observer: true });
    const row = firedReport(after, dateOf(Date.now())).rows.find((r) => r.id === "self-page");
    expect(row?.state).toBe("firing");
    expect(row?.firedInWindow).toBe(1);
    after.close();
  });

  test("doctor reads the page: green and honest when absent, green with its date when written", () => {
    withPage(null);
    const empty = Store.open({ dir, observer: true });
    const absent = selfPageFindings(empty)[0];
    expect(absent?.severity).toBe("green");
    expect(absent?.detail).toContain("still forming");
    expect(absent?.data["present"]).toBe(false);
    empty.close();

    withPage(PAGE);
    const written = Store.open({ dir, observer: true });
    const found = selfPageFindings(written)[0];
    expect(found?.severity).toBe("green");
    expect(found?.data["present"]).toBe(true);
    expect(found?.data["stale"]).toBe(false);
    expect(found?.detail).toContain("version 0");
    written.close();
  });

  test("a page that has stopped being revised goes amber", () => {
    withPage(PAGE);
    const today = dateOf(Date.now());
    const later = Store.open({
      dir,
      observer: true,
      now: () => Date.parse(`${today}T00:00:00Z`) + 40 * 86_400_000,
    });
    const found = selfPageFindings(later)[0];
    expect(found?.severity).toBe("amber");
    expect(found?.data["stale"]).toBe(true);
    expect(found?.fix.length).toBeGreaterThan(0);
    later.close();
  });

  test("the dashboard shows the page and every earlier version, read-only", () => {
    withPage(PAGE);
    const writer = Counterpart.open({ dir });
    writer.revisePage(PAGE_TWO, { reason: "a placeholder second page", by: "session" });
    writer.store.close();
    // The dashboard reads as an instrument, and only as one.
    const c = Counterpart.open({ dir, observer: true });
    const view = mindView(sourceOf(c));
    expect(view.pageAbsent).toBeNull();
    expect(view.page?.body).toBe(PAGE_TWO);
    expect(view.page?.core).toBe("Core: placeholder two.");
    expect(view.page?.lately).toBe("Lately: placeholder two.");
    expect(view.page?.version).toBe(1);
    expect(view.page?.stale).toBe(false);
    expect(view.pageVersions).toHaveLength(1);
    expect(view.pageVersions[0]?.body).toBe(PAGE);
    c.store.close();
  });

  /**
   * The page is delivered whole at every wake. Leaving it in the candidate pool
   * meant it could be quoted back on a turn that was already carrying it, could
   * accrue use credit and association edges for being what it always is, and —
   * a schema row has no project scope — could surface under a project the owner
   * never wrote it in. The review proved it came back as a footnote for a cue
   * drawn from its own body.
   */
  test("the page never comes back from recall — not by search, not by id", async () => {
    withPage(null);
    const c = Counterpart.open({ dir });
    c.revisePage(
      "## Core\n\nCore: the placeholder mentions a distinctive marmalade telescope.",
      { reason: "first", by: "owner" },
    );
    // Enough ordinary rows for rarity to discriminate — the token channel is
    // what makes the positive control mean anything.
    for (let i = 0; i < 24; i++) {
      c.store.put({
        type: "memory",
        kind: "fact",
        body: `A placeholder filler note number ${i}, about nothing in particular at all.`,
        salience: { novelty: 0.5, relevance: 0.5, emotional: 0.2, predictive: 0.2 },
      });
    }
    // An ordinary memory with the same distinctive words, to prove the cue works.
    const id = c.store.put({
      type: "memory",
      kind: "fact",
      body: "A placeholder note about a distinctive marmalade telescope.",
      salience: { novelty: 0.8, relevance: 0.9, emotional: 0.5, predictive: 0.5 },
    });
    const pageId = c.selfPage()?.id as string;
    c.store.close();

    const reader = Counterpart.open({ dir });
    // THE SEARCH DOOR, at the layer the exclusion lives in. `activate` is where
    // a cue becomes a candidate; the ordinary memory with the same words is the
    // positive control, so the page's absence is the exclusion and not the cue.
    const out = activate(
      reader.store,
      {
        text: "a distinctive marmalade telescope",
        day: reader.store.livedDay(),
        selfFelt: false,
        maxCandidates: 50,
        storeSize: reader.store.list({ archived: false }).length,
      },
      RECALL_TUNABLES,
    );
    const candidates = out.candidates.map((c) => c.id);
    expect(candidates).toContain(id);
    expect(candidates).not.toContain(pageId);

    // THE BY-ID DOOR, with its own positive control: expanding the page would
    // credit a use for a row the wake delivers whole every morning.
    expect(expandHandle(reader, id, { owner: true, sessionId: "s1" }).reason).toBe("expanded");
    expect(expandHandle(reader, pageId, { owner: true, sessionId: "s1" }).reason).toBe("handle-unknown");
    reader.store.close();
  });

  test("after a clear the dashboard shows the history the console shows", () => {
    withPage(PAGE);
    const w = Counterpart.open({ dir });
    w.clearPage({ reason: "cleared" });
    w.store.close();

    const c = Counterpart.open({ dir, observer: true });
    const view = mindView(sourceOf(c));
    expect(view.page).toBeNull();
    expect(view.pageAbsent).not.toBeNull();
    // The history is NOT gone with the live row — the console lists it, and two
    // surfaces answering "what did the page used to say" differently is the
    // mismatch the version reasons already were.
    expect(view.pageVersions.some((v) => v.body === PAGE)).toBe(true);
    c.store.close();

  });

  test("the dashboard says a blank store has no page rather than showing an empty one", () => {
    withPage(null);
    const c = Counterpart.open({ dir, observer: true });
    const view = mindView(sourceOf(c));
    expect(view.page).toBeNull();
    expect(view.pageAbsent).not.toBeNull();
    expect(view.pageVersions).toHaveLength(0);
    c.store.close();
  });
});
