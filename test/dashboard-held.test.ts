/**
 * HD1 review R2 (2026-11-04): a memory deleted in a chat is on a 24-hour hold —
 * WHOLE and unarchived, unlike an owner removal, which is blanked and archived.
 * The dashboard's views read rows, so each one has to leave a held memory out
 * (lists, counts, today, search) and name it, where an id is resolved, in its
 * own words — "deleted in chat", not "removed by you". Released, it comes back.
 *
 * Over a real store through the observer source, as the dashboard opens it.
 * Hermetic: one temp dir per test, removed after it.
 */
import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Counterpart } from "../src/core/counterpart.js";
import { claimHold, holdForRemoval, releaseHold } from "../src/core/removal-hold.js";
import { REMOVAL_HOLD_MS } from "../src/core/store/index.js";
import { ABSENCE, resolveRef, sourceOf } from "../src/adapters/dashboard/index.js";
import type { DashboardSource } from "../src/adapters/dashboard/index.js";
import {
  activityView,
  healthView,
  memoriesView,
  memoryDetail,
  memoryListView,
  overviewView,
  searchView,
  tagView,
} from "../src/adapters/dashboard/web/views.js";
import { todayView } from "../src/adapters/dashboard/web/views/today.js";

const TITLE = "Quokka harbour lantern";
const BODY = "The quokka harbour lantern is kept in the blue shed behind the marina office.";
const OTHER_TITLE = "Dentist moved";
const OTHER = "The dentist moved the cleaning to the second Tuesday of the month.";
const TAG = "harbour";
/** Words of the victim that no other memory or view text carries. */
const SECRET_WORDS = ["Quokka", "quokka", "lantern", "marina"];

let dir: string;
const open: Counterpart[] = [];
let prevEnv: string | undefined;

beforeEach(() => {
  prevEnv = process.env["COUNTERPARTS_REQUIRE_EXPLICIT_DIR"];
  process.env["COUNTERPARTS_REQUIRE_EXPLICIT_DIR"] = "1";
  dir = mkdtempSync(join(tmpdir(), "counterparts-dash-held-"));
});

afterEach(() => {
  for (const c of open.splice(0)) c.close();
  rmSync(dir, { recursive: true, force: true });
  if (prevEnv === undefined) delete process.env["COUNTERPARTS_REQUIRE_EXPLICIT_DIR"];
  else process.env["COUNTERPARTS_REQUIRE_EXPLICIT_DIR"] = prevEnv;
});

function seed(): string {
  const c = Counterpart.open({ dir });
  const id = c.store.put({ type: "memory", kind: "fact", title: TITLE, body: BODY, tags: [TAG] });
  c.store.put({ type: "memory", kind: "fact", title: OTHER_TITLE, body: OTHER, tags: [TAG] });
  c.close();
  return id;
}

function withWritable<T>(fn: (c: Counterpart) => T): T {
  const c = Counterpart.open({ dir });
  try {
    return fn(c);
  } finally {
    c.close();
  }
}

function dash(): DashboardSource {
  const c = Counterpart.open({ dir, observer: true });
  open.push(c);
  return sourceOf(c);
}

function closeDash(): void {
  for (const c of open.splice(0)) c.close();
}

/** Every view a held memory could leak through, as one string. */
function allViews(src: DashboardSource, id: string): string {
  return JSON.stringify([
    overviewView(src),
    todayView(src),
    // The query echoes back as `q`; everything else the search says must not carry the words.
    { ...searchView(src, "quokka harbour lantern"), q: "" },
    { ...searchView(src, "quoka lanten"), q: "" },
    memoriesView(src),
    memoryListView(src, {}),
    memoryListView(src, { state: "all" }),
    tagView(src, TAG),
    healthView(src),
    activityView(src),
    memoryDetail(src, id),
  ]);
}

