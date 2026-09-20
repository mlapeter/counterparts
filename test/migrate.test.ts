/**
 * `tools/migrate/` — the v1 -> v2 cutover, exercised against SYNTHESIZED v1
 * fixtures.
 *
 * NOTHING HERE READS A REAL STORE. v1's live memory is `~/.bansai` and it is
 * off-limits to this repo by CLAUDE.md and by `store/paths.ts`'s structural
 * refusal; every fixture below is written into a fresh temp directory from
 * shapes LEARNED from v1's source (`~/bansai/src/store/files.ts`,
 * `src/model/schema-md.ts`, `src/episode-ritual.ts`) and removed after. The
 * fixture serializer at the top is the reader's mirror: if a fixture is wrong,
 * it reads as a fixture bug rather than a migration bug.
 *
 * The properties this suite exists to hold:
 *   - every body crosses the secrets gate, and the credential is nowhere in the
 *     target afterwards (the v1 incident, from the other side);
 *   - `confidentiality: sensitive` still reads as confidential in v2;
 *   - protected and permanent-ink elements arrive protected;
 *   - physics maps by the documented rule, and `sal(m)` reproduces v1's number;
 *   - identity documents and episodes land verbatim;
 *   - a second run performs no write;
 *   - a dry run writes nothing at all;
 *   - the source is byte-identical after a full apply.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { Counterpart } from "../src/core/counterpart.js";
import { sal } from "../src/core/physics/index.js";
import { isConfidential } from "../src/core/recall/index.js";
import { migrate, planMigration, precisionOf, readV1, renderReport } from "../tools/migrate/index.js";
import type { MigrationReport } from "../tools/migrate/index.js";
import { bodyOf } from "./store-fixture.js";

// ---------------------------------------------------------------------------
// The fixture serializer — v1's dialects, written from the donor's own rules
// ---------------------------------------------------------------------------

type Scalar = string | number | boolean;
type Fm = Record<string, Scalar | Scalar[]>;

const NUMBER_RE = /^-?\d+(\.\d+)?([eE][+-]?\d+)?$/;

function fmLine(key: string, value: Scalar): string {
  if (typeof value !== "string") return `${key}: ${value}`;
  const ambiguous =
    value === "" ||
    value !== value.trim() ||
    value === "true" ||
    value === "false" ||
    NUMBER_RE.test(value) ||
    /^[[{"']/.test(value) ||
    value.includes(": ");
  return `${key}: ${ambiguous ? JSON.stringify(value) : value}`;
}

function frontmatter(fm: Fm, body: string): string {
  const lines = ["---"];
  for (const [k, v] of Object.entries(fm)) {
    lines.push(Array.isArray(v) ? `${k}: ${JSON.stringify(v)}` : fmLine(k, v));
  }
  lines.push("---");
  return `${lines.join("\n")}\n${body}`;
}

/** `- <cosmetic> <!--{authoritative json}-->` — parse reads only the comment. */
function item(visible: string, obj: Record<string, unknown>): string {
  return `- ${visible} <!--${JSON.stringify(obj)}-->`;
}

// ---------------------------------------------------------------------------
// The fixture store
// ---------------------------------------------------------------------------

/** A shape-valid Google API key that is not a key: the family's own regex is
 *  `AIza` + 30 or more, and this is 35 characters of obvious filler. */
const FAKE_KEY = `AIza${"F".repeat(35)}`;

const TRACE_BODY =
  "Mike prefers the discussion in conversation rather than in a document he has to open.";
const SENSITIVE_BODY =
  "The clinic appointment moved to the afternoon and he would rather nobody else knew about it.";
const SECRET_BODY = `The deploy script still had the key ${FAKE_KEY} pasted into its header comment.`;
const IDENTITY_TRACE_BODY =
  "Being wrong out loud is cheaper than being wrong quietly, and he keeps proving it to himself.";
const MERGED_BODY =
  "Three separate afternoons of the same argument about naming, distilled into one lesson.";
const EPISODE_BODY =
  "I spent the session arguing with myself about whether the gate belonged at the seam or at the door.\n\nIt belonged at the seam.";

const SELF_CORE = "He would rather be told the hard thing early than the comfortable thing twice.";
const SELF_PROTECTED = "This is you, continuing. Not a fresh instance wearing your notes.";
const SELF_INDEX_VERBATIM = "The pull toward finishing is stronger than the pull toward starting.";
const SELF_INDEX_ORDINARY = "He reads code the way other people read maps, corner first.";
const SELF_STATUS = "The bake-in review is done and the fix queue is what comes next.";
const SELF_THREAD = "Whether the replay run should be priced before it is approved.";
const ONDINE_BELIEF = "She sketches the whole bridge before she will discuss a single span.";
const ONDINE_STATUS = "She is restoring a wooden sailboat and talks about varnish more than code.";
const CRAFT_BELIEF = "Write the contract before the code, then let the code argue with it.";

