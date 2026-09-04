/**
 * THE DESTRUCTION PATH. It lives here, in the owner's console, and nowhere else.
 *
 * `src/core/store/owner-op-seam.ts` declares `OwnerRemovalPort` as TYPES ONLY —
 * the store exports no delete, no unlink, no rm, and that absence is the
 * enforcement (§5 G2, §16 G1). This file is the one implementation. A test in
 * `test/cli.test.ts` walks the import graph and fails if any core module, any
 * other adapter, or anything a model can reach imports it. **That test failing
 * is the point**: it is the caller-universality check the contract asks for
 * (§16 G2, earned-mechanism #14).
 *
 * The order below is not style. Every step is a crash point, and at every one of
 * them the memory is either fully alive, or dark AND RECORDED (§16 G10–G11):
 *
 *   1. **Validate the target.** Memory-bearing roots only (§16 G16). The
 *      archive, the backups, the graph and the removal record itself are never
 *      nameable, so a typo cannot point removal at the record of removal.
 *   2. **Read everything that must be read, BEFORE anything is chased** (§16
 *      G13). v1 named this bug by making it: chasing copies first left every
 *      span unidentifiable, so the contamination scan had nothing to match on.
 *      The scan returns **ids only** — printing the matches would re-leak
 *      exactly what is being erased (§16 G15).
 *   3. **`requested`.** If the record cannot be written, NOTHING MOVES. A
 *      removal that happened without a record is the one outcome worse than a
 *      removal that did not happen.
 *   4. **`dark`.** From this moment `Store.deniedIds()` contains the id, and
 *      every consumer that consults it — recall, sleep, associate, prospective,
 *      the cache rebuild — skips it. A restored backup or a stray copy cannot
 *      quietly resurrect it; the stray is skipped and LOGGED, never deleted
 *      (§16 G12).
 *   5. **Chase**, then `chased`, then `complete`. Whatever could not be chased
 *      is REPORTED, never silently dropped (§16 G15: no silent partial success).
 *      Box 1 (the prose file and every archived version file) is chased here;
 *      box 2 (the row, its edges, its prospective windows, the gate rows that
 *      name it, and every content pointer it had) by `chaseRemoved` on the
 *      store's owner-op seam, which appends the `chased` stage inside its own
 *      transaction; box 3 by a rebuild that skips and logs the denied id.
 *
 * The record carries no body and no content hash (§16 G9, scar §2.20): a hash of
 * low-entropy content is brute-forceable, which would make the record of a
 * removal a leak of the thing removed.
 */
import { existsSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { join, relative } from "node:path";

// The span buffer's OWN scope-directory function, imported rather than
// re-derived: `spans/<keyFor(scope)>/` is `remember/`'s layout, and a second
// copy of that arithmetic living in the destruction path is how a report starts
// naming a file that does not exist.
import { keyFor } from "../../core/remember/index.js";
import { paths } from "../../core/store/index.js";
import type {
  OwnerRemovalOutcome,
  OwnerRemovalRequest,
  RemovalNote,
  Store,
} from "../../core/store/index.js";
// The one VALUE imported from the seam, and the reason the caller-universality
// test pins this file AND that one: `chaseRemoved` is the box-2 half of the
// destruction path. It is reachable by importing the seam on purpose, never by
// holding a `Store` (INTERFACE-GAPS §1, closed 2026-08-25).
import { chaseRemoved } from "../../core/store/owner-op-seam.js";

export interface RemovalPlan {
  readonly targetId: string;
  readonly valid: boolean;
  readonly reason: "ok" | "unknown-id" | "not-memory-bearing" | "already-removed";
  /** IDS ONLY. Other memories whose text overlaps the doomed content (§16 G15). */
  readonly contamination: readonly string[];
  /** What the chase will visit, by surface name. Counts, never contents. */
  readonly surfaces: { readonly surface: string; readonly count: number }[];
  /**
   * The SEVENTH surface, and the only one this console reports rather than
   * chases: `remember/`'s raw capture buffer. Always present, in all three
   * states — a surface that is silent when it is empty is exactly the silent
   * partial success §16 G15 forbids.
   */
  readonly spans: SpanSurface;
  /** Surfaces this implementation cannot reach — named, never implied. */
  readonly unchasable: readonly string[];
}

/**
 * `held` — a line under `spans/` carries this memory's words, right now, checked.
 * `unknown` — this console cannot rule it out, and says which way it is blind.
 * `not-applicable` — checked, and there is nothing of this memory there.
 */
export type SpanState = "held" | "unknown" | "not-applicable";

export interface SpanSurface {
  readonly surface: "spans";
  readonly state: SpanState;
  /** Store-RELATIVE, and only when one can be named. Never an absolute path. */
  readonly path: string | null;
  /** The whole sentence the console prints, and the `unchasable` entry when it is one. */
  readonly line: string;
}

export interface RemovalOptions {
  /** Wall-clock, not lived days: a week away must still be a week of second
   *  thoughts (§16's note on the released ceremony). */
  now?: () => number;
  onEvent?: (name: string, data: Record<string, string | number | boolean | null>) => void;
}

/** Prose families a removal may target. Everything else is chased, never named. */
const MEMORY_BEARING = new Set(["memory", "episode", "schema"]);

/** The debt, in the same words wherever the surface is reported. */
const SPANS_DEBT =
  "a later backup copies them; export does not. Chasing it is a core change, not yet written.";

/** Every `*.jsonl` under a directory — the live streams and the claims beside them. */
function jsonlUnder(root: string): string[] {
  if (!existsSync(root)) return [];
  const out: string[] = [];
  const walk = (at: string): void => {
    for (const name of readdirSync(at).sort()) {
      const full = join(at, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (name.endsWith(".jsonl")) out.push(full);
    }
  };
  walk(root);
  return out;
}

/** True when this file carries the doomed text. Reads it; never returns it. */
function fileHolds(path: string, needle: string): boolean {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return false;
  }
  if (text.includes(needle)) return true;
  // A span record is JSON, so quotes and newlines in the body arrive escaped and
  // the raw substring above misses them. The parse is the real comparison; the
  // raw check above is what catches a file this console does not understand.
  for (const line of text.split("\n")) {
    if (line.trim().length === 0) continue;
    try {
      const record = JSON.parse(line) as { text?: unknown };
      if (typeof record.text === "string" && record.text.includes(needle)) return true;
    } catch {
      /* an unparseable line was already covered by the raw check */
    }
  }
  return false;
}

/**
 * THE SEVENTH SURFACE (LAUNCH-STATUS §I2, owner ruling: option A).
 *
 * A note taken through the MCP `note` tool or `counterparts note` is CAPTURED
 * first — `captureJot` appends the verbatim text to `spans/<scope>/jots.jsonl` —
 * and minted second. The chase never reached that file, and `unchasable` was a
 * hardcoded `[]`, so `remove` reported `unchased: nothing` while the words were
 * still on disk, and a backup taken afterwards copied them. That is a silent
 * partial success against §16 G15, and this is the honest half of the fix: the
 * surface is NAMED. Chasing it needs a door in `remember/` (a strike-by-hash on
 * the buffer), which is core work and is filed in INTERFACE-GAPS.
 *
 * **Evidence first, provenance second.** The state is decided by looking: the
 * memory's own words are searched for in the buffer files, and a hit is a fact
 * rather than an inference. Provenance only breaks the tie when the search comes
 * back empty — because `source = 'authored'` means this memory came through the
 * jot door, and "I did not find it" is not "it was never there". The two
 * blind spots (prose already gone; provenance never recorded) are reported as
 * `unknown` rather than resolved in the comfortable direction.
 */
export function spanResidue(store: Store, targetId: string, body: string): SpanSurface {
  const row = store.row(targetId);
  const source = typeof row?.source === "string" && row.source.length > 0 ? row.source : null;
  const scope = typeof row?.origin_scope === "string" && row.origin_scope.length > 0 ? row.origin_scope : null;
  const spansRoot = join(store.dir, "spans");
  const scopeDir = scope === null ? spansRoot : join(spansRoot, keyFor(scope));
  const files = jsonlUnder(scopeDir);
  const rel = (path: string): string => relative(store.dir, path);
  const named = scope === null ? "spans/" : `${rel(scopeDir)}/`;

  if (files.length === 0) {
    return {
      surface: "spans",
      state: "not-applicable",
      path: null,
      line: `spans: not applicable — there is no capture buffer at ${named} for this memory, so nothing of it rode one.`,
    };
  }

  const needle = body.trim();
  if (needle.length > 0) {
    const hit = files.find((file) => fileHolds(file, needle));
    if (hit !== undefined) {
      return {
        surface: "spans",
        state: "held",
        path: rel(hit),
        line: `${rel(hit)} — the raw capture buffer still holds this memory's words; ${SPANS_DEBT}`,
      };
    }
  } else {
    return {
      surface: "spans",
      state: "unknown",
      path: named,
      line: `${named} — the prose is already gone, so this console cannot tell whether the words rode the buffer; ${SPANS_DEBT}`,
    };
  }

  // Searched, not found. Whether that settles it depends on how the memory was minted.
  if (source === "authored") {
    return {
      surface: "spans",
      state: "unknown",
      path: named,
      line: `${named} — this memory came through the jot door, so its words rode the buffer; no line there matches them now, and this console cannot prove the capture is gone; ${SPANS_DEBT}`,
    };
  }
  if (source === null) {
    return {
      surface: "spans",
      state: "unknown",
      path: named,
      line: `${named} — unknown whether the words rode the buffer: this memory's provenance was never recorded, and a buffer exists; ${SPANS_DEBT}`,
    };
  }
  return {
    surface: "spans",
    state: "not-applicable",
    path: null,
    line: `spans: not applicable — a '${source}' memory is not captured as a jot, and no line under ${named} holds its words.`,
  };
}

/**
 * STEP 1 + 2: validate, then read everything the removal will need. Pure — it
 * writes nothing and takes no lock, so it is safe to run before a confirmation
 * prompt and safe to run again after one (scar §2.13's re-plan-under-the-lock
 * rule; E5's never-hold-a-lock-across-a-human-prompt rule).
 */
export function planRemoval(store: Store, targetId: string): RemovalPlan {
  const none = (reason: RemovalPlan["reason"]): RemovalPlan => ({
    targetId,
    valid: false,
    reason,
    contamination: [],
    surfaces: [],
    // An invalid target is not a memory to have residue: nothing was read and
    // nothing is claimed about the buffer.
    spans: {
      surface: "spans",
      state: "not-applicable",
      path: null,
      line: "spans: not applicable — there is nothing here to have ridden the buffer.",
    },
    unchasable: [],
  });

  const row = store.row(targetId);
  if (row === undefined) return none("unknown-id");
  if (!MEMORY_BEARING.has(row.type)) return none("not-memory-bearing");
  if (store.deniedIds().includes(targetId)) return none("already-removed");

  // EVERYTHING THAT READS THE DOOMED CONTENT HAPPENS HERE (§16 G13).
  let body = "";
  try {
    body = store.readProse(targetId).body;
  } catch {
    // The prose is already gone. The removal still proceeds — the row, the
    // graph and the deny-list entry are the rest of the surface.
  }
  const contamination: string[] = [];
  if (body.trim().length > 0) {
    for (const hit of store.search(body, 20)) {
      if (hit.id !== targetId) contamination.push(hit.id);
    }
  }

  const versions = store.versions(targetId);
  const edges = store.edgesFrom(targetId);
  const prospective = store.prospectiveFor(targetId);
  // Read WITH the rest (§16 G13): the buffer is searched for the doomed words
  // before anything is chased, because after the chase there is nothing left to
  // search for. Ids and states come out; not one line of what it read.
  const spans = spanResidue(store, targetId, body);

  return {
    targetId,
    valid: true,
    reason: "ok",
    contamination,
    surfaces: [
      { surface: "prose", count: 1 },
      { surface: "versions", count: versions.length },
      { surface: "edges", count: edges.length },
      { surface: "prospective", count: prospective.length },
      { surface: "operational rows", count: 1 },
      { surface: "cache", count: 1 },
    ],
    spans,
    // Empty of CHASE failures until run time (the box-2 chase landed 2026-08-25,
    // INTERFACE-GAPS §1) — but no longer empty by default: the span buffer is a
    // surface this console genuinely cannot reach, and §16 G15's "no silent
    // partial success" is exactly the rule that says a plan must name it here
    // rather than let the report say `nothing`.
    unchasable: spans.state === "not-applicable" ? [] : [spans.line],
  };
}

/**
 * STEPS 3–5. The one implementation of `OwnerRemovalPort`.
 *
 * It throws only when the RECORD cannot be written, because that is the single
 * failure where doing nothing is correct. Every later failure is caught, counted
 * and reported in `unchased` — a chase that half-worked must say so.
 */
export function ownerRemoval(
  store: Store,
  request: OwnerRemovalRequest,
  opts: RemovalOptions = {},
): OwnerRemovalOutcome {
  const emit = opts.onEvent ?? ((): void => {});
  const notes: RemovalNote[] = [];
  const append = (stage: RemovalNote["stage"]): void => {
    const note: RemovalNote = {
      memoryId: request.targetId,
      stage,
      actor: request.actor,
      reason: request.reason,
    };
    store.appendRemovalRecord(note);
    notes.push(note);
    emit("cli.removal.stage", { stage, target: request.targetId });
  };

  const plan = planRemoval(store, request.targetId);
  if (!plan.valid) {
    // Nothing is recorded for a target that was never removable: a record here
    // would put an id on the deny-list on the strength of a typo.
    throw new Error(`removal refused: ${plan.reason}`);
  }

  // 3. REQUESTED — if this throws, nothing has moved and nothing will (§16 G10).
  append("requested");

  const row = store.row(request.targetId);
  const prosePath = row?.prose_path ?? null;
  const versions = store.versions(request.targetId);

  // 4. DARK — the deny-list is live from this line onward (§16 G12).
  append("dark");

  const chased: string[] = [];
  const unchased: string[] = [...plan.unchasable];

  // 5. CHASE. Box 1 first: the prose and every archived version of it.
  if (prosePath !== null && existsSync(prosePath)) {
    try {
      rmSync(prosePath, { force: true });
      chased.push("prose");
    } catch {
      unchased.push("prose");
    }
  } else {
    chased.push("prose");
  }
  let versionsGone = 0;
  for (const version of versions) {
    try {
      if (existsSync(version.path)) rmSync(version.path, { force: true });
      versionsGone += 1;
    } catch {
      /* counted below */
    }
  }
  if (versionsGone === versions.length) chased.push("versions");
  else unchased.push("versions");
  try {
    rmSync(paths.versionsFor(store.dir, request.targetId), { recursive: true, force: true });
  } catch {
    /* an empty directory left behind is not a leak */
  }

  // Box 2, and the `chased` stage with it: the seam appends the record INSIDE
  // its own transaction, so the rows and the record land together or not at all.
  // What survives is named in the report, never implied (§16 G15).
  try {
    const report = chaseRemoved(store, request.targetId);
    for (const surface of report.removed) chased.push(`${surface.surface}(${surface.count})`);
    for (const surface of report.neutralized) {
      chased.push(`${surface.surface}(${surface.count}, tombstoned)`);
    }
    notes.push({ memoryId: request.targetId, stage: "chased", actor: request.actor });
    emit("cli.removal.stage", { stage: "chased", target: request.targetId });
  } catch {
    unchased.push("operational rows");
    append("chased");
  }

  // Box 3: the rebuild skips every denied id and LOGS the skip, so the cache
  // comes back without the memory and with a record that it was left out.
  try {
    store.rebuildCache();
    chased.push("cache");
  } catch {
    unchased.push("cache");
  }

  append("complete");
  emit("cli.removal.complete", {
    target: request.targetId,
    chased: chased.length,
    unchased: unchased.length,
    contamination: plan.contamination.length,
  });

  return { chased, unchased, notes };
}

/**
 * The read-back a removal is only trustworthy with: is the id dark, is its prose
 * gone, and does any canonical file still hold its text? Ids only in, verdict
 * out — no body ever crosses this boundary.
 */
export function verifyRemoval(store: Store, targetId: string): {
  denied: boolean;
  proseGone: boolean;
  /** True while a row exists at all — after the chase it is a stripped skeleton. */
  rowSurvives: boolean;
  /** True when that row has been stripped of every content pointer. */
  rowTombstoned: boolean;
  /** Box-2 state that should be gone: edges, prospective windows, gate rows. */
  darkState: number;
} {
  const row = store.row(targetId);
  const prosePath = row === undefined || row.prose_path === "" ? null : row.prose_path;
  const tombstone = store.tombstones().find((e) => e.id === targetId);
  return {
    denied: store.deniedIds().includes(targetId),
    proseGone: prosePath === null || !existsSync(prosePath),
    rowSurvives: row !== undefined,
    rowTombstoned: tombstone !== undefined && row?.content_hash === "" && row?.prose_path === "",
    darkState:
      store.edgesFrom(targetId).length + store.prospectiveFor(targetId).length,
  };
}
