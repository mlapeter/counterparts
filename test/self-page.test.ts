/**
 * THE SELF PAGE — the row, the two doors, its place in the wake, and the proof
 * that a sleep cycle leaves it alone.
 *
 * Hermetic by construction (CLAUDE.md): every test makes a fresh temp data dir
 * in `beforeEach` and removes only that path in `afterEach`.
 *
 * The page bodies here are deliberately NEUTRAL PLACEHOLDER PROSE. A test
 * fixture that reads like a real first-person identity is a fixture somebody
 * later mistakes for one, and this file is about the mechanism, not the words.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Counterpart } from "../src/core/counterpart.js";
import { episodeGate } from "../src/core/bridge.js";
import { runCycle } from "../src/core/sleep/index.js";
import { Store } from "../src/core/store/index.js";
import {
  FRAMING,
  NO_PAGE_VERSION,
  PAGE_CLEARED_BODY,
  PAGE_CORE_HEADING,
  PAGE_FLOOR_RESERVE_BYTES,
  PAGE_FORMING_LINE,
  PAGE_LATELY_HEADING,
  PAGE_TEMPLATE,
  PAGE_TITLE,
  SELF_PAGE_REFUSED_EVENT,
  SELF_PAGE_REVISED_EVENT,
  SELF_PAGE_ROLE,
  Self,
  byteLength,
  clearedMarker,
  findIdentityCore,
  findPageRow,
  findSelfPage,
  identityCoreLine,
  identityCoreName,
  SELF_TUNABLES,
  pageDateline,
  pageSections,
  pageTooLargeLine,
  readSelfPage,
  renderPage,
  truncationMarker,
} from "../src/core/self/index.js";
import type { SelfTunables } from "../src/core/self/index.js";
import type { PutInput } from "../src/core/store/index.js";

const PAGE = `## ${PAGE_CORE_HEADING}\n\nCore: placeholder.\n\n## ${PAGE_LATELY_HEADING}\n\nLately: placeholder.`;
const PAGE_TWO = `## ${PAGE_CORE_HEADING}\n\nCore: placeholder two.\n\n## ${PAGE_LATELY_HEADING}\n\nLately: placeholder two.`;

let dir: string;
let priorEnv: string | undefined;
const open: { close(): void }[] = [];
/** Temp dirs a test made BESIDE `dir` — a second, empty store is the only
 *  honest way to ask what a store with no page says. Removed with `dir` in
 *  `afterEach`, not inline, so a failing expectation still leaves nothing
 *  behind (CLAUDE.md: every test removes the dir it creates). */
const extraDirs: string[] = [];

/** A fresh data dir outside `dir`, registered for removal. */
function otherDir(prefix: string): string {
  const made = mkdtempSync(join(tmpdir(), prefix));
  extraDirs.push(made);
  return made;
}

beforeEach(() => {
  priorEnv = process.env["COUNTERPARTS_DATA_DIR"];
  dir = mkdtempSync(join(tmpdir(), "counterparts-page-"));
  process.env["COUNTERPARTS_DATA_DIR"] = dir;
});

afterEach(() => {
  for (const s of open.splice(0)) {
    try {
      s.close();
    } catch {
      /* already closed by the test */
    }
  }
  rmSync(dir, { recursive: true, force: true });
  for (const other of extraDirs.splice(0)) rmSync(other, { recursive: true, force: true });
  if (priorEnv === undefined) delete process.env["COUNTERPARTS_DATA_DIR"];
  else process.env["COUNTERPARTS_DATA_DIR"] = priorEnv;
});

function store(opts: Parameters<typeof Store.open>[0] = {}): Store {
  const s = Store.open({ dir, ...opts });
  open.push(s);
  return s;
}

/** A `Self` with the REAL battery, which is what the composition root injects. */
function self(s: Store, tunables: Partial<SelfTunables> = {}): Self {
  return new Self({ store: s, gate: episodeGate(), tunables });
}

function identity(s: Store, body: string): string {
  return s.put({
    type: "memory",
    kind: "self",
    body,
    band: "identity",
    salience: { relevance: 0.8, emotional: 0.5, predictive: 0.5 },
    physics: { promotedIdentity: true },
  } satisfies PutInput);
}

// ── the row ─────────────────────────────────────────────────────────────────

