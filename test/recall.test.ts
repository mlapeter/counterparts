/**
 * recall/ — cues, activation, the surfacing gate, the bounded injection.
 *
 * Hermetic by construction (CLAUDE.md): every test makes a fresh temp data dir in
 * beforeEach and removes ONLY that path in afterEach. Nothing here can reach a
 * real store.
 *
 * Assertions name the REASON — `verdict`, `DecisionReason`, `CreditReason`,
 * `CreditOutcome.reason` — never just "it was absent". A memory that is missing
 * from an injection because the gate refused it and one that is missing because
 * the cue extractor never found it are different systems, and a test that cannot
 * tell them apart is the test v1 shipped.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { Store } from "../src/core/store/index.js";
import type { ProseDoc, PutInput } from "../src/core/store/index.js";
import type { MemoryPhysics } from "../src/core/types.js";
import { USE_TIER_WEIGHT } from "../src/core/physics/index.js";
import {
  FRAMING,
  Recall,
  TRIM_ORDER,
  byteLength,
  detectAffect,
  freshGateState,
  gate,
  SCALAR_REF,
  informativeness,
  render,
  stripBoilerplate,
} from "../src/core/recall/index.js";
import type { Candidate, CandidateVerdict, Verdict } from "../src/core/recall/index.js";

const RECALL_SRC = fileURLToPath(new URL("../src/core/recall/", import.meta.url));

let dir: string;
let priorEnv: string | undefined;
const open: Store[] = [];

beforeEach(() => {
  priorEnv = process.env["COUNTERPARTS_DATA_DIR"];
  dir = mkdtempSync(join(tmpdir(), "counterparts-recall-"));
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

/**
 * Sixteen unremarkable memories, no shared distinctive vocabulary. They exist so
 * the store clears `COLD_START_MIN_STORE` — every gate test runs in the ordinary
 * regime unless it says otherwise, rather than half of them silently running in
 * the strict cold-start one.
 */
const FILLER: readonly string[] = [
  "Ran the morning loop around the reservoir before breakfast.",
  "The tax filing deadline moved to October this year.",
  "Prefers dense espresso over filter coffee at home.",
  "The garage door opener needs a new battery soon.",
  "Rebasing keeps the history readable for reviewers.",
  "The neighbour's cat sits on the fence every evening.",
  "Bought hiking boots that finally fit properly.",
  "The library closes early on Sundays now.",
  "Wrote a short letter to an old teacher.",
  "The kitchen tap drips when the pressure is high.",
  "Set up a standing desk in the spare bedroom.",
  "The bus route changed and adds ten minutes.",
  "Started keeping receipts in one envelope.",
  "The printer jams on heavy paper stock.",
  "Planted three tomato seedlings in the planter.",
  "Fixed the wobbling chair leg with a shim.",
];

function seed(s: Store): void {
  for (const body of FILLER) s.put({ type: "memory", kind: "fact", body });
}

function put(s: Store, input: Partial<PutInput> & { body: string }): string {
  return s.put({ type: "memory", kind: "fact", ...input });
}

function verdictOf(verdicts: readonly CandidateVerdict[], id: string): Verdict | "not-a-candidate" {
  return verdicts.find((v) => v.id === id)?.verdict ?? "not-a-candidate";
}

// ── unit fixtures for the gate, which is pure ──────────────────────────────

function phys(over: Partial<MemoryPhysics> = {}): MemoryPhysics {
  return {
    kind: "fact",
    salience: { novelty: null, relevance: 0, emotional: 0, predictive: 0, claimed: null },
    birthDay: 0,
    uses: 0,
    lastUsedDay: 0,
    reinforcedDays: 0,
    consolidated: false,
    promotedIdentity: false,
    protected: false,
    pressure: 0,
    lastChallengedDay: null,
    ...over,
  };
}

function doc(id: string, body: string): ProseDoc {
  return { id, type: "memory", learnedOn: "2026-08-25", bornDay: 0, meta: {}, body };
}

