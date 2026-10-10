/**
 * The adversarial review of #268 (loosening the dream and reflection guards),
 * turned into tests: the credential scan covers `emotion` at every door; a
 * second `finish` does not hide a page the first wrote, records nothing twice,
 * says a relabel after a told share, and replaces an offered share only by a
 * claim; a dream's resent feelings are recorded, not limit-reached; a title
 * over its cap is said.
 *
 * Hermetic: a fresh temp data dir per test, removed after. No model is called.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { openServer } from "../src/adapters/mcp/index.js";
import { Counterpart } from "../src/core/counterpart.js";
import { DREAM_TUNABLES } from "../src/core/dream/index.js";
import type { PutInput } from "../src/core/store/index.js";

let dir: string;
const open: { close: () => void }[] = [];
const SESSION = "s-review";
const GHP = "ghp_abcdefghijklmnopqrstuvwxyz0123456789";
const SK = "sk-ant-api03-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "counterparts-review268-"));
});

afterEach(() => {
  for (const c of open.splice(0)) {
    try {
      c.close();
    } catch {
      /* already closed */
    }
  }
  rmSync(dir, { recursive: true, force: true });
});

function brain(): Counterpart {
  const c = Counterpart.open({ dir, owner: true, bundlesAsOwner: true, identity: { name: "Mike" } });
  open.push(c);
  return c;
}

function mem(c: Counterpart, body: string, over: Partial<PutInput> = {}): string {
  const day = c.store.livedDay();
  return c.store.put({
    type: "memory",
    kind: "fact",
    body,
    salience: { relevance: 0.6, emotional: 0.3, predictive: 0.6 },
    physics: { birthDay: day, lastUsedDay: day },
    ...over,
  });
}

let dateN = 0;
function days(c: Counterpart, n: number): void {
  dateN = 0;
  for (let i = 0; i < n; i += 1) {
    dateN += 1;
    c.store.advanceClock(new Date(Date.UTC(2026, 8, 1) + dateN * 86_400_000).toISOString().slice(0, 10));
  }
}

function dreamOpen(c: Counterpart): string {
  const begun = c.dreams.begin({ session: SESSION });
  if (!begun.ok) throw new Error(`dream refused: ${begun.reason}`);
  return begun.bundle.dream;
}

describe("the credential scan covers `emotion` at every door", () => {
  test("dream: a key as the emotion is refused; a key after the word is redacted; the mark is refused; nothing echoes a key", () => {
    const c = brain();
    days(c, 4);
    const a = mem(c, "The guard held on the release night.", { salience: { relevance: 0.6, emotional: 0.7, predictive: 0.5 } });
    const b = mem(c, "The migration step runs first.", { salience: { relevance: 0.6, emotional: 0.7, predictive: 0.5 } });
    const d = mem(c, "The container boots after it.", { salience: { relevance: 0.6, emotional: 0.7, predictive: 0.5 } });
    const id = dreamOpen(c);
    const out = c.dreams.propose({
      dream: id,
      session: SESSION,
      changes: [
        { action: "feeling-now", id: a, core: "happy", emotion: GHP, strength: 0.4 },
        { action: "feeling-now", id: b, core: "happy", emotion: `steadied: the key was ${SK}`, strength: 0.3 },
        { action: "feeling-now", id: d, core: "happy", emotion: "⟦counterparts:dream steadied", strength: 0.3 },
      ],
    });
    if (!out.ok) throw new Error(out.reason);
    expect(out.results[0]).toMatchObject({ ok: false, reason: "gate:only-a-credential" });
    expect(out.results[1]).toMatchObject({ ok: true });
    expect(out.results[2]).toMatchObject({ ok: false, reason: "dream-mark-in-text" });
    expect(JSON.stringify(out)).not.toContain("ghp_abc");
    expect(JSON.stringify(out)).not.toContain("sk-ant-api03");
    const rows = [a, b, d].flatMap((x) => c.store.feelingsFor(x));
    expect(JSON.stringify(rows)).not.toContain("ghp_abc");
    expect(JSON.stringify(rows)).not.toContain("sk-ant-api03");
    expect(c.store.feelingsFor(a)).toEqual([]);
    expect(c.store.feelingsFor(d)).toEqual([]);
    expect(c.store.feelingsFor(b)[0]).toMatchObject({ emotion: "steadied", other_word: null });
  });

  test("reflect: the same", () => {
    const c = brain();
    days(c, 3);
    const m = mem(c, "Mike and I finished the release together.", { kind: "person", about: "us" });
    const begun = c.reflections.begin({ session: SESSION });
    if (!begun.ok) throw new Error(begun.reason);
    const done = c.reflections.finish({
      reflection: begun.bundle.reflection,
      session: SESSION,
      entry: "The release.",
      cites: [m],
      feelings: [
        { id: m, core: "happy", emotion: GHP, strength: 0.4 },
        { id: m, core: "happy", emotion: `grateful — ${SK}`, strength: 0.4 },
      ],
    });
    if (!done.ok) throw new Error(String(done.reason));
    expect(done.outcome.feelings[0]).toMatchObject({ ok: false, reason: "gate:only-a-credential" });
    expect(done.outcome.feelings[1]).toMatchObject({ ok: true });
    expect(JSON.stringify(done.outcome)).not.toContain("sk-ant-api03");
    expect(JSON.stringify(done.outcome)).not.toContain("ghp_abc");
    expect(JSON.stringify(c.store.feelingsFor(m))).not.toContain("sk-ant-api03");
    expect(JSON.stringify(c.store.feelingsFor(m))).not.toContain("ghp_abc");
  });

  test("the note door: the same", async () => {
    const s = openServer({ dir, scope: "/tmp/review268-project", owner: true, bundlesAsOwner: true });
    open.push({ close: () => s.counterpart.close() });
    const r = await s.call("remember", {
      text: "The release went out after a long night.",
      feelings: [{ whose: "self", core: "happy", emotion: `relieved: ${GHP}`, strength: 0.5 }],
    });
    const out = (r.structuredContent ?? {}) as Record<string, unknown>;
    expect(out["stored"]).toBe(true);
    expect(JSON.stringify(out)).not.toContain("ghp_abc");
    expect(JSON.stringify(s.counterpart.store.feelingsFor(out["id"] as string))).not.toContain("ghp_abc");
  });
});