describe("the page's row", () => {
  test("a blank store has no page, and says so rather than inventing one", () => {
    const s = store();
    expect(findSelfPage(s)).toBeNull();
    expect(readSelfPage(s)).toBeNull();
    expect(self(s).page()).toBeNull();
  });

  test("the seam writes ONE schema row with the page role, protected, titled", () => {
    const s = store();
    const out = self(s).revisePage(PAGE, { reason: "first", by: "session" });
    expect(out.written).toBe(true);
    expect(out.reason).toBe("created");
    expect(out.version).toBe(0);

    const id = findSelfPage(s);
    expect(id).toBe(out.id as string);
    const row = s.row(id as string);
    expect(row?.type).toBe("schema");
    expect(row?.kind).toBe("self");
    expect(row?.protected).toBe(1);
    expect(row?.archived).toBe(0);
    const doc = s.readProse(id as string);
    expect(doc.meta["role"]).toBe(SELF_PAGE_ROLE);
    expect(doc.title).toBe(PAGE_TITLE);
    expect(doc.body).toBe(PAGE);
    // AND AN ORDINARY PAGE REPORTS NO REDACTION. The signal is only worth
    // anything if it is silent when nothing was taken out — pinned here against
    // a gate that later starts normalizing what it is handed.
    expect(out.redacted).toBeNull();
    expect(out.warning).toBeNull();
    expect(out.gate).toBeNull();
  });

  test("the identity core and the page are two rows and neither finds the other", () => {
    const s = store();
    const me = self(s);
    me.ensureIdentityCore({ name: "Placeholder Owner" });
    me.revisePage(PAGE, { reason: "first", by: "owner" });
    const pages = s
      .list({ type: "schema", kind: "self", archived: false })
      .filter((id) => s.readProse(id).meta["role"] === SELF_PAGE_ROLE);
    expect(pages).toHaveLength(1);
    expect(me.page()?.id).toBe(pages[0] as string);
    // The core is still found, and the two are different rows: `findIdentityCore`
    // matches on `role: "entity"` and the page carries `role: "page"`.
    const core = findIdentityCore(s);
    expect(core).not.toBeNull();
    expect(core).not.toBe(me.page()?.id ?? "");
    expect(identityCoreName(s)).toBe("Placeholder Owner");
  });

  test("amending twice gives two readable versions, newest first", () => {
    const s = store();
    const me = self(s);
    me.revisePage(PAGE, { reason: "first", by: "session" });
    const second = me.revisePage(PAGE_TWO, { reason: "second", by: "owner" });
    const third = me.revisePage(`${PAGE_TWO}\n\nA third placeholder paragraph.`, {
      reason: "third",
      by: "session",
    });
    expect(second.version).toBe(1);
    expect(third.version).toBe(2);

    const versions = me.pageVersions();
    expect(versions.map((v) => v.seq)).toEqual([2, 1]);
    // EACH BODY LABELLED BY THE WRITE THAT PRODUCED IT, not by the one that
    // replaced it (adversarial review M3). `store.revise` records the replacing
    // reason on the row it archives, so reading it straight through labelled the
    // first page with the second write's words while the current page's own
    // `Last change:` line was right — one word, two meanings, two surfaces.
    expect(versions.map((v) => v.body)).toEqual([PAGE_TWO, PAGE]);
    expect(versions.map((v) => v.reason)).toEqual(["second", "first"]);
    expect(versions.map((v) => v.by)).toEqual(["owner", "session"]);
    // The store's own value is kept, named for what it actually is.
    expect(versions.map((v) => v.replacedBy)).toEqual(["third", "second"]);
    expect(versions.map((v) => v.bytes)).toEqual([byteLength(PAGE_TWO), byteLength(PAGE)]);
    expect(me.page()?.body).toBe(`${PAGE_TWO}\n\nA third placeholder paragraph.`);
    expect(me.page()?.version).toBe(2);
  });

  test("every revision leaves a durable row naming who, why, and the version", () => {
    const s = store();
    self(s).revisePage(PAGE, { reason: "first", by: "session" });
    self(s).revisePage(PAGE_TWO, { reason: "the nightly pass", by: "writer" });
    const rows = s.eventLog({ name: SELF_PAGE_REVISED_EVENT });
    expect(rows).toHaveLength(2);
    const payloads = rows.map((r) => JSON.parse(r.payload ?? "{}") as Record<string, unknown>);
    expect(payloads[0]?.["by"]).toBe("session");
    expect(payloads[0]?.["created"]).toBe(true);
    expect(payloads[1]?.["by"]).toBe("writer");
    expect(payloads[1]?.["reason"]).toBe("the nightly pass");
    expect(payloads[1]?.["version"]).toBe(1);
    expect(payloads[1]?.["bytes"]).toBe(byteLength(PAGE_TWO));
  });
});

// ── the refusals ────────────────────────────────────────────────────────────

describe("a write that does not land", () => {
  test("an empty body is refused, with a durable row and no page", () => {
    const s = store();
    const out = self(s).revisePage("   \n\n  ", { reason: "nothing", by: "session" });
    expect(out.written).toBe(false);
    expect(out.reason).toBe("empty");
    expect(findSelfPage(s)).toBeNull();
    expect(s.eventLog({ name: SELF_PAGE_REFUSED_EVENT })).toHaveLength(1);
  });

  test("a body over the hard cap is REFUSED, never cut — and the old page stands", () => {
    const s = store();
    const me = self(s, { PAGE_MAX_BYTES: 400 });
    me.revisePage(PAGE, { reason: "first", by: "owner" });
    const out = me.revisePage("x".repeat(500), { reason: "too big", by: "owner" });
    expect(out.written).toBe(false);
    expect(out.reason).toBe("too-large");
    expect(me.page()?.body).toBe(PAGE);
    expect(me.page()?.version).toBe(0);
    const refusals = s.eventLog({ name: SELF_PAGE_REFUSED_EVENT });
    expect(refusals).toHaveLength(1);
    const payload = JSON.parse(refusals[0]?.payload ?? "{}") as Record<string, unknown>;
    expect(payload["limit"]).toBe(400);
    expect(payload["bytes"]).toBe(500);
  });

  test("a page whose body is nothing but a credential is refused by the battery", () => {
    const s = store();
    const out = self(s).revisePage("sk-ant-api03-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA", {
      reason: "oops",
      by: "session",
    });
    expect(out.written).toBe(false);
    expect(out.reason).toBe("gate-refused");
    expect(out.gate).not.toBeNull();
    expect(findSelfPage(s)).toBeNull();
    expect(s.eventLog({ name: SELF_PAGE_REFUSED_EVENT })).toHaveLength(1);
  });

  test("a door with no battery wired in REFUSES rather than writing", () => {
    const s = store();
    const bare = new Self({ store: s });
    const out = bare.revisePage(PAGE, { reason: "first", by: "session" });
    expect(out.written).toBe(false);
    expect(out.reason).toBe("gate-refused");
    expect(findSelfPage(s)).toBeNull();
  });

  test("observer stance writes NOTHING — not the page, not even the refusal row", () => {
    const s = store();
    self(s).revisePage(PAGE, { reason: "first", by: "owner" });
    const before = s.readProse(findSelfPage(s) as string).body;

    const revisedBefore = s.eventLog({ name: SELF_PAGE_REVISED_EVENT }).length;

    const instrument = store({ observer: true });
    const out = self(instrument).revisePage(PAGE_TWO, { reason: "should not land", by: "session" });
    expect(out.written).toBe(false);
    expect(out.reason).toBe("observer");
    expect(instrument.eventLog({ name: SELF_PAGE_REFUSED_EVENT })).toHaveLength(0);
    expect(instrument.eventLog({ name: SELF_PAGE_REVISED_EVENT })).toHaveLength(revisedBefore);
    // Read back through a WRITER so nothing about the read is the instrument's.
    const after = store();
    expect(after.readProse(findSelfPage(after) as string).body).toBe(before);
    expect(after.versions(findSelfPage(after) as string)).toHaveLength(0);
  });

  test("a page accepted over the WAKE cap is kept whole and warns", () => {
    const s = store();
    const me = self(s, { PAGE_WAKE_BYTES: 100, PAGE_MAX_BYTES: 4000 });
    const long = `${PAGE}\n\n${"A placeholder paragraph. ".repeat(20)}`.trim();
    const out = me.revisePage(long, { reason: "long", by: "owner" });
    expect(out.written).toBe(true);
    expect(out.warning).toBe("over-wake-cap");
    expect(me.page()?.bytes).toBe(byteLength(long));
  });
});