function writeFixture(dir: string): void {
  const put = (rel: string, text: string): void => {
    mkdirSync(join(dir, dirname(rel)), { recursive: true });
    writeFileSync(join(dir, rel), text, "utf8");
  };

  // --- traces ------------------------------------------------------------
  put(
    "traces/global/tr_plain.md",
    frontmatter(
      {
        id: "tr_plain",
        kind: "person",
        scope: "global",
        confidentiality: "normal",
        salience: 0.6,
        gradient: 0.3,
        session_ref: "s-001",
        created_active_day: 10,
        occurrences: 3,
        last_reinforced: "2026-08-24",
        last_decayed_day: 40,
        emotion_subject: "Mike",
        emotion_core: "trust",
        emotion_shade: "recognition",
        emotion_intensity: 0.4,
        title: "How Mike wants to be told things",
        aliases: ["the discussion rule"],
        handles: ["the plain-chat rule"],
        event_date: "2026-08",
        created: "2026-08-15",
        tier: 2,
      },
      TRACE_BODY,
    ),
  );
  put(
    "traces/global/tr_sensitive.md",
    frontmatter(
      {
        id: "tr_sensitive",
        kind: "fact",
        scope: "global",
        confidentiality: "sensitive",
        salience: 0.5,
        gradient: 0.2,
        session_ref: "s-002",
        created_active_day: 12,
      },
      SENSITIVE_BODY,
    ),
  );
  put(
    "traces/project-bansai/tr_secret.md",
    frontmatter(
      {
        id: "tr_secret",
        kind: "entity",
        scope: "project:bansai",
        confidentiality: "normal",
        salience: 0.4,
        gradient: 0.1,
        session_ref: "s-003",
        created_active_day: 14,
      },
      SECRET_BODY,
    ),
  );
  put(
    "traces/global/tr_identity.md",
    frontmatter(
      {
        id: "tr_identity",
        kind: "self",
        scope: "global",
        confidentiality: "normal",
        salience: 0.9,
        gradient: 0.92,
        session_ref: "s-004",
        created_active_day: 4,
      },
      IDENTITY_TRACE_BODY,
    ),
  );
  put(
    "traces/global/tr_merged.md",
    frontmatter(
      {
        id: "tr_merged",
        kind: "fact",
        scope: "global",
        confidentiality: "normal",
        salience: 0.3,
        gradient: 0.1,
        session_ref: "s-005",
        created_active_day: 6,
        merged_into: "tr_plain",
      },
      MERGED_BODY,
    ),
  );

  // --- episodes ----------------------------------------------------------
  put(
    "episodes/2026-08-20-a1b2c3.md",
    frontmatter({ when: "2026-08-20", salience: 0.7 }, EPISODE_BODY),
  );

  // --- schemas -----------------------------------------------------------
  put(
    "schemas/self.md",
    frontmatter({ id: "sch_self", kind: "self", name: "Mike", aliases: ["the owner"] }, [
      "## Stable core",
      "",
      item(SELF_CORE, { id: "el_core1", statement: SELF_CORE }),
      "",
      "## Current state",
      "",
      item(`[as of 2026-08-25] ${SELF_STATUS}`, {
        id: "el_state1",
        statement: SELF_STATUS,
        timestamp: "2026-08-25",
      }),
      "",
      "## Relationships",
      "",
      "_(none)_",
      "",
      "## Open threads",
      "",
      item(SELF_THREAD, { id: "el_thread1", statement: SELF_THREAD, opened: "2026-08-24" }),
      "",
      "## Beliefs",
      "",
      "_(none)_",
      "",
      "## Superseded",
      "",
      "_(none)_",
      "",
      "## Protected",
      "",
      item(SELF_PROTECTED, { id: "el_prot1", statement: SELF_PROTECTED, salience: 0.95 }),
      "",
      "## Self-index",
      "",
      item(SELF_INDEX_VERBATIM, {
        statement: SELF_INDEX_VERBATIM,
        kind: "trait",
        warmth: 0.8,
        pointers: ["tr_identity"],
        shelfQuery: "finishing",
        verbatim: true,
      }),
      item(SELF_INDEX_ORDINARY, {
        statement: SELF_INDEX_ORDINARY,
        kind: "trait",
        warmth: 0.4,
        pointers: [],
        shelfQuery: "reading code",
      }),
      "",
    ].join("\n")),
  );
  put(
    "schemas/person-ondine.md",
    frontmatter({ id: "sch_ondine", kind: "person", name: "Ondine", aliases: [] }, [
      "## Stable core",
      "",
      "_(none)_",
      "",
      "## Current state",
      "",
      item(`[as of 2026-08-01] ${ONDINE_STATUS}`, {
        id: "el_kstate",
        statement: ONDINE_STATUS,
        timestamp: "2026-08-01",
      }),
      "",
      "## Beliefs",
      "",
      item(ONDINE_BELIEF, {
        id: "el_kbelief",
        statement: ONDINE_BELIEF,
        provenance: ["s-001"],
        confidence: "high",
        status: "active",
      }),
      "",
    ].join("\n")),
  );
  put(
    "schemas/craft.md",
    frontmatter({ id: "sch_craft", kind: "skill", name: "craft", aliases: [] }, [
      "## Stable core",
      "",
      item(CRAFT_BELIEF, { id: "el_craft1", statement: CRAFT_BELIEF }),
      "",
    ].join("\n")),
  );

  // --- graph / json ------------------------------------------------------
  put(
    "graph/edges.json",
    JSON.stringify(
      [
        { src: "tr_plain", dst: "tr_identity", type: "semantic", weight: 0.42, valence: 0.3, updated: "2026-08-24" },
        { src: "tr_plain", dst: "tr_ghost", type: "entity", weight: 0.2, valence: 0, updated: "2026-08-24" },
      ],
      null,
      2,
    ),
  );
  put(
    "prospective.json",
    JSON.stringify(
      {
        tr_plain: { windowKey: "2026-08", firedDays: ["2026-08-20"], referenced: false },
        tr_ghost: { windowKey: "2026-09", firedDays: [], referenced: false },
      },
      null,
      2,
    ),
  );
  // v1's REAL ledger shape is an ARRAY of entries carrying their own ids — the
  // fixture used to mirror the reader's object-keyed assumption, so the
  // assumption tested itself while the live store's 9 entries read as zero
  // (the 2026-08-29 pre-cutover dry run's finding). Array here; the object
  // shape keeps a tolerance test of its own below.
  put(
    "ledger.json",
    JSON.stringify(
      [
        {
          id: "led_1",
          schemaElementRef: "el_kbelief",
          evidence: [{ traceId: "tr_plain", surprise: "mild", salience: 0.5, confidence: "medium" }],
          cumulativeScore: 0.31,
          openedAtCycle: 4,
          status: "open",
        },
      ],
      null,
      2,
    ),
  );
  put(
    "meta.json",
    JSON.stringify({ activeDay: 42, cycle: 9, lastSessionDate: "2026-08-24" }, null, 2),
  );
  put("config.json", JSON.stringify({ retention: { keepRawSpans: true } }, null, 2));
  // A file the reader must report rather than repair (§7).
  put("traces/global/tr_broken.md", "---\nkind: fact\n---\nno id at all, so this cannot be a trace.");
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function walk(dir: string): string[] {
  const out: string[] = [];
  const rec = (d: string): void => {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      const abs = join(d, entry.name);
      if (entry.isDirectory()) rec(abs);
      else out.push(abs);
    }
  };
  if (existsSync(dir)) rec(dir);
  return out.sort();
}