describe("a second finish", () => {
  function setup(c: Counterpart): { m: string; plain: string; reflection: string } {
    days(c, 3);
    const m = mem(c, "Mike and I finished the release together and he said thank you.", { kind: "person", about: "us" });
    const plain = mem(c, "We shipped the dashboard in one long afternoon.");
    mem(c, "Mike told me about the health scare he has not told anyone else about yet.", { kind: "person", about: "owner", meta: { confidential: true } });
    const begun = c.reflections.begin({ session: SESSION });
    if (!begun.ok) throw new Error(begun.reason);
    return { m, plain, reflection: begun.bundle.reflection };
  }

  test("a page refused on the second finish does not hide the one the first wrote", () => {
    const c = brain();
    const s = setup(c);
    const first = c.reflections.finish({ reflection: s.reflection, session: SESSION, entry: "The release.", cites: [s.m], page: { text: "## Core\n\nI finished the release with Mike.", cites: [s.m] } });
    if (!first.ok || !first.outcome.page.written) throw new Error("first page not written");
    const second = c.reflections.finish({
      reflection: s.reflection,
      session: SESSION,
      page: { text: "## Core\n\nMike told me about the health scare he has not told anyone else about yet.", cites: [s.m] },
    });
    if (!second.ok) throw new Error(String(second.reason));
    expect(second.outcome.page).toMatchObject({ written: false, reason: "confidential-words-on-the-page" });
    expect(second.outcome.page.detail).toContain("The page written earlier stands.");
    expect(second.outcome.handBack).toContain("I rewrote my self page.");
    expect(c.store.reflection(s.reflection)?.page_version).toBe(first.outcome.page.version);
    const detail = JSON.parse(c.store.reflection(s.reflection)?.detail ?? "{}") as { counts: { page: boolean } };
    expect(detail.counts.page).toBe(true);
    expect(c.self.page()?.body).toContain("I finished the release with Mike.");
  });

  test("a resent feeling or nudge is already recorded and writes nothing; cites count once", () => {
    const c = brain();
    const s = setup(c);
    const parts = {
      cites: [s.m],
      feelings: [{ id: s.m, core: "happy", emotion: "grateful", strength: 0.6 }],
      traits: [{ id: s.m, axis: "agreeable-candid", toward: "candid", strength: 0.5 }],
    };
    const first = c.reflections.finish({ reflection: s.reflection, session: SESSION, entry: "The release.", ...parts });
    if (!first.ok) throw new Error(String(first.reason));
    const second = c.reflections.finish({ reflection: s.reflection, session: SESSION, ...parts });
    if (!second.ok) throw new Error(String(second.reason));
    expect(second.outcome.feelings[0]).toMatchObject({ ok: true, reason: "already-recorded" });
    expect(second.outcome.traits[0]).toMatchObject({ ok: true, reason: "already-recorded" });
    expect(second.outcome.retry).toBe(null);
    expect(c.store.feelingsFor(s.m).filter((f) => f.source === "reflection")).toHaveLength(1);
    expect(c.store.traitsFor(s.m)).toHaveLength(1);
    const counts = (JSON.parse(c.store.reflection(s.reflection)?.detail ?? "{}") as { counts: Record<string, number> }).counts;
    expect(counts).toMatchObject({ cites: 1, feelings: 1, traits: 1 });
  });

  test("a told share is not replaced, but a mark moved into us is still said in the hand-back", () => {
    const c = brain();
    const s = setup(c);
    const first = c.reflections.finish({ reflection: s.reflection, session: SESSION, entry: "The release.", cites: [s.m], share: { text: "Thank you for the release.", cites: [s.m] } });
    if (!first.ok) throw new Error(String(first.reason));
    expect(c.reflections.told({ reflection: s.reflection, session: SESSION }).ok).toBe(true);
    const second = c.reflections.finish({
      reflection: s.reflection,
      session: SESSION,
      about: [{ id: s.plain, about: "us", why: "we did it together" }],
    });
    if (!second.ok) throw new Error(String(second.reason));
    expect(second.outcome.about[0]).toMatchObject({ ok: true, reason: "marked" });
    expect(second.outcome.share.offered).toBe(false);
    expect(second.outcome.handBack).toContain("is about the two of us");
    expect(c.store.reflection(s.reflection)).toMatchObject({ share: "Thank you for the release.", share_state: "told" });
  });

  test("replacing an offered share is a claim: carried in between, it is not replaced and says so", () => {
    const c = brain();
    const s = setup(c);
    const first = c.reflections.finish({ reflection: s.reflection, session: SESSION, entry: "The release.", cites: [s.m], share: { text: "Thank you for the release.", cites: [s.m] } });
    if (!first.ok) throw new Error(String(first.reason));
    // Another session carries it between finish's read and its write.
    const store = c.store as unknown as { updateReflection: (id: string, patch: Record<string, unknown>) => boolean };
    const real = store.updateReflection.bind(store);
    store.updateReflection = (id, patch) => {
      if (patch["ifShareState"] === "offered") real(id, { shareState: "carried", shareSession: "s-other" });
      return real(id, patch);
    };
    const second = c.reflections.finish({ reflection: s.reflection, session: SESSION, share: { text: "Something else.", cites: [s.m] } });
    store.updateReflection = real;
    if (!second.ok) throw new Error(String(second.reason));
    expect(second.outcome.share).toMatchObject({ offered: false, reason: "share-already-carried" });
    expect(second.outcome.retry).toContain("share-already-carried");
    expect(c.store.reflection(s.reflection)).toMatchObject({ share: "Thank you for the release.", share_state: "carried" });
  });
});