// ── what the wake prints ────────────────────────────────────────────────────

describe("the page in the wake", () => {
  const req = { budgetBytes: 9000, day: 5 };

  test("a blank store wakes saying it is still forming, and does not crash", () => {
    const s = store();
    const me = self(s, { PAGE_EMPTY_SHOWS_LIST: false });
    const b = me.build(req);
    expect(b.text).toContain(FRAMING.identity);
    expect(b.text).toContain(PAGE_FORMING_LINE);
    expect(b.counts.identity).toBe(0);
    expect(b.elements).toBe(0);
    expect(b.page).toBeNull();
    expect(readSentinelBytes(b.text)).toBe(byteLength(b.text));
  });

  test("with the switch ON the list still renders while no page exists — the wake is unchanged", () => {
    const s = store();
    identity(s, "A placeholder identity element.");
    const withSwitch = self(s, { PAGE_EMPTY_SHOWS_LIST: true }).build(req);
    const withoutPageFeature = self(s).build(req);
    expect(withSwitch.text).toBe(withoutPageFeature.text);
    expect(withSwitch.text).toContain("A placeholder identity element.");
    expect(withSwitch.text).not.toContain(PAGE_FORMING_LINE);
    expect(withSwitch.counts.identity).toBe(1);
  });

  test("with the switch OFF the list is gone and the still-forming line stands alone", () => {
    const s = store();
    identity(s, "A placeholder identity element.");
    const b = self(s, { PAGE_EMPTY_SHOWS_LIST: false }).build(req);
    expect(b.text).toContain(PAGE_FORMING_LINE);
    expect(b.text).not.toContain("A placeholder identity element.");
    expect(b.counts.identity).toBe(0);
  });

  test("the page prints FIRST in Who I am, as is, and REPLACES the list", () => {
    const s = store();
    identity(s, "A placeholder identity element.");
    const me = self(s);
    me.revisePage(PAGE, { reason: "first", by: "session" });
    const b = me.build(req);

    expect(b.text).toContain(PAGE);
    expect(b.text).not.toContain("A placeholder identity element.");
    expect(b.counts.identity).toBe(0);
    expect(b.trimmed).toHaveLength(0);
    // FIRST: the page's own first line sits directly under the heading.
    const lines = b.text.split("\n");
    const heading = lines.indexOf(FRAMING.identity);
    expect(heading).toBeGreaterThan(0);
    expect(lines[heading + 1]).toBe(`## ${PAGE_CORE_HEADING}`);
    expect(b.page?.truncated).toBe(false);
    expect(b.page?.wholeBytes).toBe(byteLength(PAGE));
    expect(readSentinelBytes(b.text)).toBe(byteLength(b.text));
  });

  test("the page suppresses the day-0 line, which is about identity and not about it", () => {
    const s = store();
    const me = self(s);
    me.ensureIdentityCore({ name: "Placeholder Owner" });
    expect(me.build(req).text).toContain(identityCoreLine("Placeholder Owner"));
    me.revisePage(PAGE, { reason: "first", by: "owner" });
    const b = me.build(req);
    expect(b.text).not.toContain("No identity has formed here yet");
    expect(b.text).toContain(PAGE);
  });

  test("a page over the cap renders cut at a paragraph boundary, with a marker that names both numbers", () => {
    const s = store();
    const me = self(s, { PAGE_WAKE_BYTES: 420, PAGE_MAX_BYTES: 8000 });
    const long = [
      `## ${PAGE_CORE_HEADING}`,
      "",
      "Core: placeholder one.",
      "",
      ...Array.from({ length: 8 }, (_, i) => `Core: placeholder paragraph ${i}, of an ordinary length.\n`),
      `## ${PAGE_LATELY_HEADING}`,
      "",
      "Lately: placeholder, long enough to be cut off by the cap above it.",
    ].join("\n");
    me.revisePage(long, { reason: "long", by: "owner" });
    const b = me.build(req);

    expect(b.page?.truncated).toBe(true);
    expect(b.page?.wholeBytes).toBe(byteLength(long));
    expect(b.page?.bytes).toBeLessThanOrEqual(420);
    expect(b.text).toContain("Core: placeholder one.");
    expect(b.text).toContain(`the first ${b.text.match(/shows the first (\d+)/)?.[1] ?? ""}`);
    expect(b.text).toContain(`This page is ${byteLength(long)} bytes`);
    expect(b.text).toContain("counterparts self-page");
    // Cut at a boundary: the kept part does not end mid-word.
    expect(b.text).not.toContain("Lately: placeholder, long enough to be cut off by the cap");
    expect(readSentinelBytes(b.text)).toBe(byteLength(b.text));
  });

  /**
   * B1 — the cut used to take the last blank line wherever it was, so a page
   * whose only `\n\n` sits at byte 7 rendered as a heading and a marker: 110
   * bytes of a 9.5 KB page, in a wake whose identity list the page had just
   * suppressed. Four shapes, at the real cap, each asserted to use most of the
   * room it was given.
   */
  test("every page shape renders close to the cap — none of them collapses to a stub", () => {
    const cap = SELF_TUNABLES.PAGE_WAKE_BYTES;
    const shapes: [string, string, number][] = [
      // A bullet list under one heading: the single most likely shape, and the
      // one that rendered 110 bytes.
      [
        "a bullet list",
        `## ${PAGE_CORE_HEADING}\n\n${Array.from({ length: 400 }, (_, i) => `- Placeholder item ${i}, of an ordinary length.`).join("\n")}`,
        0.8,
      ],
      // One paragraph, no blank line at all after the heading: no boundary
      // exists, so the byte fallback is correct and must be nearly exact.
      [
        "one long paragraph",
        `## ${PAGE_CORE_HEADING}\n\n${"Placeholder prose that runs on without a break. ".repeat(200)}`,
        0.95,
      ],
      // Many short paragraphs: this shape always worked; it must keep working.
      [
        "many short paragraphs",
        Array.from({ length: 300 }, (_, i) => `Placeholder paragraph ${i}, of an ordinary length.`).join("\n\n"),
        0.8,
      ],
      // No newline anywhere.
      ["no newline at all", "Placeholder prose. ".repeat(600), 0.95],
    ];
    for (const [name, body, floor] of shapes) {
      const out = renderPage(body, cap);
      expect(out.truncated).toBe(true);
      expect(out.bytes).toBeLessThanOrEqual(cap);
      // The assertion that would have caught it: a real share of the room used.
      expect({ name, used: out.bytes >= cap * floor }).toEqual({ name, used: true });
    }
  });

  /**
   * B2 — the cap was clamped to the WHOLE budget, so the header, the framing
   * line, the heading, the dateline and the sentinel pushed the composition past
   * the ceiling with nothing left to trim. The same budget ladder the review
   * measured, with the page it measured.
   */
  test("a long page never puts the wake over the host's ceiling, at any budget", () => {
    const s = store();
    const me = self(s);
    const long = `## ${PAGE_CORE_HEADING}\n\n${Array.from({ length: 200 }, (_, i) => `Placeholder paragraph ${i}, of an ordinary length for a page.`).join("\n\n")}`;
    me.revisePage(long, { reason: "long", by: "owner" });
    expect(me.page()?.bytes).toBeGreaterThan(8000);
    for (const budgetBytes of [400, 900, 2000, 6000, 9000, 20000]) {
      const b = me.build({ budgetBytes, day: 5 });
      expect({ budgetBytes, over: b.overBudget }).toEqual({ budgetBytes, over: false });
      expect({ budgetBytes, fits: b.bytes <= budgetBytes }).toEqual({ budgetBytes, fits: true });
    }
  });

  test("a ceiling with no room for a page says so in one line rather than a fragment", () => {
    const s = store();
    const me = self(s);
    me.revisePage(`## ${PAGE_CORE_HEADING}\n\n${"Placeholder prose. ".repeat(100)}`, {
      reason: "long",
      by: "owner",
    });
    const bytes = me.page()?.bytes ?? 0;
    const b = me.build({ budgetBytes: 700, day: 5 });
    expect(b.text).toContain(pageTooLargeLine(bytes));
    expect(b.text).not.toContain("Placeholder prose.");
    expect(b.overBudget).toBe(false);
  });

  /**
   * MINOR-D. A page that does not FIT and a page that does not EXIST reached the
   * renderer as the same `null`, so with the switch off a store holding a page
   * printed "no page has been written here yet" — PR #71's rule broken, moved
   * from identity to the page.
   */
  test("a ceiling too small for the page never says the page was never written", () => {
    const s = store();
    const me = self(s, { PAGE_EMPTY_SHOWS_LIST: false });
    me.revisePage(`## ${PAGE_CORE_HEADING}\n\n${"Placeholder prose. ".repeat(500)}`, {
      reason: "long",
      by: "owner",
    });
    // Below the furniture reserve: nothing about the page can be said at all…
    const tiny = me.build({ budgetBytes: 400, day: 5 });
    expect(tiny.text).not.toContain(PAGE_FORMING_LINE);
    expect(tiny.overBudget).toBe(false);
    // …and just above it, the wake says the page exists and does not fit.
    const small = me.build({ budgetBytes: 700, day: 5 });
    expect(small.text).not.toContain(PAGE_FORMING_LINE);
    expect(small.text).toContain("no room for it in this wake");
    // A store that really has none still says so, at both sizes.
    const blank = store({ dir: otherDir("counterparts-page-c-") });
    expect(self(blank, { PAGE_EMPTY_SHOWS_LIST: false }).build({ budgetBytes: 400, day: 5 }).text).toContain(
      PAGE_FORMING_LINE,
    );
  });

  test("the reserve covers the widest furniture the wake can wrap a page in", () => {
    const header = "<!-- counterparts:wake day=999999 elements=999999 bytes=999999 -->";
    const sentinel =
      "<!-- counterparts:wake/end day=999999 identity=999999 craft=999999 threads=999999 hints=999999 horizon=999999 elements=999999 bytes=999999 -->";
    const dateline = pageDateline("2026-09-18", true, 999999) as string;
    const widest = byteLength(
      [header, FRAMING.context, "", FRAMING.identity, dateline, "", sentinel].join("\n"),
    );
    expect(widest).toBeLessThanOrEqual(PAGE_FLOOR_RESERVE_BYTES);
  });

  test("the cap is clamped to the caller's budget, so a page never outgrows the wake", () => {
    const s = store();
    const me = self(s, { PAGE_WAKE_BYTES: 6144 });
    me.revisePage(`${PAGE}\n\n${"A placeholder paragraph. ".repeat(40)}`, {
      reason: "long",
      by: "owner",
    });
    const b = me.build({ budgetBytes: 700, day: 5 });
    expect(b.page?.truncated).toBe(true);
    expect(b.page?.bytes).toBeLessThanOrEqual(700);
  });

  test("the page's date is printed, and staleness is SAID when it is stale", () => {
    const s = store();
    const me = self(s, { PAGE_STALE_DAYS: 3 });
    me.revisePage(PAGE, { reason: "first", by: "owner" });
    const today = s.today();
    expect(me.build(req).text).toContain(`(Last revised ${today}.)`);
    expect(me.pageStale()).toBe(false);

    // The same store, ten calendar days later.
    const later = store({ now: () => Date.parse(`${today}T00:00:00Z`) + 10 * 86_400_000 });
    const aged = self(later, { PAGE_STALE_DAYS: 3 });
    expect(aged.pageStale()).toBe(true);
    const text = aged.build(req).text;
    expect(text).toContain(`(Last revised ${today} — more than 3 days before this wake was composed.)`);
  });

  test("the published wake carries the page, and its sentinel still verifies", () => {
    const s = store();
    const me = self(s);
    me.revisePage(PAGE, { reason: "first", by: "session" });
    const out = me.boundary(req);
    expect(out.published).toBe(true);
    const woken = me.wake();
    expect(woken.ok).toBe(true);
    expect(woken.reason).toBe("delivered");
    expect(woken.text).toContain(PAGE);
  });

  test("the page renders on a composition that OMITS memories — the fallback is woken as the self", () => {
    const s = store();
    identity(s, "A placeholder identity element.");
    const me = self(s);
    me.revisePage(PAGE, { reason: "first", by: "session" });
    const b = me.build({ ...req, omit: () => true });
    expect(b.text).toContain(PAGE);
    expect(b.text).not.toContain("No identity has formed here yet");
  });

  test("PAGE_ON_EGRESS off keeps the page off a filtering composition, and the list comes back", () => {
    const s = store();
    identity(s, "A placeholder identity element.");
    const me = self(s, { PAGE_ON_EGRESS: false });
    me.revisePage(PAGE, { reason: "first", by: "session" });
    // The owner's own wake passes no `omit` and is untouched by the switch.
    expect(me.build(req).text).toContain(PAGE);
    // A composition that filters gets no page — and falls back to whatever the
    // predicate left standing, which is what it carried before S1.
    const out = me.build({ ...req, omit: () => false });
    expect(out.text).not.toContain("Core: placeholder.");
    expect(out.text).toContain("A placeholder identity element.");
    expect(out.counts.identity).toBe(1);
    expect(out.page).toBeNull();
  });

  test("a page with no readable date says so, and reads as stale rather than fresh", () => {
    const s = store();
    const me = self(s);
    me.revisePage(PAGE, { reason: "first", by: "owner" });
    // Only reachable on a hand-edited row; the point is which way it fails.
    s.revise(findSelfPage(s) as string, { meta: { revisedOn: "not-a-date" } });
    expect(me.pageStale()).toBe(true);
    expect(me.build(req).text).toContain("(Last revised — the page carries no readable date.)");
  });
});