test("a memory on a chat's hold is hidden from every dashboard view and named in its own words; released, it is back", () => {
  const id = seed();

  // POSITIVE CONTROL: the same memory, not held, IS found — so the hiding below is not vacuous.
  let src = dash();
  const before = overviewView(src).hero.memories;
  expect(searchView(src, "quokka harbour lantern").hits.map((h) => h.id)).toContain(id);
  const typoBefore = searchView(src, "quoka lanten");
  expect([...typoBefore.hits, ...typoBefore.close].map((h) => h.id)).toContain(id);
  expect(todayView(src).lines.map((l) => l.text)).toContain(TITLE);
  expect(memoryListView(src, {}).rows.map((r) => r.id)).toContain(id);
  expect(tagView(src, TAG).memories.map((m) => m.id)).toContain(id);
  expect(resolveRef(src.store, id).state).toBe("live");
  expect(allViews(src, id)).toContain(TITLE);
  closeDash();

  // HOLD it, as the chat's delete does.
  const held = withWritable((c) => holdForRemoval(c.store, id));
  expect(held.ok).toBe(true);

  src = dash();
  // Counts: the hero and the list's live chip drop it; the other memory stays.
  const ov = overviewView(src);
  expect(ov.hero.memories).toBe(before - 1);
  const list = memoryListView(src, {});
  expect(list.rows.map((r) => r.id)).not.toContain(id);
  expect(list.counts.live).toBe(before - 1);
  expect(memoryListView(src, { state: "all" }).rows.map((r) => r.id)).not.toContain(id);
  // Today: the other memory is still written today; the held one is not.
  const today = todayView(src);
  expect(today.lines.map((l) => l.text)).toContain(OTHER_TITLE);
  expect(today.lines.map((l) => l.text)).not.toContain(TITLE);
  // Search: no hit, no close match, not in the total.
  const s = searchView(src, "quokka harbour lantern");
  expect(s.hits.map((h) => h.id)).not.toContain(id);
  expect(s.close.map((h) => h.id)).not.toContain(id);
  const typo = searchView(src, "quoka lanten");
  expect([...typo.hits, ...typo.close].map((h) => h.id)).not.toContain(id);
  // The tag page lists the other memory only.
  const tag = tagView(src, TAG);
  expect(tag.memories.map((m) => m.id)).not.toContain(id);
  expect(tag.total).toBe(1);
  // The resolver names it as held, with when it may be erased — not "removed by you".
  const ref = resolveRef(src.store, id);
  expect(ref.state).toBe("held");
  expect(ref.present).toBe(false);
  expect(ref.text).toBe(null);
  expect(ref.label.startsWith("[deleted in chat — erased after ")).toBe(true);
  expect(ref.label).not.toContain(ABSENCE.removed);
  // The card says the same.
  expect(memoryDetail(src, id).absence?.startsWith("[deleted in chat — erased after ")).toBe(true);
  // Health: the removal record lists the hold in its own words, and does not group it under "removed by you".
  const health = healthView(src);
  const rec = health.removals.find((r) => r.id === id);
  expect(rec?.stage).toBe("held");
  expect(rec?.label.startsWith("[deleted in chat — erased after ")).toBe(true);
  const removedGroup = health.archive.reasons.find((r) => r.phrase === "removed by you");
  expect((removedGroup?.items ?? []).map((i) => i.id)).not.toContain(id);
  // Nothing anywhere carries its words, or the wrong name for what happened.
  const everything = allViews(src, id);
  for (const w of SECRET_WORDS) expect(everything).not.toContain(w);
  expect(everything).not.toContain(ABSENCE.removed);
  closeDash();

  // RELEASE it: back, whole, everywhere.
  const released = withWritable((c) => releaseHold(c.store, id));
  expect(released.ok).toBe(true);
  src = dash();
  expect(overviewView(src).hero.memories).toBe(before);
  expect(searchView(src, "quokka harbour lantern").hits.map((h) => h.id)).toContain(id);
  expect(todayView(src).lines.map((l) => l.text)).toContain(TITLE);
  expect(memoryListView(src, {}).rows.map((r) => r.id)).toContain(id);
  expect(resolveRef(src.store, id).state).toBe("live");
  const afterHealth = healthView(src).archive.reasons.find((r) => r.phrase === "removed by you");
  expect((afterHealth?.items ?? []).map((i) => i.id)).not.toContain(id);
  closeDash();

  // HELD AGAIN AND CLAIMED by the sweep (fix round R1, `erasing`): still hidden, and "being erased".
  withWritable((c) => {
    expect(holdForRemoval(c.store, id).ok).toBe(true);
    const at = c.store.holdState(id)!.at;
    expect(claimHold(c.store, id, at + REMOVAL_HOLD_MS)).toBe(true);
  });
  src = dash();
  expect(overviewView(src).hero.memories).toBe(before - 1);
  expect(resolveRef(src.store, id).state).toBe("held");
  expect(resolveRef(src.store, id).label.startsWith(ABSENCE.held)).toBe(true);
  for (const w of SECRET_WORDS) expect(allViews(src, id)).not.toContain(w);
});