interface CandSpec {
  id: string;
  cue?: number;
  semantic?: number;
  arrival?: number;
  sal?: number;
  kind?: Candidate["kind"];
  body?: string;
  confidential?: boolean;
  trains?: boolean;
  emotional?: number;
  /** SEAMS item D: the temporal portion of `cue`, and the per-candidate cap. */
  temporal?: number;
  maxTier?: Candidate["maxTier"];
  /** SEAMS item L: spreading activation — in `activation`, never in cueFraction. */
  hops?: number;
}

function cand(spec: CandSpec): Candidate {
  const cue = spec.cue ?? 1;
  const semantic = spec.semantic ?? 0;
  const arrival = spec.arrival ?? 0;
  const temporal = spec.temporal ?? 0;
  const hops = spec.hops ?? 0;
  const activation = cue + semantic + arrival + hops;
  const body = spec.body ?? `body of ${spec.id} unique tokens here`;
  return {
    id: spec.id,
    kind: spec.kind ?? "fact",
    doc: doc(spec.id, body),
    physics: phys({ salience: { novelty: null, relevance: 0, emotional: spec.emotional ?? 0, predictive: 0, claimed: null } }),
    strength: 0,
    sal: spec.sal ?? 0.5,
    cue,
    temporal,
    semantic,
    arrival,
    hops,
    activation,
    cueFraction: activation > 0 ? (cue + semantic) / activation : 0,
    matched: 1,
    trains: spec.trains ?? true,
    maxTier: spec.maxTier ?? (temporal > 0 && cue - temporal <= 0 && semantic <= 0 ? "footnoted" : "surfaced"),
    confidential: spec.confidential ?? false,
  };
}

function gateOn(candidates: Candidate[], over: Partial<Parameters<typeof gate>[0]> = {}) {
  return gate(
    {
      candidates,
      state: freshGateState("unit"),
      storeSize: 100,
      owner: true,
      affectStated: false,
      turn: 1,
      ...over,
    },
    new Recall({ store: store() }).tunables,
  );
}