// ── the doors' other halves ─────────────────────────────────────────────────

describe("the optimistic version check", () => {
  test("a write that crossed with another is refused, and hands back what is there", () => {
    const s = store();
    const me = self(s);
    me.revisePage(PAGE, { reason: "first", by: "session" });
    // A second writer that read before the first wrote.
    const stale = me.revisePage(PAGE_TWO, { reason: "second", by: "session", ifVersion: 7 });
    expect(stale.written).toBe(false);
    expect(stale.reason).toBe("version-moved");
    expect(stale.current).toEqual({ version: 0, body: PAGE });
    expect(me.page()?.body).toBe(PAGE);
    expect(s.eventLog({ name: SELF_PAGE_REFUSED_EVENT })).toHaveLength(1);
    // The version it actually read lands.
    expect(me.revisePage(PAGE_TWO, { reason: "second", by: "session", ifVersion: 0 }).written).toBe(true);
    // And omitting it behaves exactly as it always has: last write wins.
    expect(me.revisePage(PAGE, { reason: "third", by: "owner" }).written).toBe(true);
  });

  /**
   * MINOR-C. "I read no page" had no value, so every integer mismatched and the
   * first write a careful session made — one that read `present: false` and
   * passed the natural 0 back, as the description tells it to — was refused with
   * a sentence saying somebody else had written the page. Untrue, and with
   * nothing handed back to merge against.
   */
  test("ifVersion can say I READ NO PAGE, and names the two directions apart", () => {
    const s = store();
    const me = self(s);
    // A version that cannot be there is refused as `no-page`, not as a race.
    const wrong = me.revisePage(PAGE, { reason: "first", by: "owner", ifVersion: 0 });
    expect(wrong.reason).toBe("no-page");
    expect(wrong.current).toBeNull();
    expect(me.page()).toBeNull();

    // The sentinel is what a read of an empty store reports, and it lands.
    expect(me.revisePage(PAGE, { reason: "first", by: "owner", ifVersion: NO_PAGE_VERSION }).written).toBe(
      true,
    );
    // And the other direction: claiming there was none when there is one.
    const appeared = me.revisePage(PAGE_TWO, {
      reason: "second",
      by: "session",
      ifVersion: NO_PAGE_VERSION,
    });
    expect(appeared.reason).toBe("page-appeared");
    expect(appeared.current).toEqual({ version: 0, body: PAGE });
    expect(me.page()?.body).toBe(PAGE);
  });

  test("after a clear, the sentinel is what the page reads as again", () => {
    const s = store();
    const me = self(s);
    me.revisePage(PAGE, { reason: "first", by: "owner" });
    me.clearPage({ reason: "cleared" });
    expect(me.revisePage(PAGE_TWO, { reason: "again", by: "owner", ifVersion: NO_PAGE_VERSION }).written).toBe(
      true,
    );
  });
});