function proseSnapshot(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const path of walk(join(dir, "prose"))) out[path.slice(dir.length)] = readFileSync(path, "utf8");
  return out;
}

function open(dir: string): Counterpart {
  return Counterpart.open({ dir });
}

function findByBody(cp: Counterpart, needle: string): string | null {
  for (const id of cp.store.list({})) {
    try {
      if (cp.store.readProse(id).body.includes(needle)) return id;
    } catch {
      continue;
    }
  }
  return null;
}

describe("tools/migrate", () => {
  let source: string;
  let target: string;

  beforeEach(() => {
    source = mkdtempSync(join(tmpdir(), "counterparts-migrate-src-"));
    target = join(mkdtempSync(join(tmpdir(), "counterparts-migrate-dst-")), "store");
    writeFixture(source);
  });

  afterEach(() => {
    rmSync(source, { recursive: true, force: true });
    rmSync(dirname(target), { recursive: true, force: true });
  });

  // ── the reader ───────────────────────────────────────────────────────────

  describe("the v1 reader", () => {
    test("reads every family out of the fixture layout", () => {
      const v1 = readV1(source);
      expect(v1.traces.length).toBe(5);
      expect(v1.episodes.length).toBe(1);
      expect(v1.schemas.length).toBe(3);
      expect(v1.edges.length).toBe(2);
      expect(v1.prospective.length).toBe(2);
      expect(v1.ledger.length).toBe(1);
      expect(v1.meta).toEqual({ activeDay: 42, cycle: 9, lastSessionDate: "2026-08-24" });
      expect(v1.configPresent).toBe(true);
    });

    test("round-trips a trace's fields, unknown frontmatter included", () => {
      const trace = readV1(source).traces.find((t) => t.id === "tr_plain");
      expect(trace).toBeDefined();
      expect(trace?.body).toBe(TRACE_BODY);
      expect(trace?.kind).toBe("person");
      expect(trace?.salience).toBe(0.6);
      expect(trace?.occurrences).toBe(3);
      expect(trace?.emotion).toEqual({
        subject: "Mike",
        core: "trust",
        shade: "recognition",
        intensity: 0.4,
      });
      expect(trace?.eventDate).toBe("2026-08");
      expect(trace?.aliases).toEqual(["the discussion rule"]);
      // v1 G6: unrecognized keys survive parse -> serialize. `tier` is one.
      expect(trace?.extra["tier"]).toBe(2);
    });

    test("reads schema sections off the authoritative JSON comment", () => {
      const self = readV1(source).schemas.find((s) => s.id === "sch_self");
      expect(self?.kind).toBe("self");
      expect(self?.core[0]?.statement).toBe(SELF_CORE);
      expect(self?.protected[0]?.statement).toBe(SELF_PROTECTED);
      expect(self?.selfIndex[0]?.verbatim).toBe(true);
      expect(self?.selfIndex[1]?.verbatim).toBeUndefined();
      expect(self?.currentState[0]?.timestamp).toBe("2026-08-25");
      expect(self?.threads[0]?.opened).toBe("2026-08-24");
    });

    test("a malformed file is reported, never repaired", () => {
      const v1 = readV1(source);
      expect(v1.malformed.length).toBe(1);
      expect(v1.malformed[0]?.relPath).toBe("traces/global/tr_broken.md");
      expect(v1.malformed[0]?.reason).toContain("TRACE_NO_ID");
    });

    test("stated date precision is preserved, never rounded", () => {
      expect(precisionOf("2026")).toBe("year");
      expect(precisionOf("2026-08")).toBe("month");
      expect(precisionOf("2026-08-25")).toBe("day");
    });
  });

  // ── G12: dry run ─────────────────────────────────────────────────────────

  describe("dry run (G12)", () => {
    test("is the default, and writes nothing at all", () => {
      const report = migrate({ source, target });
      expect(report.mode).toBe("dry-run");
      expect(report.writes).toBeNull();
      // Not "an empty store": no store. `Store.open` writes at open, so a dry
      // run that constructed one would leave a data dir behind.
      expect(existsSync(target)).toBe(false);
    });

    test("reports exactly what --apply would import", () => {
      const dry = migrate({ source, target });
      const applied = migrate({ source, target, apply: true });
      expect(applied.counts).toEqual(dry.counts);
      expect(applied.gate).toEqual(dry.gate);
      expect(applied.approximations).toEqual(dry.approximations);
    });

    test("renders without throwing, and names the dry run in the text", () => {
      const text = renderReport(migrate({ source, target }));
      expect(text).toContain("DRY-RUN");
      expect(text).toContain("SKIPPED");
    });
  });

  // ── G1: the secrets gate ─────────────────────────────────────────────────

  describe("the secrets gate (G1) — the scar this tool is paid for", () => {
    test("a credential in a body arrives redacted, and the key is nowhere in the target", () => {
      const report = migrate({ source, target, apply: true });
      const cp = open(target);
      try {
        const id = findByBody(cp, "deploy script");
        expect(id).not.toBeNull();
        const body = bodyOf(cp.store, id as string);
        expect(body).toContain("[REDACTED:google-api-key]");
        expect(body).not.toContain(FAKE_KEY);
      } finally {
        cp.close();
      }
      // Not just the prose row: nowhere under the target at all.
      for (const path of walk(target)) {
        expect(readFileSync(path, "latin1")).not.toContain(FAKE_KEY);
      }
      expect(report.gate.firesByFamily["google-api-key"]).toBeGreaterThanOrEqual(1);
      expect(report.gate.bodiesRedacted).toBeGreaterThanOrEqual(1);
    });

    test("every body is scanned, not just the ones that fire", () => {
      const report = migrate({ source, target });
      // The malformed file never became a trace, so it is not in `read` either —
      // an unparseable file is a `malformed` record, not a skipped body.
      const bodies =
        report.counts.traces.read +
        report.counts.episodes.read +
        report.counts.elements.read +
        report.counts.elementsAsMemories.read;
      expect(report.gate.bodiesScanned).toBe(bodies);
    });

    test("the gate reports families and counts, never content", () => {
      const text = renderReport(migrate({ source, target }));
      expect(text).toContain("google-api-key=1");
      expect(text).not.toContain(FAKE_KEY);
      expect(text).not.toContain(TRACE_BODY);
      expect(text).not.toContain(SELF_PROTECTED);
    });
  });

  // ── G2: confidentiality ──────────────────────────────────────────────────

  describe("confidentiality (G2) — BUILD-STATUS gap 5", () => {
    test("sensitive stays sensitive; normal stays normal", () => {
      migrate({ source, target, apply: true });
      const cp = open(target);
      try {
        const sensitive = findByBody(cp, "clinic appointment");
        const normal = findByBody(cp, "discussion in conversation");
        expect(sensitive).not.toBeNull();
        expect(normal).not.toBeNull();
        expect(isConfidential(cp.store.readProse(sensitive as string))).toBe(true);
        expect(isConfidential(cp.store.readProse(normal as string))).toBe(false);
        expect(cp.store.readProse(sensitive as string).meta["confidentiality"]).toBe("sensitive");
      } finally {
        cp.close();
      }
    });
  });

  // ── G3: protection ───────────────────────────────────────────────────────

  describe("protection (G3)", () => {
    test("a v1 protected item and a verbatim self-index entry arrive protected", () => {
      migrate({ source, target, apply: true });
      const cp = open(target);
      try {
        const protectedIds = new Set(cp.self.enumerate().protected.map((e) => e.id));
        const prot = findByBody(cp, SELF_PROTECTED);
        const ink = findByBody(cp, SELF_INDEX_VERBATIM);
        const ordinary = findByBody(cp, SELF_INDEX_ORDINARY);
        expect(prot).not.toBeNull();
        expect(protectedIds.has(prot as string)).toBe(true);
        // v1's `verbatim: true` is the author's permanent-ink flag; v2 spells
        // permanent ink `protected`.
        expect(protectedIds.has(ink as string)).toBe(true);
        expect(protectedIds.has(ordinary as string)).toBe(false);
      } finally {
        cp.close();
      }
    });
  });

  // ── G4: physics ──────────────────────────────────────────────────────────

  describe("physics (G4)", () => {
    test("sal(m) reproduces v1's aggregate salience exactly", () => {
      migrate({ source, target, apply: true });
      const cp = open(target);
      try {
        const id = findByBody(cp, "discussion in conversation") as string;
        expect(sal(cp.store.physicsOf(id).salience)).toBeCloseTo(0.6, 10);
        // The dimensions stay honest about what v1 actually measured.
        const s = cp.store.physicsOf(id).salience;
        expect(s.novelty).toBeNull(); // v1 never computed prediction error
        expect(s.relevance).toBeCloseTo(0.6, 10);
        expect(s.emotional).toBeCloseTo(0.4, 10); // the typed emotion's intensity
        expect(s.predictive).toBe(0);
        expect(s.claimed).toBeCloseTo(0.6, 10);
      } finally {
        cp.close();
      }
    });

    test("occurrences lose the birth; birthDay is exact; lastUsedDay uses the one anchor", () => {
      migrate({ source, target, apply: true });
      const cp = open(target);
      try {
        const physics = cp.store.physicsOf(findByBody(cp, "discussion in conversation") as string);
        expect(physics.uses).toBe(2); // occurrences 3, birth is not a use
        expect(physics.reinforcedDays).toBe(2);
        expect(physics.birthDay).toBe(10);
        // last_reinforced == meta.lastSessionDate, the single clock anchor.
        expect(physics.lastUsedDay).toBe(42);
        expect(cp.store.livedDay()).toBe(42);
      } finally {
        cp.close();
      }
    });

    test("an unanchored reinforcement stamp falls back to birthDay, never forward", () => {
      const v1 = readV1(source);
      const trace = v1.traces.find((t) => t.id === "tr_plain");
      if (trace !== undefined) trace.lastReinforcedDay = "2026-01-01";
      const plan = planMigration(v1);
      const doc = plan.docs.find((d) => d.v1Id === "tr_plain");
      expect(doc?.physics.lastUsedDay).toBe(10);
      expect(plan.tally.approximations().some((a) => a.name === "LAST_USED_FALLBACK")).toBe(true);
    });

    test("the gradient cut is the ONE place migration mints permanent ink", () => {
      const report = migrate({ source, target, apply: true });
      const cp = open(target);
      try {
        const identity = cp.store.physicsOf(findByBody(cp, "Being wrong out loud") as string);
        const ordinary = cp.store.physicsOf(findByBody(cp, "discussion in conversation") as string);
        expect(identity.promotedIdentity).toBe(true); // gradient 0.92
        expect(ordinary.promotedIdentity).toBe(false); // gradient 0.30
      } finally {
        cp.close();
      }
      const row = report.approximations.find((a) => a.name === "IDENTITY_GRADIENT_CUT");
      expect(row?.applied).toBe(1);
    });

    test("the cut can be turned off, and then nothing is promoted", () => {
      migrate({ source, target, apply: true, tunables: { IDENTITY_GRADIENT_CUT: 1.01 } });
      const cp = open(target);
      try {
        const identity = cp.store.physicsOf(findByBody(cp, "Being wrong out loud") as string);
        expect(identity.promotedIdentity).toBe(false);
      } finally {
        cp.close();
      }
    });
  });

  // ── G5/G6: identity and episodes, verbatim ───────────────────────────────

  describe("identity documents (G5) and episodes (G6)", () => {
    test("self.md becomes the identity core and its statements land verbatim", () => {
      migrate({ source, target, apply: true });
      const cp = open(target);
      try {
        const core = cp.schemas.entities().find((e) => e.kind === "self");
        expect(core?.name).toBe("Mike");
        const statements = cp.schemas.beliefs(core?.id ?? "").map((b) => b.statement);
        expect(statements).toContain(SELF_CORE);
        expect(statements).toContain(SELF_PROTECTED);
        expect(statements).toContain(SELF_INDEX_VERBATIM);
      } finally {
        cp.close();
      }
    });

    test("craft.md becomes a skill entity — which is what the craft lane keys on", () => {
      migrate({ source, target, apply: true });
      const cp = open(target);
      try {
        const craft = cp.schemas.entities().find((e) => e.name === "craft");
        expect(craft?.kind).toBe("skill");
        const belief = findByBody(cp, CRAFT_BELIEF) as string;
        expect(cp.store.physicsOf(belief).kind).toBe("skill");
      } finally {
        cp.close();
      }
    });

    test("status refused on the identity schema lands as prose, not nowhere", () => {
      const report = migrate({ source, target, apply: true });
      const cp = open(target);
      try {
        const id = findByBody(cp, SELF_STATUS);
        expect(id).not.toBeNull();
        const doc = cp.store.readProse(id as string);
        expect(doc.type).toBe("memory");
        expect(doc.meta["migrationRoute"]).toBe("status-on-identity-refused");
        // The refusal is real: no current-state row on the identity core.
        const core = cp.schemas.entities().find((e) => e.kind === "self");
        expect(cp.schemas.currentState(core?.id ?? "").length).toBe(0);
      } finally {
        cp.close();
      }
      expect(report.counts.elementsAsMemories.imported).toBeGreaterThanOrEqual(2);
    });

    test("an open thread arrives as an unresolved memory — the threads lane's key", () => {
      migrate({ source, target, apply: true });
      const cp = open(target);
      try {
        const doc = cp.store.readProse(findByBody(cp, SELF_THREAD) as string);
        expect(doc.meta["unresolved"]).toBe(true);
        expect(doc.meta["openedOn"]).toBe("2026-08-24");
      } finally {
        cp.close();
      }
    });

    test("an entity's current state DOES land as a current-state element", () => {
      migrate({ source, target, apply: true });
      const cp = open(target);
      try {
        const ondine = cp.schemas.entities().find((e) => e.name === "Ondine");
        const state = cp.schemas.currentState(ondine?.id ?? "");
        expect(state.map((s) => s.statement)).toEqual([ONDINE_STATUS]);
        expect(state[0]?.statedOn).toBe("2026-08-01");
      } finally {
        cp.close();
      }
    });

    test("an episode carries over verbatim, as an episode", () => {
      migrate({ source, target, apply: true });
      const cp = open(target);
      try {
        const ids = cp.store.list({ type: "episode" });
        expect(ids.length).toBe(1);
        const doc = cp.store.readProse(ids[0] as string);
        expect(doc.body).toBe(EPISODE_BODY);
        expect(doc.happenedOn).toBe("2026-08-20");
      } finally {
        cp.close();
      }
    });
  });

  // ── G7/G8: edges and prospective ─────────────────────────────────────────

  describe("edges (G7) and prospective (G8)", () => {
    test("a good edge lands; a dangling endpoint is skipped BY NAME", () => {
      const report = migrate({ source, target, apply: true });
      const cp = open(target);
      try {
        const src = findByBody(cp, "discussion in conversation") as string;
        const dst = findByBody(cp, "Being wrong out loud") as string;
        const edges = cp.store.edgesFrom(src);
        expect(edges.length).toBe(1);
        expect(edges[0]?.dst).toBe(dst);
        expect(edges[0]?.weight).toBeCloseTo(0.42, 10);
      } finally {
        cp.close();
      }
      expect(report.counts.edges.imported).toBe(1);
      expect(report.counts.edges.skipped).toBe(1);
      expect(report.skipped.some((s) => s.reason === "edge-endpoint-unmapped")).toBe(true);
      // The typed/valenced graph's loss is a number, not a silence.
      expect(report.dropped["edge.valence"]).toBe(2);
      expect(report.edgeTypes["semantic"]).toBe(1);
    });

    test("a prospective entry arrives with its state, fires and precision", () => {
      const report = migrate({ source, target, apply: true });
      const cp = open(target);
      try {
        const id = findByBody(cp, "discussion in conversation") as string;
        const rows = cp.store.prospectiveFor(id);
        expect(rows.length).toBe(1);
        expect(rows[0]?.window_key).toBe("2026-08");
        expect(rows[0]?.state).toBe("fired");
        expect(rows[0]?.fires).toBe(1);
        expect(rows[0]?.precision).toBe("month");
        expect(rows[0]?.last_fired_day).toBeNull();
      } finally {
        cp.close();
      }
      expect(report.dropped["prospective.lastFiredDay"]).toBe(2);
      expect(report.skipped.some((s) => s.reason === "prospective-trace-unmapped")).toBe(true);
    });

    test("a v1 merge arrives archived with its pointer, and does not fake a chain", () => {
      const report = migrate({ source, target, apply: true });
      const cp = open(target);
      try {
        const id = findByBody(cp, "Three separate afternoons") as string;
        const read = cp.store.read(id);
        expect(read.archived).toBe(true);
        expect(read.archivedReason).toBe("merged-into:tr_plain");
        expect(read.doc.meta["mergedInto"]).toBe("tr_plain");
        // A named gap, out loud: resolve() does not forward a v1 merge.
        expect(cp.store.resolve(id)).toBe(id);
      } finally {
        cp.close();
      }
      expect(report.approximations.some((a) => a.name === "MERGE_AS_ARCHIVE")).toBe(true);
    });
  });

  // ── G9: idempotence ──────────────────────────────────────────────────────

  describe("idempotence (G9)", () => {
    test("a second run performs no write, and duplicates nothing", () => {
      const first = migrate({ source, target, apply: true });
      const idsBefore = (() => {
        const cp = open(target);
        try {
          return cp.store.list({}).sort();
        } finally {
          cp.close();
        }
      })();
      const proseBefore = proseSnapshot(target);

      const second = migrate({ source, target, apply: true });

      expect(first.writes?.created).toBeGreaterThan(0);
      expect(second.writes?.created).toBe(0);
      expect(second.writes?.entitiesBorn).toBe(0);
      expect(second.writes?.elementsAdded).toBe(0);
      expect(second.writes?.edges).toBe(0);
      expect(second.writes?.prospective).toBe(0);
      expect(second.writes?.archived).toBe(0);
      expect(second.writes?.refused).toBe(0);

      const cp = open(target);
      try {
        expect(cp.store.list({}).sort()).toEqual(idsBefore);
      } finally {
        cp.close();
      }
      // Canonical prose is byte-identical. (The database's own file is NOT the
      // assertion: a sqlite file's pages move on open, and asserting on them
      // would be asserting on the wrong thing.)
      expect(proseSnapshot(target)).toEqual(proseBefore);
    });

    test("the same source maps to the same addresses every time", () => {
      const a = planMigration(readV1(source));
      const b = planMigration(readV1(source));
      expect(a.docs.map((d) => d.v2Id)).toEqual(b.docs.map((d) => d.v2Id));
    });
  });

  // ── G10: the report ──────────────────────────────────────────────────────

  describe("the report (G10)", () => {
    test("every kind balances: read == imported + skipped", () => {
      const report = migrate({ source, target, apply: true });
      for (const [name, c] of Object.entries(report.counts)) {
        expect(`${name}:${c.read}`).toBe(`${name}:${c.imported + c.skipped}`);
      }
    });

    test("every skip carries a named reason — nothing is dropped silently", () => {
      const report = migrate({ source, target, apply: true });
      expect(report.skipped.length).toBeGreaterThan(0);
      for (const s of report.skipped) {
        expect(s.reason.length).toBeGreaterThan(0);
        expect(s.reason).not.toBe("unspecified-DEFECT");
        expect(s.ref.length).toBeGreaterThan(0);
      }
    });

    test("the ledger is counted and named, not quietly mapped to pressure", () => {
      const report = migrate({ source, target, apply: true });
      expect(report.counts.ledger.read).toBe(1);
      expect(report.counts.ledger.imported).toBe(0);
      expect(
        report.skipped.some((s) => s.reason === "ledger-open-not-mapped-to-pressure"),
      ).toBe(true);
    });

    test("turning the unwired ledger tunable ON refuses by name rather than no-oping", () => {
      expect(() =>
        migrate({ source, target, apply: true, tunables: { LEDGER_TO_PRESSURE: true } }),
      ).toThrow(/LEDGER_TO_PRESSURE_NOT_WIRED/);
    });

    test("what the target cannot recompute is declared", () => {
      const report = migrate({ source, target, apply: true });
      expect(report.declared.some((d) => d.startsWith("embeddings:"))).toBe(true);
      expect(report.declared.some((d) => d.includes("config.json"))).toBe(true);
    });
  });

  // ── G11: the source is read-only ─────────────────────────────────────────

  describe("read-only on the source (G11)", () => {
    test("the source is byte-identical after a full apply", () => {
      const before = walk(source).map((p) => `${p}:${statSync(p).size}`);
      const report = migrate({ source, target, apply: true });
      expect(report.source_readonly.identical).toBe(true);
      expect(report.source_readonly.changed).toEqual([]);
      expect(report.source_readonly.files).toBeGreaterThan(0);
      expect(walk(source).map((p) => `${p}:${statSync(p).size}`)).toEqual(before);
    });

    test("the reader imports no write API — a source-scan, not a promise", () => {
      const here = dirname(fileURLToPath(import.meta.url));
      const src = readFileSync(join(here, "..", "tools", "migrate", "read.ts"), "utf8");
      for (const forbidden of [
        "writeFileSync",
        "appendFileSync",
        "mkdirSync",
        "renameSync",
        "rmSync",
        "unlinkSync",
        "copyFileSync",
        "openSync",
        "truncateSync",
      ]) {
        expect(`read.ts:${forbidden}:${src.includes(forbidden)}`).toBe(
          `read.ts:${forbidden}:false`,
        );
      }
    });

    test("the target may never be a live v1 store, dry run included", () => {
      const forbidden = join(process.env["HOME"] ?? "/nonexistent", ".bansai", "nope");
      expect(() => migrate({ source, target: forbidden })).toThrow(/DATA_DIR_FORBIDDEN/);
    });

    test("source and target may not overlap", () => {
      expect(() => migrate({ source, target: join(source, "v2") })).toThrow(
        /SOURCE_TARGET_OVERLAP/,
      );
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// The 2026-08-29 pre-cutover dry-run findings, pinned (docs/DECISIONS.md arc)
// ═══════════════════════════════════════════════════════════════════════════
describe("dry-run findings — the ledger's real shape, and no ink for the retired", () => {
  test("a ledger entry missing its id or ref is skipped and COUNTED — a partial read never looks complete", () => {
    const dir = mkdtempSync(join(tmpdir(), "counterparts-migledgerbad-"));
    try {
      writeFileSync(
        join(dir, "ledger.json"),
        JSON.stringify([
          { id: "led_ok", schemaElementRef: "el_x", evidence: [], cumulativeScore: 0.2, status: "open" },
          { schemaElementRef: "el_y", status: "open" }, // no id
          { id: "led_noref", status: "open" }, // no ref
        ]),
        "utf8",
      );
      const v1 = readV1(dir);
      expect(v1.ledger.length).toBe(1);
      // The cutover run can now PROVE it read every real entry: the two it
      // could not use are named, not vanished (the finding this PR fixes was
      // exactly a silent ledger zero).
      const ledgerMalformed = v1.malformed.filter((m) => m.relPath === "ledger.json");
      expect(ledgerMalformed.length).toBe(2);
      expect(ledgerMalformed.map((m) => m.reason).join(" ")).toContain("missing id");
      expect(ledgerMalformed.map((m) => m.reason).join(" ")).toContain("missing schemaElementRef");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("an object-keyed ledger still reads — tolerance, like the span near-misses", () => {
    const dir = mkdtempSync(join(tmpdir(), "counterparts-migledger-"));
    try {
      writeFileSync(
        join(dir, "ledger.json"),
        JSON.stringify({
          led_obj: {
            id: "led_obj",
            schemaElementRef: "el_x",
            evidence: [],
            cumulativeScore: 0.2,
            status: "open",
          },
        }),
        "utf8",
      );
      const v1 = readV1(dir);
      expect(v1.ledger.length).toBe(1);
      expect(v1.ledger[0]?.id).toBe("led_obj");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("an ARCHIVED trace's gradient earns NO permanent ink — retired memories do not arrive identity", () => {
    // The dry run against the real store found an archived/superseded self
    // trace at gradient 0.95: NOTES §6's histogram measured the LIVE set only,
    // and without this rule the cut would have minted a twentieth promotion
    // for a memory v1 itself had already retired.
    const dir = mkdtempSync(join(tmpdir(), "counterparts-migarch-"));
    const out = mkdtempSync(join(tmpdir(), "counterparts-migarch-out-"));
    try {
      mkdirSync(join(dir, "traces"), { recursive: true });
      writeFileSync(
        join(dir, "traces", "tr_retired.md"),
        [
          "---",
          "id: tr_retired01",
          "kind: self",
          "scope: global",
          "confidentiality: normal",
          "salience: 0.95",
          "gradient: 0.95",
          "created_active_day: 2",
          "archived: true",
          "archive_reason: superseded",
          "---",
          "A once-central self understanding that v1 later superseded and retired.",
        ].join("\n"),
        "utf8",
      );
      writeFileSync(
        join(dir, "traces", "tr_live.md"),
        [
          "---",
          "id: tr_live01",
          "kind: self",
          "scope: global",
          "confidentiality: normal",
          "salience: 0.95",
          "gradient: 0.95",
          "created_active_day: 2",
          "---",
          "A still-lived self understanding that remains at the very top tier.",
        ].join("\n"),
        "utf8",
      );
      const report = migrate({ source: dir, target: join(out, "store"), apply: true });
      const cp = open(join(out, "store"));
      try {
        const retired = findByBody(cp, "later superseded and retired");
        const live = findByBody(cp, "remains at the very top tier");
        expect(retired).not.toBeNull();
        expect(live).not.toBeNull();
        expect(cp.store.physicsOf(retired as string).promotedIdentity).toBe(false);
        expect(cp.store.physicsOf(live as string).promotedIdentity).toBe(true);
      } finally {
        cp.close();
      }
      // Both counted, by name: one promotion, one exemption.
      expect(report.approximations.find((a) => a.name === "IDENTITY_GRADIENT_CUT")?.applied).toBe(1);
      expect(
        report.approximations.find((a) => a.name === "IDENTITY_CUT_ARCHIVED_EXEMPT")?.applied,
      ).toBe(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
      rmSync(out, { recursive: true, force: true });
    }
  });
});
