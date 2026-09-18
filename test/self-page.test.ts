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
  PAGE_CORE_HEADING,
  PAGE_FORMING_LINE,
  PAGE_LATELY_HEADING,
  PAGE_TEMPLATE,
  PAGE_TITLE,
  SELF_PAGE_REFUSED_EVENT,
  SELF_PAGE_REVISED_EVENT,
  SELF_PAGE_ROLE,
  Self,
  byteLength,
  findIdentityCore,
  findSelfPage,
  identityCoreLine,
  identityCoreName,
  pageSections,
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
    expect(versions.map((v) => v.reason)).toEqual(["third", "second"]);
    expect(versions[0]?.body).toBe(PAGE_TWO);
    expect(versions[1]?.body).toBe(PAGE);
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
    const me = self(s, { PAGE_WAKE_BYTES: 180, PAGE_MAX_BYTES: 8000 });
    const long = [
      `## ${PAGE_CORE_HEADING}`,
      "",
      "Core: placeholder one.",
      "",
      "Core: placeholder two, which is a longer placeholder paragraph than the one above it.",
      "",
      `## ${PAGE_LATELY_HEADING}`,
      "",
      "Lately: placeholder, long enough to be cut off by the cap above it.",
    ].join("\n");
    me.revisePage(long, { reason: "long", by: "owner" });
    const b = me.build(req);

    expect(b.page?.truncated).toBe(true);
    expect(b.page?.wholeBytes).toBe(byteLength(long));
    expect(b.page?.bytes).toBeLessThanOrEqual(180);
    expect(b.text).toContain("Core: placeholder one.");
    expect(b.text).toContain(`the first ${b.text.match(/shows the first (\d+)/)?.[1] ?? ""}`);
    expect(b.text).toContain(`This page is ${byteLength(long)} bytes`);
    expect(b.text).toContain("counterparts self-page");
    // Cut at a boundary: the kept part does not end mid-word.
    expect(b.text).not.toContain("Lately: placeholder, long enough to be cut off by the cap");
    expect(readSentinelBytes(b.text)).toBe(byteLength(b.text));
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
    expect(c.selfPageVersions().map((v) => v.reason)).toEqual(["second"]);
    expect(c.selfPageVersions()[0]?.body).toBe(PAGE);
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
});

/** The sentinel's stated bytes, for the fixed-point assertions above. */
function readSentinelBytes(text: string): number {
  const last = text.split("\n").at(-1) ?? "";
  return Number(/bytes=(\d+)/.exec(last)?.[1] ?? -1);
}