describe("clearing and restoring", () => {
  test("--clear keeps the body as a version and the store reads as having no page", () => {
    const s = store();
    const me = self(s);
    me.revisePage(PAGE, { reason: "first", by: "owner" });
    const id = findSelfPage(s) as string;

    const cleared = me.clearPage({ reason: "no longer true" });
    expect(cleared.written).toBe(true);
    expect(cleared.reason).toBe("cleared");
    // NO PAGE, from every reader's point of view — so the wake goes back to its
    // empty-page behaviour.
    expect(me.page()).toBeNull();
    expect(findSelfPage(s)).toBeNull();
    expect(me.build({ budgetBytes: 9000, day: 5 }).page).toBeNull();
    // ONE ROW, still live, still the page's row: the clear is a revision, so the
    // history stays on it and every door that reads history still reaches it.
    expect(s.row(id)?.archived).toBe(0);
    expect(findPageRow(s)).toBe(id);
    expect(s.readProse(id).body).toBe(PAGE_CLEARED_BODY);
    expect(clearedMarker(s.readProse(id).meta)?.reason).toBe("no longer true");
    expect(me.pageVersions().some((v) => v.body === PAGE)).toBe(true);
    expect(s.eventLog({ name: SELF_PAGE_REVISED_EVENT })).toHaveLength(2);
  });

  test("writing again after a clear revises the SAME row and keeps the history", () => {
    const s = store();
    const me = self(s);
    me.revisePage(PAGE, { reason: "first", by: "owner" });
    const id = findSelfPage(s) as string;
    me.clearPage({ reason: "starting over" });
    const again = me.revisePage(PAGE_TWO, { reason: "second thoughts", by: "owner" });
    expect(again.written).toBe(true);
    expect(again.id).toBe(id);
    expect(me.page()?.body).toBe(PAGE_TWO);
    // The cleared flag is dropped, and the page that was cleared is still a
    // version of this row.
    expect(clearedMarker(s.readProse(id).meta)).toBeNull();
    expect(me.pageVersions().some((v) => v.body === PAGE)).toBe(true);
  });

  test("--restore puts a version back, and is itself a version", () => {
    const s = store();
    const me = self(s);
    me.revisePage(PAGE, { reason: "first", by: "owner" });
    me.revisePage(PAGE_TWO, { reason: "second", by: "session" });
    expect(me.page()?.body).toBe(PAGE_TWO);

    const back = me.restorePage(1);
    expect(back.written).toBe(true);
    expect(me.page()?.body).toBe(PAGE);
    expect(me.page()?.reason).toBe("restored version 1");
    // Itself undoable: the restore archived PAGE_TWO as a version of its own.
    expect(me.pageVersions().some((v) => v.body === PAGE_TWO)).toBe(true);
  });

  /**
   * MAJOR-A. `--clear` used to archive the row, and `revisePage` finds LIVE rows,
   * so the `--restore <seq>` the clear message itself recommends minted a fresh
   * row and orphaned every version on the old one: the undo mechanism closed
   * behind the owner as he walked through it. One row for the life of the page.
   */
  test("clear then restore keeps the whole history, on one row, through two cycles", () => {
    const s = store();
    const me = self(s);
    me.revisePage(PAGE, { reason: "first", by: "owner" });
    const id = findSelfPage(s) as string;
    me.revisePage(PAGE_TWO, { reason: "second", by: "session" });
    me.clearPage({ reason: "cleared once" });
    expect(me.page()).toBeNull();

    // THE COMMAND THE CLEAR MESSAGE RECOMMENDS, and the history survives it.
    const seq = me.pageVersions()[0]?.seq as number;
    expect(me.restorePage(seq).written).toBe(true);
    expect(me.page()?.body).toBe(PAGE_TWO);
    expect(me.pageVersions().length).toBeGreaterThanOrEqual(3);
    expect(me.pageVersions().some((v) => v.body === PAGE)).toBe(true);

    // And again, to prove there is no accumulating second row to get confused by.
    me.clearPage({ reason: "cleared twice" });
    expect(me.page()).toBeNull();
    const seq2 = me.pageVersions()[0]?.seq as number;
    expect(me.restorePage(seq2).written).toBe(true);
    expect(me.page()?.body).toBe(PAGE_TWO);
    expect(me.pageVersions().some((v) => v.body === PAGE)).toBe(true);
    expect(findSelfPage(s)).toBe(id);
  });

  test("there is NEVER a second page row — live or archived — however often it is cleared", () => {
    const s = store();
    const me = self(s);
    const pageRows = (): string[] =>
      s
        .list({ type: "schema", kind: "self" })
        .filter((id) => {
          try {
            return s.readProse(id).meta["role"] === SELF_PAGE_ROLE;
          } catch {
            return false;
          }
        });

    me.revisePage(PAGE, { reason: "first", by: "owner" });
    for (let i = 0; i < 4; i++) {
      me.clearPage({ reason: `cleared ${i}` });
      expect(pageRows()).toHaveLength(1);
      me.revisePage(PAGE_TWO, { reason: `written ${i}`, by: "owner" });
      expect(pageRows()).toHaveLength(1);
      const seq = me.pageVersions()[0]?.seq as number;
      me.restorePage(seq);
      expect(pageRows()).toHaveLength(1);
    }
  });

  test("a cleared store wakes exactly like a store that never had a page", () => {
    const never = store();
    identity(never, "A placeholder identity element.");
    const a = self(never).build({ budgetBytes: 9000, day: 5 });

    // A SECOND store, written to and then cleared. The wake text must match the
    // one above byte for byte — "cleared" is a state of the row, never of the
    // bundle (adversarial review's requested proof).
    const other = mkdtempSync(join(tmpdir(), "counterparts-page-b-"));
    try {
      const s2 = Store.open({ dir: other });
      open.push(s2);
      identity(s2, "A placeholder identity element.");
      const me = self(s2);
      me.revisePage(PAGE, { reason: "first", by: "owner" });
      me.clearPage({ reason: "cleared" });
      const b = me.build({ budgetBytes: 9000, day: 5 });
      expect(b.text).toBe(a.text);
      expect(b.bytes).toBe(a.bytes);
      expect(b.page).toBeNull();
    } finally {
      rmSync(other, { recursive: true, force: true });
    }
  });

  test("restoring a version that is not there is named apart from having no page", () => {
    const s = store();
    const me = self(s);
    expect(me.restorePage(1).reason).toBe("empty");
    me.revisePage(PAGE, { reason: "first", by: "owner" });
    expect(me.restorePage(9).reason).toBe("no-such-version");
  });

  test("clearing a store that has no page changes nothing and says so", () => {
    const s = store();
    const out = self(s).clearPage({ reason: "nothing to clear" });
    expect(out.written).toBe(false);
    expect(out.reason).toBe("empty");
    expect(s.eventLog({ name: SELF_PAGE_REVISED_EVENT })).toHaveLength(0);
  });

  test("an observer clears nothing and writes no row", () => {
    const s = store();
    self(s).revisePage(PAGE, { reason: "first", by: "owner" });
    const instrument = store({ observer: true });
    expect(self(instrument).clearPage({ reason: "should not land" }).reason).toBe("observer");
    const after = store();
    expect(self(after).page()?.body).toBe(PAGE);
  });
});