// ═══════════════════════════════════════════════════════════════════════════
describe("cues — boilerplate, rarity, and the two subject rules", () => {
  test("host boilerplate is stripped BEFORE cue extraction (§9 G3)", () => {
    const raw =
      "<system-reminder>zygomorphic reminder text</system-reminder> what is left [Image #3] here";
    const { text, stripped } = stripBoilerplate(raw);
    expect(stripped).toContain("system-reminder");
    expect(stripped).toContain("image-placeholder");
    expect(text).not.toContain("zygomorphic");
    expect(text).toContain("what is left");
  });

  test("recall's own render is stripped, so a surfaced memory cannot re-cue itself", () => {
    const injection =
      "<!-- counterparts:recall t=1 -->\nCame to mind:\n- zygomorphic\n<!-- counterparts:recall/end surfaced=1 footnotes=0 affect=0 bytes=60 -->";
    const { text, stripped } = stripBoilerplate(`${injection}\nand my actual question`);
    expect(stripped).toContain("counterparts-injection");
    expect(text).not.toContain("zygomorphic");
  });

  test("a token spanning the whole store contributes NOTHING — no stop list needed", () => {
    expect(informativeness(20, 20)).toBe(0);
    expect(informativeness(1, 20)).toBeGreaterThan(informativeness(10, 20));
    expect(informativeness(0, 20)).toBe(0);
  });

  test("the affect FLAG is subject-inclusive; the retrieval CUE is first-person only", () => {
    const third = detectAffect("she was completely overwhelmed by the move");
    expect(third.stated).toBe(true);
    expect(third.selfFelt).toBe(false);

    const first = detectAffect("I have been feeling pretty overwhelmed lately");
    expect(first.stated).toBe(true);
    expect(first.selfFelt).toBe(true);

    const none = detectAffect("the invoice is due on Tuesday");
    expect(none.stated).toBe(false);
    expect(none.selfFelt).toBe(false);

    // A feeling REPORTED to the speaker is still not the speaker's own.
    const reported = detectAffect("she told me that Robin was upset about it");
    expect(reported.stated).toBe(true);
    expect(reported.selfFelt).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe("the surfacing pipeline", () => {
  test("an empty store returns cleanly: the empty string, reason no-candidates", () => {
    const s = store();
    const r = new Recall({ store: s, owner: true });
    const out = r.recall({ sessionId: "s1", text: "anything at all about sourdough" });
    expect(out.injection).toBe("");
    expect(out.decision.reason).toBe("no-candidates");
    expect(out.decision.candidates).toBe(0);
    expect(out.decision.storeSize).toBe(0);
    expect(out.decision.sentinel).toBeNull();
  });

  test("a cued memory surfaces, and the decision record says how", () => {
    const s = store();
    seed(s);
    const id = put(s, {
      kind: "skill",
      title: "Sourdough starter",
      body: "The sourdough starter died after two weeks of neglect and needs daily feeding.",
      salience: { relevance: 0.6, emotional: 0.2, predictive: 0.4 },
    });
    const r = new Recall({ store: s, owner: true });
    const out = r.recall({ sessionId: "s1", text: "my sourdough starter died again" });

    expect(out.decision.reason).toBe("rendered");
    expect(verdictOf(out.decision.verdicts, id)).toBe("surfaced");
    expect(out.injection).toContain(FRAMING.surfacedHeader);
    // One cued candidate is not a distribution: the gate says so out loud rather
    // than comparing a candidate against a background made of itself.
    expect(out.decision.background.regime).toBe("absolute-thin-background");
    expect(out.decision.background.n).toBe(1);
  });

  test("with a real background the bar is RELATIVE, and leave-one-out, per candidate", () => {
    const s = store();
    seed(s);
    const strong = put(s, {
      kind: "skill",
      body: "The kiln kiln kiln firing schedule for stoneware glaze tests.",
    });
    const mid = put(s, { kind: "skill", body: "The kiln shelf cracked during the last firing." });
    const weak = put(s, { kind: "fact", body: "A kiln sits in the corner of the shared studio." });
    const r = new Recall({ store: s, owner: true });
    const out = r.recall({ sessionId: "s1", text: "kiln firing schedule" });

    expect(out.decision.background.regime).toBe("relative");
    expect(out.decision.background.n).toBeGreaterThanOrEqual(3);
    const bars = new Map(out.decision.verdicts.map((v) => [v.id, v.bar]));
    // Leave-one-out: no two candidates face the same number, and the strongest
    // faces the LOWEST bar precisely because it is not in its own background.
    expect(bars.get(strong)).not.toBe(bars.get(weak));
    expect(bars.get(strong) ?? 1e9).toBeLessThan(bars.get(weak) ?? 0);
    expect([strong, mid, weak].every((id) => bars.has(id))).toBe(true);
  });

  test("a quiet turn renders the EMPTY STRING, not an empty block", () => {
    const s = store();
    seed(s);
    const r = new Recall({ store: s, owner: true });
    const out = r.recall({ sessionId: "s1", text: "qqqq wwww eeee rrrr" });
    expect(out.injection).toBe("");
    expect(out.injection).not.toContain("counterparts:recall");
    expect(out.decision.reason).toBe("no-candidates");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe("the hard gates salience cannot override", () => {
  test("(a) an uncued memory is DARK whatever its salience, strength or protection", () => {
    const s = store();
    seed(s);
    const sacred = put(s, {
      kind: "self",
      title: "The lighthouse",
      body: "Standing at the lighthouse felt like the end of something enormous.",
      band: "identity",
      physics: { promotedIdentity: true, protected: true, consolidated: true, uses: 40 },
      salience: { novelty: 1, relevance: 1, emotional: 1, predictive: 1, claimed: 1 },
    });
    const cued = put(s, {
      kind: "skill",
      body: "The sourdough starter died after two weeks of neglect.",
    });

    const r = new Recall({ store: s, owner: true });
    const out = r.recall({ sessionId: "s1", text: "my sourdough starter died again" });

    // The strongest, most protected memory in the store is not merely refused —
    // it is never a candidate, so its salience arithmetic is never evaluated.
    expect(verdictOf(out.decision.verdicts, sacred)).toBe("not-a-candidate");
    expect(out.decision.surfaced).not.toContain(sacred);
    expect(out.decision.footnotes).not.toContain(sacred);
    // ...while the merely-relevant one arrives, so this is not a dead pipeline.
    expect(out.decision.surfaced).toContain(cued);
  });

  test("(a) an arrival-only candidate is dark even at maximum salience", () => {
    const g = gateOn([
      cand({ id: "mem_arrival", cue: 0, semantic: 0, arrival: 0.9, sal: 1 }),
      cand({ id: "mem_cued", cue: 3 }),
    ]);
    expect(verdictOf(g.verdicts, "mem_arrival")).toBe("dark-uncued");
  });

  test("(b) the absolute floor is checked BEFORE any salience adjustment", () => {
    // sal = 1 halves the relative bar. The floor does not care.
    const g = gateOn([
      cand({ id: "mem_tiny", cue: 0.1, sal: 1 }),
      cand({ id: "mem_a", cue: 2 }),
      cand({ id: "mem_b", cue: 3 }),
      cand({ id: "mem_c", cue: 4 }),
    ]);
    expect(verdictOf(g.verdicts, "mem_tiny")).toBe("below-floor");
  });

  test("(c) the loud tier needs a minimum cue fraction — recency alone cannot carry", () => {
    const g = gateOn([
      cand({ id: "mem_recency", cue: 0.2, arrival: 1.4, sal: 0 }),
      cand({ id: "mem_a", cue: 0.25 }),
      cand({ id: "mem_b", cue: 0.25 }),
      cand({ id: "mem_c", cue: 0.25 }),
    ]);
    const v = g.verdicts.find((x) => x.id === "mem_recency");
    expect(v?.verdict).toBe("footnoted");
    expect(v?.loudBlockedBy).toBe("cue-fraction");
    expect(g.surfaced.map((c) => c.id)).not.toContain("mem_recency");
  });

  test("confidentiality is a boundary gate: withheld from a non-owner, returned to the owner", () => {
    const s = store();
    seed(s);
    const id = put(s, {
      kind: "person",
      title: "Compensation",
      body: "The compensation renegotiation with Marisol is confidential until the offer lands.",
      meta: { confidential: true },
    });

    const nonOwner = new Recall({ store: s, owner: false });
    const a = nonOwner.recall({ sessionId: "s1", text: "the compensation renegotiation with Marisol" });
    expect(verdictOf(a.decision.verdicts, id)).toBe("confidential-withheld");
    expect(a.injection).not.toContain(id);

    const owner = new Recall({ store: s, owner: true });
    const b = owner.recall({ sessionId: "s2", text: "the compensation renegotiation with Marisol" });
    expect(verdictOf(b.decision.verdicts, id)).toBe("surfaced");
  });

  test("tiers are disjoint and capped, and the overflow says so", () => {
    const nouns =
      "alder birch cedar dogwood elm fir ginkgo hawthorn ironwood juniper".split(" ");
    const many = Array.from({ length: 10 }, (_, i) =>
      cand({ id: `mem_${i}`, cue: 2, body: `${nouns[i]} grove notes number ${nouns[i]}` }),
    );
    const g = gateOn(many);
    expect(g.surfaced.length).toBe(2);
    expect(g.footnotes.length).toBe(6);
    const loud = new Set(g.surfaced.map((c) => c.id));
    for (const f of g.footnotes) expect(loud.has(f.id)).toBe(false);
    expect(g.verdicts.filter((v) => v.verdict === "capped").length).toBe(2);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe("per-session gate state is PERSISTED (the ruling, and v1's dark behaviors)", () => {
  test("state survives across two Recall instances and two Store handles", () => {
    const s1 = store();
    seed(s1);
    const id = put(s1, {
      kind: "skill",
      body: "The sourdough starter died after two weeks of neglect.",
    });
    const turn = { sessionId: "shared-session", text: "my sourdough starter died again" };

    const first = new Recall({ store: s1, owner: true }).recall(turn);
    // Assert the POSITIVE first: a vacuously quiet turn would make the dedup
    // assertion below meaningless.
    expect(first.decision.reason).toBe("rendered");
    expect(first.decision.surfaced).toContain(id);
    expect(first.decision.turn).toBe(1);
    s1.close();

    // A fresh process, as far as this module can tell: new Store, new Recall.
    const s2 = store();
    const second = new Recall({ store: s2, owner: true }).recall(turn);

    expect(second.decision.turn).toBe(2);
    expect(verdictOf(second.decision.verdicts, id)).toBe("dedup-suppressed");
    expect(second.decision.surfaced).not.toContain(id);
    expect(second.injection).toBe("");
    expect(second.decision.reason).toBe("all-gated");
  });

  test("the state lives in box 2 as ONE ROW PER RECORD with a defined lifetime (SEAMS B)", () => {
    const s = store();
    seed(s);
    put(s, { kind: "skill", body: "The sourdough starter died after two weeks of neglect." });
    const r = new Recall({ store: s, owner: true });
    r.recall({ sessionId: "s1", text: "my sourdough starter died again" });

    const rows = s.gateRecords("s1");
    expect(rows.length).toBeGreaterThan(0);
    const scalar = rows.find((r) => r.kind === "scalar" && r.ref === SCALAR_REF);
    expect(scalar).toBeDefined();
    expect(JSON.parse(scalar?.value ?? "{}").v).toBe(1);
    expect(scalar?.turn).toBe(1);
    expect(typeof scalar?.last_day).toBe("number");
    // Each surfaced memory is its OWN row: a second writer replaces only its own.
    expect(rows.some((r) => r.kind === "surfaced")).toBe(true);
  });

  test("cue carry-over crosses the process boundary too", () => {
    const s1 = store();
    seed(s1);
    put(s1, { kind: "skill", body: "The sourdough starter died after two weeks of neglect." });
    new Recall({ store: s1, owner: true }).recall({
      sessionId: "s1",
      text: "my sourdough starter died again",
    });
    s1.close();

    const s2 = store();
    const r2 = new Recall({ store: s2, owner: true });
    const next = r2.recall({ sessionId: "s1", text: "what should I do about it" });
    expect(next.decision.carriedCueCount).toBeGreaterThan(0);
    // ...and they expire after exactly one turn: turn 2 minted no cues of its
    // own, so turn 3 inherits nothing. Carry-over is one hop, never a ratchet.
    const third = r2.recall({ sessionId: "s1", text: "never mind then" });
    expect(third.decision.carriedCueCount).toBe(0);
    expect(r2.gateState("s1").carriedFromTurn).toBe(3);
  });

  test("the emotional refractory holds the affect flag down after it fires", () => {
    const s = store();
    seed(s);
    put(s, {
      kind: "self",
      body: "The layoff conversation with Marisol left a mark that has not faded.",
      salience: { relevance: 0.8, emotional: 0.95, predictive: 0.3 },
    });
    const r = new Recall({ store: s, owner: true });
    const t = { sessionId: "s1", text: "I still feel upset about the layoff conversation" };

    const a = r.recall(t);
    expect(a.decision.affectReason).toBe("fired");
    expect(a.injection).toContain(FRAMING.affect);

    const b = r.recall({ ...t, text: "I feel upset about the layoff again" });
    expect(b.decision.affectReason).toBe("refractory");
    expect(b.decision.affectFlag).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe("the footnote tier trains nothing, proved through the seam", () => {
  test("footnoted credit reaches physics and comes back w = 0, ignorable-tier", () => {
    const s = store();
    const id = put(s, { body: "The sourdough starter died after two weeks of neglect." });
    s.advanceClock("2026-08-26");
    const before = s.physicsOf(id);

    const r = new Recall({ store: s, owner: true });
    const out = r.resolveUse("s1", id, "footnoted");

    expect(USE_TIER_WEIGHT.footnoted).toBe(0);
    expect(out.credited).toBe(false);
    expect(out.reason).toBe("physics-refused");
    expect(out.outcome?.reason).toBe("ignorable-tier");
    expect(out.outcome?.w).toBe(0);

    // Proved through the seam, not around it: the store WAS asked, and refused.
    const seam = s.events("store.reinforce");
    expect(seam.length).toBe(1);
    expect(seam[0]?.data?.["tier"]).toBe("footnoted");
    expect(seam[0]?.data?.["credited"]).toBe(false);

    const after = s.physicsOf(id);
    expect(after.uses).toBe(before.uses);
    expect(after.reinforcedDays).toBe(before.reinforcedDays);
  });

  test("the referenced tier does train — so the refusal above is about the tier", () => {
    const s = store();
    const id = put(s, { body: "The sourdough starter died after two weeks of neglect." });
    s.advanceClock("2026-08-26");
    const r = new Recall({ store: s, owner: true });

    const out = r.resolveUse("s1", id, "referenced");
    expect(out.credited).toBe(true);
    expect(out.reason).toBe("credited");
    expect(s.physicsOf(id).uses).toBe(USE_TIER_WEIGHT.referenced);
    expect(s.physicsOf(id).reinforcedDays).toBe(1);
  });

  test("credit never downgrades an already-credited item", () => {
    const s = store();
    const id = put(s, { body: "The sourdough starter died after two weeks of neglect." });
    s.advanceClock("2026-08-26");
    const r = new Recall({ store: s, owner: true });

    expect(r.resolveUse("s1", id, "referenced").credited).toBe(true);
    const down = r.resolveUse("s1", id, "surfaced");
    expect(down.credited).toBe(false);
    expect(down.reason).toBe("already-credited-at-or-above");
    expect(s.events("store.reinforce").length).toBe(1);
  });

  test("an ambiguous handle fires at reduced weight AND trains nothing — both halves", () => {
    const s = store();
    seed(s);
    const a = put(s, { kind: "person", body: "Robin runs the Tuesday climbing session downtown." });
    const b = put(s, { kind: "person", body: "Robin from accounting handles quarterly invoices." });
    const aliases = new Map<string, readonly string[]>([["robin", [a, b]]]);

    const r = new Recall({ store: s, owner: true });
    const out = r.recall({ sessionId: "s1", text: "robin robin robin", aliases });

    const surfacedIds = [...out.decision.surfaced, ...out.decision.footnotes];
    expect(surfacedIds.length).toBeGreaterThan(0);
    expect(out.decision.ambiguousCueCount).toBe(1);
    const v = out.decision.verdicts.find((x) => x.id === surfacedIds[0]);
    expect(v?.trains).toBe(false);

    s.advanceClock("2026-08-26");
    const credit = r.resolveUse("s1", surfacedIds[0] ?? "", "referenced");
    expect(credit.credited).toBe(false);
    expect(credit.reason).toBe("ambiguous-handle-trains-nothing");
    // The store seam was never even reached: no consumer, no training.
    expect(s.events("store.reinforce").length).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe("the bounded injection", () => {
  const resolver = (id: string) => ({
    title: `title for ${id} with a reasonably long tail of words`,
    gist: `a gist for ${id} that runs on for quite a while so it can be trimmed and clipped`,
  });

  test("the composed total never exceeds the budget, and the render ends with a sentinel", () => {
    for (const budget of [80, 140, 260, 512, 4096]) {
      const res = render(
        {
          turn: 3,
          affectFlag: true,
          surfaced: ["mem_a", "mem_b"],
          footnotes: ["mem_c", "mem_d", "mem_e", "mem_f"],
          budgetBytes: budget,
          gistBytes: 240,
          titleBytes: 80,
          pressureRatio: 0.9,
        },
        resolver,
      );
      expect(byteLength(res.text)).toBeLessThanOrEqual(budget);
      expect(res.bytes).toBe(byteLength(res.text));
      if (res.text === "") {
        expect(res.sentinel).toBeNull();
      } else {
        expect(res.sentinel).not.toBeNull();
        expect(res.text.endsWith(res.sentinel ?? "!")).toBe(true);
        // The sentinel is self-describing: counts and the TRUE byte total.
        expect(res.sentinel).toContain(`surfaced=${res.surfaced.length}`);
        expect(res.sentinel).toContain(`footnotes=${res.footnotes.length}`);
        expect(res.sentinel).toContain(`bytes=${res.bytes}`);
      }
    }
  });

  test("the trim order is explicit: footnotes go before gists, the affect flag goes last", () => {
    expect(TRIM_ORDER).toEqual(["footnote", "surfaced", "affect"]);
    const res = render(
      {
        turn: 1,
        affectFlag: true,
        surfaced: ["mem_a", "mem_b"],
        footnotes: ["mem_c", "mem_d", "mem_e"],
        budgetBytes: 220,
        gistBytes: 240,
        titleBytes: 80,
        pressureRatio: 0.9,
      },
      resolver,
    );
    const lanes = res.trimmed.map((x) => x.lane);
    expect(lanes.length).toBeGreaterThan(0);
    const firstSurfaced = lanes.indexOf("surfaced");
    const lastFootnote = lanes.lastIndexOf("footnote");
    if (firstSurfaced !== -1 && lastFootnote !== -1) {
      expect(lastFootnote).toBeLessThan(firstSurfaced);
    }
    // Everything trimmed is trimmed from the WEAK end of its lane.
    expect(res.footnotes.length).toBeLessThan(3);
  });

  test("footnotes are pointers with titles and ids, never bodies", () => {
    const res = render(
      {
        turn: 1,
        affectFlag: false,
        surfaced: [],
        footnotes: ["mem_c"],
        budgetBytes: 4096,
        gistBytes: 240,
        titleBytes: 80,
        pressureRatio: 0.9,
      },
      resolver,
    );
    expect(res.text).toContain(FRAMING.footnoteHeader);
    expect(res.text).toContain("[mem_c]");
    expect(res.text).not.toContain("a gist for mem_c");
  });

  test("delivery is checked separately from rendering — 'we rendered it' is not 'they got it'", () => {
    const s = store();
    seed(s);
    put(s, {
      kind: "skill",
      body: "The sourdough starter died after two weeks of neglect.",
    });
    const r = new Recall({ store: s, owner: true });
    const out = r.recall({ sessionId: "s1", text: "my sourdough starter died again" });
    const expected = out.decision.sentinel;
    expect(expected).not.toBeNull();

    expect(r.noteDelivered("s1", expected, expected)).toBe(true);
    // A truncated arrival: the last line the host saw is not the one we composed.
    expect(r.noteDelivered("s1", "<!-- counterparts:recall/end surfaced=9 -->", expected)).toBe(false);
    expect(r.noteDelivered("s1", null, expected)).toBe(false);

    const delivered = r.events().filter((e) => e.name === "recall.delivered");
    expect(delivered.length).toBe(3);
    expect(delivered[0]?.data?.["ok"]).toBe(true);
    expect(delivered[1]?.data?.["ok"]).toBe(false);
    expect(delivered[2]?.data?.["sawSentinel"]).toBe(false);
  });

  test("end to end: a small host ceiling still produces a valid, in-budget render", () => {
    const s = store();
    seed(s);
    put(s, {
      kind: "skill",
      title: "Sourdough starter",
      body: "The sourdough starter died after two weeks of neglect and needs daily feeding in warm weather to recover its rise.",
    });
    const r = new Recall({ store: s, owner: true, budgetBytes: 200 });
    const out = r.recall({ sessionId: "s1", text: "my sourdough starter died again" });
    expect(byteLength(out.injection)).toBeLessThanOrEqual(200);
    if (out.injection !== "") {
      expect(out.injection).toContain("counterparts:recall/end");
      expect(out.decision.sentinel).not.toBeNull();
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe("observer mode — surfaces, strengthens nothing, deposits nothing", () => {
  test("recall reads normally under observer", () => {
    const s = store();
    seed(s);
    const id = put(s, {
      kind: "skill",
      body: "The sourdough starter died after two weeks of neglect.",
    });
    s.close();

    const obs = store({ observer: true });
    const r = new Recall({ store: obs, owner: true });
    const out = r.recall({ sessionId: "probe", text: "my sourdough starter died again" });

    expect(r.observer).toBe(true);
    expect(out.decision.reason).toBe("rendered");
    expect(out.decision.surfaced).toContain(id);
    // An observer is a NON-OWNER for confidentiality, whatever it was told.
    expect(out.decision.owner).toBe(false);
  });

  test("resolveUse REFUSES under observer, checked before any other work", () => {
    const s = store();
    const id = put(s, { body: "The sourdough starter died after two weeks of neglect." });
    s.advanceClock("2026-08-26");
    const before = s.physicsOf(id);
    s.close();

    const obs = store({ observer: true });
    const r = new Recall({ store: obs, owner: true });
    const out = r.resolveUse("probe", id, "referenced");

    expect(out.credited).toBe(false);
    expect(out.reason).toBe("observer");
    expect(out.outcome).toBeNull();
    // It refused BEFORE the store seam, so the store never even had to stand down.
    expect(obs.events("store.reinforce").length).toBe(0);
    expect(obs.events("store.observer.standdown").length).toBe(0);
    expect(obs.physicsOf(id).uses).toBe(before.uses);
    // ...and the stand-down is observable, so a stood-down instrument is
    // distinguishable from a broken hook.
    const stand = r.events().filter((e) => e.name === "recall.observer.standdown");
    expect(stand.some((e) => e.data?.["site"] === "resolveUse")).toBe(true);
  });

  test("observer deposits no gate state: the meta row is never written", () => {
    const s = store();
    seed(s);
    put(s, { kind: "skill", body: "The sourdough starter died after two weeks of neglect." });
    s.close();

    const obs = store({ observer: true });
    const r = new Recall({ store: obs, owner: true });
    r.recall({ sessionId: "probe", text: "my sourdough starter died again" });

    expect(obs.gateRecords("probe")).toEqual([]);
    expect(obs.events("store.gate.records").length).toBe(0);
    const stand = r.events().filter((e) => e.name === "recall.observer.standdown");
    expect(stand.some((e) => String(e.data?.["site"]).startsWith("persist:"))).toBe(true);
    // In-process state still advances, so the instrument's own dedup behaves
    // like the real thing while leaving nothing behind.
    expect(r.gateState("probe").turn).toBe(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe("structural guarantees", () => {
  test("no generative model call on the hot path — enumerated, not asserted in prose", () => {
    const files = readdirSync(RECALL_SRC).filter((f) => f.endsWith(".ts"));
    expect(files.length).toBeGreaterThan(3);
    for (const f of files) {
      const src = readFileSync(join(RECALL_SRC, f), "utf8");
      expect(src).not.toMatch(/\bfetch\s*\(/);
      expect(src).not.toMatch(/https?:\/\//);
      expect(src).not.toMatch(/anthropic|openai|node:https?\b/i);
      expect(src).not.toMatch(/\bXMLHttpRequest\b|\bWebSocket\b/);
    }
  });

  test("a latency-budget abort has ZERO side effects", () => {
    const s = store();
    seed(s);
    put(s, { kind: "skill", body: "The sourdough starter died after two weeks of neglect." });
    const r = new Recall({ store: s, owner: true, budgetMs: -1 });
    const out = r.recall({ sessionId: "s1", text: "my sourdough starter died again" });

    expect(out.injection).toBe("");
    expect(out.decision.aborted).toBe(true);
    expect(out.decision.reason).toBe("latency-abort");
    // Nothing injected, nothing buffered, NO TELEMETRY, no state advanced.
    expect(r.events().length).toBe(0);
    expect(s.gateRecords("s1")).toEqual([]);
    expect(r.gateState("s1").turn).toBe(0);
  });

  test("the decision record is content-by-reference: ids and numbers, never bodies", () => {
    const s = store();
    seed(s);
    put(s, {
      kind: "skill",
      title: "Sourdough starter",
      body: "The distinctive phrase zygomorphic appears only inside this body.",
    });
    const r = new Recall({ store: s, owner: true });
    const out = r.recall({ sessionId: "s1", text: "sourdough starter zygomorphic" });
    const serialized = JSON.stringify(out.decision);
    expect(serialized).not.toContain("zygomorphic");
    for (const e of r.events()) expect(JSON.stringify(e)).not.toContain("zygomorphic");
  });

  test("archived and superseded memories never surface", () => {
    const s = store();
    seed(s);
    const id = put(s, { kind: "skill", body: "The sourdough starter died after two weeks." });
    const r = new Recall({ store: s, owner: true });
    expect(r.recall({ sessionId: "a", text: "my sourdough starter died" }).decision.surfaced).toContain(id);

    s.archive(id, "test");
    const after = new Recall({ store: s, owner: true }).recall({
      sessionId: "b",
      text: "my sourdough starter died",
    });
    expect(verdictOf(after.decision.verdicts, id)).toBe("not-a-candidate");
    expect(after.decision.reason).toBe("no-candidates");
  });
});