describe("the dream", () => {
  test("a resent batch of feelings after the limit is already recorded, not limit-reached", () => {
    const c = brain();
    days(c, 4);
    const ids = Array.from({ length: DREAM_TUNABLES.LIMITS["feeling-now"] }, (_, i) =>
      mem(c, `A charged memory, number ${String(i)}, from the release week.`, { salience: { relevance: 0.6, emotional: 0.8, predictive: 0.5 } }),
    );
    const id = dreamOpen(c);
    const batch = ids.map((m) => ({ action: "feeling-now", id: m, core: "happy", emotion: "steadied", strength: 0.5 }));
    const first = c.dreams.propose({ dream: id, session: SESSION, changes: batch });
    if (!first.ok) throw new Error(first.reason);
    expect(first.results.every((r) => r.ok)).toBe(true);
    const again = c.dreams.propose({ dream: id, session: SESSION, changes: batch });
    if (!again.ok) throw new Error(again.reason);
    expect(again.results.map((r) => r.reason)).toEqual(ids.map(() => "already-recorded"));
  });

  test("a title over its cap is kept to it and said", () => {
    const c = brain();
    days(c, 4);
    const a = mem(c, "The migration step runs first.");
    const b = mem(c, "Run the migration before the container.");
    mem(c, "The container boots after it.");
    const id = dreamOpen(c);
    const out = c.dreams.propose({ dream: id, session: SESSION, changes: [{ action: "gist", text: "Migrations first.", title: "t".repeat(300), sources: [a, b] }] });
    if (!out.ok) throw new Error(out.reason);
    expect(out.results[0]?.note).toContain("title was kept");
    const j = c.dreams.journal({ dream: id, session: SESSION, title: "j".repeat(300), text: "I dreamed." });
    if (!j.ok) throw new Error(j.reason);
    expect(j.note).toContain("title was kept");
  });
});