// ── the sleep cycle ─────────────────────────────────────────────────────────

describe("the page survives sleep", () => {
  test("a full cycle and the prune leave the page's body, versions and row alone", () => {
    const s = store({ now: () => Date.parse("2026-01-01T00:00:00Z") });
    const me = self(s);
    me.revisePage(PAGE, { reason: "first", by: "owner" });
    me.revisePage(`${PAGE}\n\nAn interim placeholder paragraph.`, { reason: "second", by: "session" });
    me.revisePage(PAGE_TWO, { reason: "third", by: "session" });
    const id = findSelfPage(s) as string;
    const before = s.readProse(id);
    const versionsBefore = s.versions(id).length;
    // Two revisions of a page written once: the mint is not a version.
    expect(versionsBefore).toBe(2);

    // A memory beside it that the floor WILL take, so the prune is proved to
    // have run rather than to have found nothing.
    const doomed = s.put({
      type: "memory",
      kind: "fact",
      body: "A placeholder note nobody ever used again.",
      salience: { novelty: 0, relevance: 0, emotional: 0, predictive: 0 },
      physics: { birthDay: -400, lastUsedDay: -400 },
    } satisfies PutInput);

    let report = runCycle({ store: s, date: "2026-01-02", render: () => ({ bytes: 1 }) });
    // Several lived days of cycles — decay, consolidate, prune and dedup all
    // walking the page every time.
    for (let i = 3; i <= 8; i++) {
      report = runCycle({ store: s, date: `2026-01-0${i}`, render: () => ({ bytes: 1 }) });
    }

    expect(report.order).toContain("prune");
    expect(s.row(doomed)?.archived).toBe(1);

    const row = s.row(id);
    expect(row?.archived).toBe(0);
    expect(row?.superseded_by).toBeNull();
    expect(row?.protected).toBe(1);
    expect(s.readProse(id).body).toBe(before.body);
    expect(s.readProse(id).meta["role"]).toBe(SELF_PAGE_ROLE);
    expect(s.versions(id)).toHaveLength(versionsBefore);
    expect(me.page()?.body).toBe(PAGE_TWO);
  });

  /**
   * The adversarial review gave the page the physics that repeated recall
   * credit leaves and ran forty cycles: it came out `promoted_identity 1`,
   * `band identity`, with a `band.promoted` crossing record — a promotion event
   * on a row `scanActive` can never rank, counted by the promotion diagnostics
   * and printed as an identity-band memory. `dedup` has skipped schema rows
   * since it shipped; `consolidate` now does too.
   */
  /**
   * THE PAGE DOES NOT CROSS — and everything else crosses exactly as it did.
   *
   * A first attempt guarded schema rows generally. `physics#decay` returns 1 for
   * a promoted row, so that stopped beliefs, current-states and entities
   * becoming decay-exempt: a retention change for three row classes across the
   * owner's whole store, inside a PR about one page (adversarial review
   * MAJOR-B). This test is the branch half of the master-vs-branch diff that
   * found it — the four non-page classes must still promote here.
   */
  test("the page never crosses into the identity band, and nothing else changes", () => {
    const s = store();
    const ready = {
      salience: { novelty: 0.9, relevance: 0.95, emotional: 0.8, predictive: 0.9 },
      physics: { uses: 40, reinforcedDays: 20, birthDay: 0, lastUsedDay: 0 },
    } as const;
    const memory = s.put({ type: "memory", kind: "fact", body: "A placeholder memory used constantly.", ...ready });
    const belief = s.put({
      type: "schema",
      kind: "person",
      body: "A placeholder belief about a placeholder person.",
      meta: { role: "belief", entityId: "ent_placeholder" },
      ...ready,
    });
    const entity = s.put({
      type: "schema",
      kind: "entity",
      body: "Placeholder Entity",
      meta: { role: "entity", name: "Placeholder Entity", aliases: [] },
      ...ready,
    });
    const me = self(s);
    me.revisePage(PAGE, { reason: "first", by: "owner" });
    const page = findSelfPage(s) as string;
    // The same physics the others carry, so the page is promotion-READY and the
    // only thing standing between it and the band is the guard.
    s.updatePhysics(page, {
      uses: 40,
      reinforcedDays: 20,
      birthDay: 0,
      lastUsedDay: 0,
      salience: { novelty: 0.9, relevance: 0.95, emotional: 0.8, predictive: 0.9 },
    });

    for (let i = 1; i <= 12; i++) {
      runCycle({ store: s, date: `2026-03-${String(i).padStart(2, "0")}`, render: () => ({ bytes: 1 }) });
    }

    // The three that always crossed still cross, and stay decay-exempt.
    for (const id of [memory, belief, entity]) {
      expect({ id, promoted: s.row(id)?.promoted_identity }).toEqual({ id, promoted: 1 });
      expect(s.row(id)?.band).toBe("identity");
    }
    // The page does not, and leaves no crossing record.
    expect(s.row(page)?.promoted_identity).toBe(0);
    expect(s.row(page)?.band).not.toBe("identity");
    expect(s.eventLog({ name: "band.promoted", ref: page })).toHaveLength(0);
    expect(self(s).enumerate().identity.some((e) => e.id === page)).toBe(false);
    // And the page is still CONSOLIDATED, like every other row — only the
    // crossing is withheld.
    expect(s.row(page)?.consolidated).toBe(1);
  });

  test("a second page-shaped row is never merged into the page: schema rows skip dedup", () => {
    const s = store();
    const me = self(s);
    me.revisePage(PAGE, { reason: "first", by: "owner" });
    const id = findSelfPage(s) as string;
    // A memory whose body is byte-identical to the page — dedup's own hazard.
    s.put({ type: "memory", kind: "self", body: PAGE } satisfies PutInput);
    runCycle({ store: s, date: "2026-01-02", render: () => ({ bytes: 1 }) });
    expect(s.row(id)?.archived).toBe(0);
    expect(s.readProse(id).body).toBe(PAGE);
  });
});

// ── the composition root's seam ─────────────────────────────────────────────

describe("the seam S2 will call", () => {
  test("Counterpart.revisePage writes through the battery and reads back", () => {
    const c = Counterpart.open({ dir });
    open.push(c.store);
    expect(c.selfPage()).toBeNull();
    const out = c.revisePage(PAGE, { reason: "first", by: "writer" });
    expect(out.written).toBe(true);
    expect(c.selfPage()?.body).toBe(PAGE);
    expect(c.selfPage()?.by).toBe("writer");
    expect(c.selfPage()?.reason).toBe("first");
    c.revisePage(PAGE_TWO, { reason: "second", by: "owner" });
    expect(c.selfPageVersions().map((v) => v.reason)).toEqual(["first"]);
    expect(c.selfPageVersions()[0]?.body).toBe(PAGE);
    // The count does not read a single body off disk (adversarial review m9).
    expect(c.selfPageVersionCount()).toBe(1);
    expect(c.selfPageVersions({ bodies: false })[0]?.body).toBeNull();
  });
});

// ── the small pure pieces ───────────────────────────────────────────────────

describe("rendering and reading a page", () => {
  test("a page under the cap renders untouched", () => {
    const out = renderPage(PAGE, 9000);
    expect(out.text).toBe(PAGE);
    expect(out.truncated).toBe(false);
    expect(out.bytes).toBe(byteLength(PAGE));
  });

  test("a cut page stays inside the cap and carries the marker", () => {
    const body = Array.from({ length: 40 }, (_, i) => `Paragraph ${i}: placeholder.`).join("\n\n");
    const out = renderPage(body, 600);
    expect(out.truncated).toBe(true);
    expect(out.bytes).toBeLessThanOrEqual(600);
    expect(out.text).toContain(truncationMarker(byteLength(out.text.split("\n\n[This page")[0] ?? ""), byteLength(body)));
  });

  test("the sections split at the page's own headings", () => {
    const parts = pageSections(PAGE);
    expect(parts.headed).toBe(true);
    expect(parts.core).toBe("Core: placeholder.");
    expect(parts.lately).toBe("Lately: placeholder.");
  });

  test("a page with no headings is still a page", () => {
    const parts = pageSections("Just placeholder prose, with no headings at all.");
    expect(parts.headed).toBe(false);
    expect(parts.preamble).toBe("Just placeholder prose, with no headings at all.");
  });

  test("the offered template says still forming under both headings", () => {
    const parts = pageSections(PAGE_TEMPLATE);
    expect(parts.core).toBe("Still forming.");
    expect(parts.lately).toBe("Still forming.");
  });

  test("the template the console OFFERS is a page the seam ACCEPTS", () => {
    // The console prints `PAGE_TEMPLATE` as "a blank page to start from". A
    // console that hands the owner a page its own gate refuses would be an
    // invitation with no door behind it — the exact failure `self/` §3 names.
    const s = store();
    const out = self(s).revisePage(PAGE_TEMPLATE, { reason: "starting from the template", by: "owner" });
    expect(out.written).toBe(true);
    expect(out.warning).toBeNull();
    expect(readSelfPage(s)?.body).toBe(PAGE_TEMPLATE.trim());
  });
});

/** The sentinel's stated bytes, for the fixed-point assertions above. */
function readSentinelBytes(text: string): number {
  const last = text.split("\n").at(-1) ?? "";
  return Number(/bytes=(\d+)/.exec(last)?.[1] ?? -1);
}
