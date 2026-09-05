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

import { DEFAULT_LENGTH_NORM, Store } from "../src/core/store/index.js";
import type { ProseDoc, PutInput } from "../src/core/store/index.js";
import type { MemoryPhysics } from "../src/core/types.js";
import { USE_TIER_WEIGHT } from "../src/core/physics/index.js";
import {
  FRAMING,
  MIN_RARITY_STORE,
  Recall,
  TRIM_ORDER,
  byteLength,
  detectAffect,
  freshGateState,
  gate,
  SCALAR_REF,
  activate,
  informativeness,
  render,
  stripBoilerplate,
  TUNABLES,
  withTunables,
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

/**
 * Everything the turn actually put in front of the reader, in either tier.
 *
 * Several tests below are about ARRIVAL — the pipeline is not dead, the archive
 * is honoured, dedup fires the second time, length normalization changed WHICH
 * memory wins — and not about which tier the survivor arrived in. They asserted
 * `.surfaced`, which was indistinguishable from "it came back" for as long as
 * the loud tier fired on every turn with a candidate. It no longer does
 * (`tunables.ts#FLOOR_STRONG_DEFAULT_UNITS`), so the two claims have to be told
 * apart: arrival is asserted here, and the tests that are about the loud TIER
 * say so, in their own block at the end of this file.
 */
function delivered(d: { surfaced: readonly string[]; footnotes: readonly string[] }): string[] {
  return [...d.surfaced, ...d.footnotes];
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

/**
 * FIXTURE SCALE. These gate fixtures hand-build candidates with activations near
 * 1 against a nominal `storeSize: 100`, because they test the gate's LOGIC —
 * the hard gates' order, tier disjointness, the caps — not its calibration.
 *
 * The shipped absolute floors are in CUE UNITS (`gate.ts#floorUnit`), and at
 * `storeSize: 100` one unit is 3.92 in activation — so the shipped loud floor
 * would be 17.6 and every candidate below would be refused by hard gate (b)
 * before the rule under test was reached. The floors are therefore restated
 * here in the fixtures' own scale, exactly as `seams.test.ts` does. Multiplying
 * every fixture by 18 instead would have made the shipped LEVEL a hidden input
 * to tests that are not about the level; the tests that ARE about the level use
 * a real store and live in "the loud tier is rare, in miniature" below.
 */
const FIXTURE_FLOORS = {
  FLOOR_GLOBAL_UNITS: 0.5 / 3.92,
  FLOOR_STRONG_BY_KIND_UNITS: {},
  FLOOR_STRONG_DEFAULT_UNITS: 1.2 / 3.92,
};

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
    withTunables(FIXTURE_FLOORS),
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

  test("the FIRST memory is cueable: rarity is undefined at N=1, not zero", () => {
    // The whole-store rule above degenerates on a one-memory store, where every
    // token is in every memory by arithmetic rather than by being ubiquitous.
    // Read literally it made the first memory anyone writes permanently
    // uncueable — `log((1 + 1) / (2 * 1))` is `log(1)`, exactly zero, and
    // `buildCues` drops a zero-weight cue.
    expect(informativeness(1, 1)).toBeGreaterThan(0);
    // And an ABSENT token is still worth nothing at N=1: the fix restores the
    // weight of a match, it does not invent one.
    expect(informativeness(0, 1)).toBe(0);
    // A store of one is read as the smallest store where "spans everything"
    // means anything — and `MIN_RARITY_STORE` is that size, named rather than
    // a literal 2 sitting in an expression.
    expect(informativeness(1, 1)).toBe(informativeness(1, MIN_RARITY_STORE));
    expect(informativeness(1, 1)).toBeLessThanOrEqual(informativeness(1, 2));
  });

  test("nothing changes at N >= 2 — the fix cannot move a bench of 14,000", () => {
    // This is the regression proof for `docs/PARALLEL-RUN-STATUS.md` #28, in
    // code: the shipped function is compared against the pre-fix expression at
    // every scale that has ever been measured. Bit-identical, not "within
    // rounding".
    const before = (df: number, n: number): number =>
      df <= 0 || n <= 0 ? 0 : Math.max(0, Math.log((n + df) / (2 * df)));
    for (const n of [2, 3, 5, 17, 100, 312, 14_000, 15_421]) {
      for (const df of [1, 2, 3, 24, Math.floor(n / 2), n - 1, n]) {
        if (df < 1 || df > n) continue;
        expect(informativeness(df, n)).toBe(before(df, n));
      }
    }
    // …including the degenerate inputs the quiet-turn record leans on
    // (`recall/index.ts` denominates a no-candidate turn in `floorUnit(0)`).
    expect(informativeness(1, 0)).toBe(0);
    expect(informativeness(0, 0)).toBe(0);
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

  test("a store of ONE answers: the first memory is not invisible until a second arrives", () => {
    const s = store();
    const id = put(s, {
      kind: "skill",
      title: "Sourdough starter",
      body: "The sourdough starter died after two weeks of neglect and needs daily feeding.",
    });
    const r = new Recall({ store: s, owner: true });
    const out = r.recall({ sessionId: "s1", text: "what happened to my sourdough starter" });

    // Name the reason, not just the absence: before the fix this was
    // `no-candidates` with `candidates: 0` — the cue extractor never produced a
    // cue, so the index was never probed at all.
    expect(out.decision.candidates).toBeGreaterThan(0);
    expect(out.decision.storeSize).toBe(1);
    expect(delivered(out.decision)).toContain(id);
    // …and an unrelated turn is still quiet on the same one-memory store.
    const quiet = new Recall({ store: s, owner: true }).recall({
      sessionId: "s2",
      text: "qqqq wwww eeee rrrr",
    });
    expect(quiet.decision.reason).toBe("no-candidates");
  });

  test("on a store of one nothing goes LOUD — the rarity channel cannot discriminate", () => {
    // The cost of making the first memory cueable, and its bound. At N=1 every
    // token the memory holds is maximally rare (df = 1 = MIN_RARITY_STORE's
    // reading of the store), so a turn sharing only `the`/`that`/`and`/`not`
    // scores like a turn that is about it: MEASURED 2026-09-04, an ordinary
    // three-sentence note against five unrelated function-word turns reached
    // activation 1.82-2.24 against a loud floor of 4.5 x 0.4055 = 1.8246 and
    // went `surfaced` on all five. Cold start is STRICTER, not looser, so the
    // tier is capped at this size rather than the floor retuned.
    const s = store();
    const id = put(s, {
      body:
        "The parallel run started on the third and the first day of it was mostly about the hooks: " +
        "the Stop hook was not firing and that meant the notes that were written did not land. " +
        "The fix was small and the rest of the day was spent watching that it held.",
    });
    const turns = [
      "what is the plan for today and the rest of it",
      "that is not what I meant, and it is fine",
      "can you check the thing that was not done",
      "the meeting and the review are not on the calendar",
      "I think that the answer is not obvious",
    ];
    let turn = 0;
    for (const text of turns) {
      const out = new Recall({ store: s, owner: true }).recall({
        sessionId: `s${(turn += 1)}`,
        text,
      });
      const v = out.decision.verdicts.find((x) => x.id === id);
      // Warm, not loud — and the record NAMES why, rather than leaving a
      // reader to infer it from a number that did not fire.
      expect(v?.verdict).toBe("footnoted");
      expect(v?.loudBlockedBy).toBe("cold-start-undiscriminating");
      expect(out.decision.surfaced).toEqual([]);
    }

    // …and the cap is inert the moment a second memory exists: at N=2 the
    // ordinary floors are back in force and it is they that hold the tier.
    put(s, { body: "Bought hiking boots that finally fit properly and are not too stiff." });
    const after = new Recall({ store: s, owner: true }).recall({
      sessionId: "sN2",
      text: turns[0] as string,
    });
    expect(after.decision.verdicts.find((x) => x.id === id)?.loudBlockedBy).not.toBe(
      "cold-start-undiscriminating",
    );
  });

  test("N=2 and N=3: an unrelated arrival is what USED to make the first one findable", () => {
    // A REGRESSION GUARD, not a demonstration: these two sizes pass on pre-fix
    // code too — the bug was N=1 only, and that asymmetry is what named it.
    // They are here so a later change to the smoothing cannot buy N=1 back by
    // spending N=2 or N=3.
    // The bug's tell was that ANY second memory fixed it. Both directions are
    // asserted at each size: the older memory still answers its own question,
    // and a question that matches only the newest returns only the newest.
    const s = store();
    const first = put(s, {
      body: "The sourdough starter died after two weeks of neglect and needs daily feeding.",
    });
    const second = put(s, { body: "Bought hiking boots that finally fit properly." });
    // A session PER ASK, deliberately: gate state is persisted (NOTES §6), so
    // asking twice in one session would measure session dedup rather than
    // rarity, and a dedup-suppressed memory looks exactly like an uncued one
    // from the outside.
    let turn = 0;
    const ask = (text: string): string[] =>
      delivered(
        new Recall({ store: s, owner: true }).recall({ sessionId: `s${(turn += 1)}`, text }).decision,
      );

    expect(ask("what happened to my sourdough starter")).toContain(first);
    expect(ask("are the new hiking boots comfortable")).toContain(second);

    const third = put(s, { body: "The library closes early on Sundays now." });
    expect(ask("what happened to my sourdough starter")).toContain(first);
    expect(ask("when does the library close")).toContain(third);
  });

  test("a cued memory surfaces, and the decision record says how", () => {
    const s = store();
    seed(s);
    const id = put(s, {
      kind: "skill",
      title: "Sourdough starter",
      body: "The sourdough starter died after two weeks of neglect; a sourdough starter needs daily feeding.",
      salience: { relevance: 0.6, emotional: 0.2, predictive: 0.4 },
    });
    const r = new Recall({ store: s, owner: true });
    // The turn LEANS ON its cue, and that is why this one goes loud: the
    // loud-tier floor is 4.5 cue units, this turn reaches 4.83, and the same
    // memory under a single passing mention reaches 3.49 and footnotes. See
    // "the loud tier is rare, in miniature" at the end of this file for the
    // pair asserted side by side.
    const out = r.recall({
      sessionId: "s1",
      text: "my sourdough starter died, my sourdough starter, that poor sourdough starter",
    });

    expect(out.decision.reason).toBe("rendered");
    expect(verdictOf(out.decision.verdicts, id)).toBe("surfaced");
    expect(out.injection).toContain(FRAMING.surfacedHeader);
    // One cued candidate is not a distribution: the gate says so out loud rather
    // than comparing a candidate against a background made of itself.
    expect(out.decision.background.regime).toBe("absolute-thin-background");
    expect(out.decision.background.n).toBeLessThan(TUNABLES.MIN_BACKGROUND_SAMPLE);
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
    expect(delivered(out.decision)).toContain(cued);
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
    expect(verdictOf(b.decision.verdicts, id)).not.toBe("confidential-withheld");
    expect(delivered(b.decision)).toContain(id);
  });

  test("tiers are disjoint and capped, and the overflow says so", () => {
    const nouns =
      "alder birch cedar dogwood elm fir ginkgo hawthorn ironwood juniper".split(" ");
    const many = Array.from({ length: 10 }, (_, i) =>
      cand({ id: `mem_${i}`, cue: 2, body: `${nouns[i]} grove notes number ${nouns[i]}` }),
    );
    const g = gateOn(many);
    // ADJUSTED 2026-09-04: the caps are read from the tunables rather than
    // written down twice. `MAX_SURFACED` moved 2 -> 1 on measurement (the loud
    // lane fired on 13 of 13 real turns once length normalization removed the
    // hubs that were setting the variance), and a test that hardcodes a cap is
    // a test that fails for the calibration rather than for the property. The
    // PROPERTY here is disjointness and that the overflow is named, and both
    // are asserted against whatever the caps currently are.
    expect(g.surfaced.length).toBe(TUNABLES.MAX_SURFACED);
    expect(g.footnotes.length).toBe(TUNABLES.MAX_FOOTNOTES);
    const loud = new Set(g.surfaced.map((c) => c.id));
    for (const f of g.footnotes) expect(loud.has(f.id)).toBe(false);
    expect(g.verdicts.filter((v) => v.verdict === "capped").length).toBe(
      many.length - TUNABLES.MAX_SURFACED - TUNABLES.MAX_FOOTNOTES,
    );
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
    expect(delivered(first.decision)).toContain(id);
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
    expect(delivered(out.decision)).toContain(id);
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
    expect(delivered(r.recall({ sessionId: "a", text: "my sourdough starter died" }).decision)).toContain(id);

    s.archive(id, "test");
    const after = new Recall({ store: s, owner: true }).recall({
      sessionId: "b",
      text: "my sourdough starter died",
    });
    expect(verdictOf(after.decision.verdicts, id)).toBe("not-a-candidate");
    expect(after.decision.reason).toBe("no-candidates");
  });
});

// ── the document side of §9 G4: length normalization and the ceiling ────────

describe("cue length normalization", () => {
  /**
   * The bug this suite pins, measured 2026-09-04 on a copy of the live store:
   * nine memories of 9–20 KB against a ~1.1 KB median came back as footnotes
   * for every topic across two unrelated sessions, because the cue channel
   * scored a document by raw summed term frequency and the token index handed
   * back its top-`PER_CUE_FETCH` by the same number.
   */
  const PADDING =
    "Assorted unrelated filler about tooling, calendars, invoices, plumbing, " +
    "commuting, gardening, printers, receipts, upholstery and stationery. ";

  test("the store's default normalization IS the recall tunables' CAL values", () => {
    // Two homes, one number. `cache.ts` needs a default because `search()` has
    // callers that are not recall; `tunables.ts` is where the calibration claim
    // and its measurement live (scar §2.8). They may not drift apart silently.
    expect(DEFAULT_LENGTH_NORM).toEqual({
      k1: TUNABLES.CUE_TF_SATURATION,
      b: TUNABLES.CUE_LENGTH_NORM,
      oneSided: TUNABLES.CUE_LENGTH_ONE_SIDED,
    });
  });

  test("one-sided: a short document is never scored ABOVE what it scored before", () => {
    // The conservative half of the rule. The gate's absolute floors
    // (`FLOOR_GLOBAL_UNITS`, `FLOOR_STRONG_DEFAULT_UNITS`) are cue-unit bars a
    // candidate has to clear; BM25's mean-centered factor would raise short
    // documents through them, which is a calibration change nobody asked for.
    const s = store();
    seed(s);
    put(s, { body: "Zygomorphic." });
    put(s, { body: `Zygomorphic orchids. ${PADDING.repeat(8)}` });
    const flat = s.search("zygomorphic", 10, { k1: 1, b: 0 });
    const oneSided = s.search("zygomorphic", 10, { k1: 1, b: 0.5, oneSided: true });
    const twoSided = s.search("zygomorphic", 10, { k1: 1, b: 0.5 });
    const of = (hits: readonly { id: string; score: number }[], id: string): number =>
      hits.find((h) => h.id === id)?.score ?? 0;
    let sawShorterBoost = false;
    for (const h of flat) {
      expect(of(oneSided, h.id)).toBeLessThanOrEqual(h.score + 1e-12);
      if (of(twoSided, h.id) > h.score + 1e-9) sawShorterBoost = true;
    }
    // …and the clamp is not vacuous: two-sided really does raise a short one.
    expect(sawShorterBoost).toBe(true);
  });

  test("the same cue, once each: a long document does not out-score a short one", () => {
    const s = store();
    seed(s);
    const short = put(s, { body: "The zygomorphic orchid bloomed." });
    const long = put(s, { body: `The zygomorphic orchid bloomed. ${PADDING.repeat(40)}` });

    const hits = s.search("zygomorphic", 10);
    const scoreOf = (id: string): number => hits.find((h) => h.id === id)?.score ?? 0;
    // Both are found — normalization costs precision, never a hit.
    expect(scoreOf(short)).toBeGreaterThan(0);
    expect(scoreOf(long)).toBeGreaterThan(0);
    // And the short one wins, which is the whole rule: one mention of a rare
    // word in six tokens is better evidence than one in three thousand.
    expect(scoreOf(short)).toBeGreaterThan(scoreOf(long));
    // Without normalization the two are IDENTICAL — same tf — so the fetch
    // order was decided by whatever else the document happened to contain.
    const flat = s.search("zygomorphic", 10, { k1: 1, b: 0 });
    const flatOf = (id: string): number => flat.find((h) => h.id === id)?.score ?? 0;
    expect(flatOf(short)).toBeCloseTo(flatOf(long), 10);
  });

  test("equal DENSITY scores alike: the rule is proportionality, not a penalty on length", () => {
    const s = store();
    seed(s);
    // The long document mentions the cue proportionally more often, so its
    // evidence per token is the same. BM25's intent is exactly this — neither
    // document should win for its size alone — and "equal" is the wrong bar:
    // tf saturation deliberately keeps the longer one from scaling linearly.
    const short = put(s, { body: `The zygomorphic orchid bloomed. ${PADDING.repeat(2)}` });
    const long = put(s, {
      body: `${"The zygomorphic orchid bloomed. ".repeat(8)}${PADDING.repeat(16)}`,
    });
    const hits = s.search("zygomorphic", 10);
    const scoreOf = (id: string): number => hits.find((h) => h.id === id)?.score ?? 0;
    const ratio = scoreOf(long) / scoreOf(short);
    expect(ratio).toBeGreaterThan(0.5);
    expect(ratio).toBeLessThan(2);
  });

  test("the per-document ceiling: coverage cannot beat corroboration", () => {
    const s = store();
    seed(s);
    // A document that mentions EVERY cue once, and one that is about two of them.
    const cues = ["zygomorphic", "brachiate", "quillon", "tessellate", "vermiculate", "opsimath"];
    const hub = put(s, { body: `A catalogue: ${cues.join(", ")}. ${PADDING.repeat(4)}` });
    const focused = put(s, { body: "Notes on zygomorphic and brachiate forms, at length." });
    const text = cues.join(" ");
    const input = { text, day: 0, selfFelt: false, maxCandidates: 24, storeSize: 24 };

    const capped = activate(s, input, withTunables({ CUE_DOC_CAP: 2 }));
    const uncapped = activate(s, input, withTunables({ CUE_DOC_CAP: Infinity }));
    const cueOf = (r: typeof capped, id: string): number =>
      r.candidates.find((c) => c.id === id)?.cue ?? 0;

    // The ceiling binds the broad document and leaves the focused one alone.
    expect(capped.capped).toBeGreaterThan(0);
    expect(uncapped.capped).toBe(0);
    expect(cueOf(capped, hub)).toBeGreaterThan(0);
    expect(cueOf(capped, hub)).toBeLessThan(cueOf(uncapped, hub));
    expect(cueOf(capped, focused)).toBeCloseTo(cueOf(uncapped, focused), 10);
  });

  test("the ceiling alone is not the fix — it is the second half of the rule", () => {
    // Recorded because the sweep measured it: capping without normalizing made
    // the live failure WORSE (hub hits 31 -> 52), since compressing the top of
    // the distribution lowers the relative bar. This pins the arithmetic half:
    // at b = 0 the long document still out-scores the short one.
    const s = store();
    seed(s);
    const short = put(s, { body: "The zygomorphic orchid bloomed twice." });
    const long = put(s, {
      body: `${"The zygomorphic orchid bloomed twice. ".repeat(3)}${PADDING.repeat(40)}`,
    });
    const flat = s.search("zygomorphic", 10, { k1: 1, b: 0 });
    const flatOf = (id: string): number => flat.find((h) => h.id === id)?.score ?? 0;
    expect(flatOf(long)).toBeGreaterThan(flatOf(short));
    const normed = s.search("zygomorphic", 10);
    const normedOf = (id: string): number => normed.find((h) => h.id === id)?.score ?? 0;
    expect(normedOf(short)).toBeGreaterThan(normedOf(long));
  });

  test("a hub stops out-ranking an on-point memory end to end", () => {
    const s = store();
    seed(s);
    // The shape of the live failure in miniature: one long memory that mentions
    // a bit of everything, and one short memory that is actually about the turn.
    const hub = put(s, {
      body:
        `${"Digest entry: the zygomorphic orchid, again. ".repeat(3)}${PADDING.repeat(30)}`,
    });
    const onPoint = put(s, { body: "The zygomorphic orchid bloomed after the second frost." });
    const turn = "why did the zygomorphic orchid bloom";

    const before = new Recall({
      store: s,
      owner: true,
      tunables: { CUE_LENGTH_NORM: 0, CUE_DOC_CAP: Infinity },
    }).build({ sessionId: "before", text: turn });
    const after = new Recall({ store: s, owner: true }).build({ sessionId: "after", text: turn });

    // The verdict list is not a ranking (the gate groups it), so compare the
    // number the gate actually ranks on.
    const act = (d: typeof before.decision, id: string): number =>
      d.verdicts.find((v) => v.id === id)?.activation ?? 0;

    // Before: the hub wins on sheer repetition inside a 600-token body.
    expect(act(before.decision, hub)).toBeGreaterThan(act(before.decision, onPoint));
    expect(delivered(before.decision)).toContain(hub);
    // After: the short memory that is actually about the turn wins, and the hub
    // does not merely lose the top slot — it stops being delivered at all.
    expect(act(after.decision, onPoint)).toBeGreaterThan(act(after.decision, hub));
    expect(delivered(after.decision)).toContain(onPoint);
    expect(delivered(after.decision)).not.toContain(hub);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// The semantic channel takes a RANKING, not only a vector
// ═══════════════════════════════════════════════════════════════════════════
/**
 * The deviation this block exists to hold: `Turn.vector` was the only way in,
 * and ranking it means `store.nearestTo`, which reads and JSON-parses every row
 * in box 3 — measured at 590-1040 ms over 13,862 vectors. A synchronous pass
 * with a 1200 ms budget cannot pay that, so the ranking is done ONE TURN EARLIER
 * by the detached worker and crosses the lag as `{id, score}`.
 *
 * Which makes this the property worth mechanizing: supplied hits must reach the
 * activation pass WITHOUT the index being consulted at all.
 */
describe("supplied semantic hits bypass the vector scan entirely", () => {
  test("a store with NO vectors still lights a candidate the hits name", () => {
    const s = store();
    seed(s);
    const target = put(s, { body: "The kestrel hovered over the verge by the bypass." });
    // Box 3 holds no embeddings at all: `nearestTo` can only ever answer empty.
    expect(s.nearestTo([1, 0, 0], 8)).toEqual([]);

    const r = new Recall({ store: s, owner: true });
    const quiet = r.build({ sessionId: "s1", text: "Nothing here about that at all." });
    expect(quiet.decision.verdicts.map((v) => v.id)).not.toContain(target);
    expect(quiet.decision.semanticSource).toBe("none");

    const lit = r.build({
      sessionId: "s2",
      text: "Nothing here about that at all.",
      semanticHits: [{ id: target, score: 0.95 }],
      semanticSource: "lagged",
      semanticFromTurn: 3,
    });
    expect(lit.decision.semanticUsed).toBe(true);
    expect(lit.decision.semanticDegraded).toBe(false);
    expect(lit.decision.semanticSource).toBe("lagged");
    expect(lit.decision.semanticFromTurn).toBe(3);
    expect(lit.decision.verdicts.map((v) => v.id)).toContain(target);
  });

  test("hits below the seed floor score nothing, and an EMPTY list degrades", () => {
    const s = store();
    seed(s);
    const target = put(s, { body: "The kestrel hovered over the verge by the bypass." });
    const r = new Recall({ store: s, owner: true });

    const weak = r.build({
      sessionId: "s1",
      text: "Nothing here about that at all.",
      semanticHits: [{ id: target, score: 0.1 }],
      semanticSource: "lagged",
    });
    expect(weak.decision.semanticUsed).toBe(true);
    expect(weak.decision.verdicts.map((v) => v.id)).not.toContain(target);

    // "The worker embedded fine and nothing was near" is a DEGRADATION, and it
    // is recorded rather than looking identical to "nobody asked".
    const none = r.build({
      sessionId: "s2",
      text: "Nothing here about that at all.",
      semanticHits: [],
      semanticSource: "lagged",
    });
    expect(none.decision.semanticUsed).toBe(true);
    expect(none.decision.semanticDegraded).toBe(true);
  });

  test("a per-turn latency budget is honoured — the deliberate ask's one lever", () => {
    const s = store();
    seed(s);
    let clock = 0;
    // A clock that jumps past any ambient budget on its second read, so the
    // first checkpoint decides — with and without the override.
    const r = new Recall({
      store: s,
      owner: true,
      budgetMs: 10,
      now: () => {
        clock += 1;
        return clock === 1 ? 0 : 5_000;
      },
    });
    expect(r.build({ sessionId: "s1", text: "The reservoir loop before breakfast." }).decision.reason).toBe(
      "latency-abort",
    );
    clock = 0;
    expect(
      r.build({ sessionId: "s2", text: "The reservoir loop before breakfast.", budgetMs: 60_000 })
        .decision.reason,
    ).not.toBe("latency-abort");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// The loud tier is RARE, in miniature — and the floors mean the same thing at
// every store size
// ═══════════════════════════════════════════════════════════════════════════
/**
 * MEASURED on a copy of the live store (14,431 memories, 13 real prompts,
 * 2026-09-04): the loud tier fired on 13 of 13 turns, one item each, including
 * a turn that said *"thanks, as before interesting to chat with you. where
 * would you like to take the conversation from here?"* — where CONTRACT §3 says
 * loud is for RARELY. The relative bar could not fix it, and the reason is
 * worth keeping next to the fix: a thin turn's best candidate stands FURTHER
 * above its own thin background (3.5 sd) than a busy turn's does (2.6), so
 * raising the SNR silences the busy turn first.
 *
 * What fixed it is an absolute floor in the model's own unit — one
 * maximally-rare cue, `gate.ts#floorUnit` — and the point of the unit is that
 * one number does the same work on a seventeen-memory store as on a
 * fifteen-thousand-memory one. Both halves are asserted here: the SCALE-FREENESS
 * (the same multiples of the unit get the same verdicts at N=17 and N=15,000)
 * and the BEHAVIOUR (a cue-poor turn says nothing loud; a turn that leans on a
 * distinctive cue says exactly one thing; a small store still delivers).
 */
describe("the loud tier is rare, in miniature", () => {
  /** The shipped floors, against a store size the caller names. */
  function shippedGate(candidates: Candidate[], storeSize: number) {
    return gate(
      {
        candidates,
        state: freshGateState("unit"),
        storeSize,
        owner: true,
        affectStated: false,
        turn: 1,
      },
      TUNABLES,
    );
  }

  test("the floors are scale-free: the same multiples of the unit, the same verdicts", () => {
    // Two stores three orders of magnitude apart, candidates built at the SAME
    // multiples of each store's own cue unit. Before this change these two
    // columns disagreed completely — v2's floors were v1's numbers on v1's
    // scale, so at N=17 nothing could pass them and at N=15,000 nothing could
    // fail them (measured: scaling them x1 to x15 changed not one delivered
    // item on the bench).
    for (const storeSize of [17, 15_000]) {
      const unit = informativeness(1, storeSize);
      // Eight ordinary candidates make a real background, so the RELATIVE bar
      // is doing its own job and the two verdicts below are the FLOOR's.
      const g = shippedGate(
        [
          cand({ id: "mem_loud", cue: 5.0 * unit }),
          cand({ id: "mem_quiet", cue: 3.5 * unit }),
          cand({ id: "mem_graze", cue: 0.05 * unit }),
          ...Array.from({ length: 8 }, (_, i) => cand({ id: `mem_bg${i}`, cue: 0.5 * unit })),
        ],
        storeSize,
      );
      expect(verdictOf(g.verdicts, "mem_loud")).toBe("surfaced");
      expect(verdictOf(g.verdicts, "mem_quiet")).toBe("footnoted");
      expect(g.verdicts.find((v) => v.id === "mem_quiet")?.loudBlockedBy).toBe(
        "below-strong-floor",
      );
      // Hard gate (b) is no longer decorative: a graze is refused outright, and
      // the record names the rule that refused it.
      expect(verdictOf(g.verdicts, "mem_graze")).toBe("below-floor");
    }
  });

  test("a cue-poor turn surfaces NOTHING loud — the quiet-turn probe, in miniature", () => {
    const s = store();
    seed(s);
    put(s, {
      kind: "skill",
      body: "The sourdough starter died after two weeks of neglect; a sourdough starter needs daily feeding.",
    });
    const r = new Recall({ store: s, owner: true });
    // The shape of the live turn 3: ordinary words the store has seen
    // everywhere, and no distinctive vocabulary of its own.
    const out = r.recall({
      sessionId: "s1",
      text: "thanks, as before, interesting to chat — where would you like to take this from here?",
    });
    // The positive FIRST: this turn reached memories and still said nothing
    // loud. Asserting an empty loud tier alone would pass on an empty store,
    // and "the gate refused it" is not "the cue extractor never found it".
    expect(out.decision.reason).toBe("rendered");
    expect(delivered(out.decision).length).toBeGreaterThan(0);
    expect(out.decision.surfaced).toEqual([]);
    expect(out.injection).not.toContain(FRAMING.surfacedHeader);
  });

  test("a cue-rich turn with one strong candidate surfaces AT MOST one", () => {
    const s = store();
    seed(s);
    const strong = put(s, {
      kind: "skill",
      title: "Sourdough starter",
      body: "The sourdough starter died after two weeks of neglect; a sourdough starter needs daily feeding.",
    });
    // A second memory the turn grazes rather than cues — it shares "died" and
    // "neglect" and nothing distinctive.
    put(s, { body: "The tomato seedlings died after a week of neglect in the cold frame." });
    const r = new Recall({ store: s, owner: true });
    const out = r.recall({
      sessionId: "s1",
      text: "my sourdough starter died, my sourdough starter, that poor sourdough starter",
    });
    expect(out.decision.surfaced).toEqual([strong]);
    expect(out.decision.surfaced.length).toBeLessThanOrEqual(TUNABLES.MAX_SURFACED);
  });

  test("a single passing mention footnotes; leaning on the same cue goes loud", () => {
    const body =
      "The sourdough starter died after two weeks of neglect; a sourdough starter needs daily feeding.";
    const build = (where: string, text: string) => {
      const s = store({ dir: join(dir, where) });
      for (const filler of FILLER) s.put({ type: "memory", kind: "fact", body: filler });
      const id = s.put({ type: "memory", kind: "skill", title: "Sourdough starter", body });
      return { id, out: new Recall({ store: s, owner: true }).recall({ sessionId: where, text }) };
    };

    const glancing = build("glancing", "my sourdough starter died again");
    expect(verdictOf(glancing.out.decision.verdicts, glancing.id)).toBe("footnoted");
    expect(
      glancing.out.decision.verdicts.find((v) => v.id === glancing.id)?.loudBlockedBy,
    ).toBe("below-strong-floor");

    // The SAME memory in the SAME store shape, under a turn that LEANS ON the
    // cue instead of mentioning it: 3.49 cue units becomes 4.83, over a floor
    // of 4.5. That margin is the calibration, and this pair is its tripwire.
    const leaned = build(
      "leaned",
      "my sourdough starter died, my sourdough starter, that poor sourdough starter",
    );
    expect(verdictOf(leaned.out.decision.verdicts, leaned.id)).toBe("surfaced");
  });

  test("a small store still delivers — the floors are a bar, not a blindfold", () => {
    const s = store();
    seed(s);
    const id = put(s, {
      kind: "skill",
      body: "The zygomorphic orchid bloomed after the second frost.",
    });
    const out = new Recall({ store: s, owner: true }).recall({
      sessionId: "s1",
      text: "why did the zygomorphic orchid bloom",
    });
    expect(out.decision.reason).toBe("rendered");
    expect(delivered(out.decision)).toContain(id);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Rarity is COUNTED, not read off a bounded top-K
// ═══════════════════════════════════════════════════════════════════════════
/**
 * The measurement error that made the floors uncalibratable in the first place.
 * `activate.ts` took `df = store.search(tok, PER_CUE_FETCH).length`, and a
 * bounded top-K's length is `min(trueDf, K)` — so once a store held more than
 * `PER_CUE_FETCH` documents carrying a word, every common word measured as
 * equally rare. MEASURED on a 15,421-document index: `conversation` (df 574)
 * and `chat` (df 444) both drew `informativeness` 5.70 against a ceiling of
 * 8.95, where their true frequencies put them at 2.6 and 2.9.
 *
 * §3 G4's "informativeness weighting replaces stop-lists" was therefore true on
 * a fixture — where `trueDf` cannot reach `K` — and progressively false as the
 * store grew. That is why it was invisible to every hermetic test, and why the
 * test below builds a store big enough for the truncation to bite.
 */
describe("document frequency is counted (§9 G4 at scale)", () => {
  test("a word in more than PER_CUE_FETCH memories is not as rare as a word in one", () => {
    const s = store();
    const common = TUNABLES.PER_CUE_FETCH + 6;
    for (let i = 0; i < common; i++) {
      put(s, { body: `Ubiquitous appears here, note number ${i}, with padding words.` });
    }
    put(s, { body: "Zygomorphic appears in exactly one memory and nowhere else." });

    const n = s.list({ archived: false }).length;
    expect(s.docFrequency(["ubiquitous", "zygomorphic"]).get("ubiquitous")).toBe(common);
    expect(s.docFrequency(["ubiquitous", "zygomorphic"]).get("zygomorphic")).toBe(1);
    // The old reading, spelled out so the difference is visible rather than
    // argued: the top-K's LENGTH, which saturates at the limit.
    expect(s.search("ubiquitous", TUNABLES.PER_CUE_FETCH).length).toBe(TUNABLES.PER_CUE_FETCH);

    const rare = informativeness(1, n);
    const everywhere = informativeness(common, n);
    const truncated = informativeness(TUNABLES.PER_CUE_FETCH, n);
    expect(everywhere).toBeLessThan(rare / 2);
    // …and the truncated reading put the ubiquitous word nearer the rare one
    // than it belongs, which is the bug in one line.
    expect(truncated).toBeGreaterThan(everywhere);
  });

  test("the index is probed only for the tokens that became cues", () => {
    // Rarity first, postings second: nothing downstream reads a non-cue's
    // postings, so probing for all of them was work with no consumer. On the
    // live store this took a warm turn from 116-178 ms to 29-39 ms, which is
    // what paid for the df count.
    const s = store();
    seed(s);
    put(s, { body: "The zygomorphic orchid bloomed after the second frost." });
    let probes = 0;
    const search = s.search.bind(s);
    (s as unknown as { search: Store["search"] }).search = (cue, limit, norm) => {
      probes += 1;
      return search(cue, limit, norm);
    };
    const out = activate(
      s,
      {
        text: "why did the zygomorphic orchid bloom after the second frost this year",
        day: 0,
        selfFelt: false,
        maxCandidates: TUNABLES.MAX_CANDIDATES,
        storeSize: s.list({ archived: false }).length,
      },
      TUNABLES,
    );
    expect(probes).toBe(out.cues.length);
    expect(probes).toBeLessThanOrEqual(TUNABLES.MAX_CUES);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// I13 — the two denominators: `df` counted dead rows, `storeSize` counted live
// ═══════════════════════════════════════════════════════════════════════════
/**
 * `informativeness(df, storeSize)` reads two numbers that came from two boxes.
 * `storeSize` is `store.list({ archived: false }).length` (box 2, LIVE rows);
 * `df` was `COUNT(*)` over `doc_tokens` (box 3, EVERY row ever indexed). A row
 * that is archived or superseded leaves the first count and stayed in the
 * second, so `df > storeSize` was reachable — and at `df >= storeSize` the
 * smoothing returns exactly zero for that token, which is the re-zeroing NOTES
 * §12 named at N=1 arriving through a different door.
 *
 * The production caller is `revision.ts:385` — `store.supersede(...)` — which is
 * what a resolved `updates:` runs when it crosses a belief's bar or replaces a
 * "now" fact. `store.archive(...)` is the other producer (sleep's dedup and
 * consolidation).
 */
describe("I13 — document frequency counts LIVE rows", () => {
  test("a superseded head no longer counts toward df (the invariant, at N=1)", () => {
    const s = store();
    const first = put(s, { body: "The sourdough starter died after two weeks of neglect." });
    const successor = s.supersede(first, {
      type: "memory",
      kind: "fact",
      body: "The sourdough starter recovered after a week of daily feeding.",
    });

    const live = s.list({ archived: false });
    expect(live).toEqual([successor]);
    // The bug in one line: two indexed documents held `sourdough`, one live row
    // exists, and rarity is read against the live count.
    expect(s.docFrequency(["sourdough"]).get("sourdough")).toBe(1);
    expect(informativeness(1, live.length)).toBeGreaterThan(0);
  });

  test("an archived sibling no longer counts toward df", () => {
    const s = store();
    const kept = put(s, { body: "The zygomorphic orchid bloomed after the second frost." });
    const gone = put(s, { body: "The zygomorphic orchid was moved to the north window." });
    s.archive(gone, "duplicate");

    expect(s.list({ archived: false })).toEqual([kept]);
    expect(s.docFrequency(["zygomorphic"]).get("zygomorphic")).toBe(1);
  });

  test("df never exceeds storeSize, over a store that has archived and superseded", () => {
    const s = store();
    seed(s);
    const a = put(s, { body: "The zygomorphic orchid bloomed after the second frost." });
    const b = put(s, { body: "The zygomorphic orchid was moved to the north window." });
    s.supersede(a, {
      type: "memory",
      kind: "fact",
      body: "The zygomorphic orchid bloomed twice this year.",
    });
    s.archive(b, "duplicate");

    const storeSize = s.list({ archived: false }).length;
    const tokens = ["zygomorphic", "orchid", "the", "bloomed"];
    for (const [token, df] of s.docFrequency(tokens)) {
      expect({ token, withinStore: df <= storeSize }).toEqual({ token, withinStore: true });
    }
  });

  test("a dead row does not occupy a candidate slot in the index either", () => {
    // The second half of the same fact. `activate` already refuses an archived
    // or superseded hit — it counts them as `skipped` — but only AFTER the index
    // has spent `PER_CUE_FETCH` slots on them, so the candidate SET was narrowed
    // by rows that could never be delivered. Same shape as the length-norm bug
    // the CONTRACT describes: re-ranking a wrong set is not choosing a right one.
    const s = store();
    const first = put(s, { body: "The sourdough starter died after two weeks of neglect." });
    const successor = s.supersede(first, {
      type: "memory",
      kind: "fact",
      body: "The sourdough starter recovered after a week of daily feeding.",
    });
    expect(s.search("sourdough", 10).map((h) => h.id)).toEqual([successor]);
  });

  test("the CORE door: revising the first memory in a fresh store keeps it findable", () => {
    // The reported symptom, at the core door. Before the fix this answered with
    // no cues at all: `df(sourdough) = 2` against `storeSize = 1` gives
    // `log((2 + 2) / (2 * 2)) = 0`, `buildCues` drops every zero-weight cue, and
    // the index is never probed.
    const s = store();
    const first = put(s, { body: "The sourdough starter died after two weeks of neglect." });
    const successor = s.supersede(first, {
      type: "memory",
      kind: "fact",
      body: "The sourdough starter recovered after a week of daily feeding.",
    });

    const out = new Recall({ store: s, owner: true }).recall({
      sessionId: "s1",
      text: "what happened to my sourdough starter",
    });
    expect(out.decision.storeSize).toBe(1);
    expect(out.decision.cueCount).toBeGreaterThan(0);
    expect(out.decision.reason).toBe("rendered");
    expect(delivered(out.decision)).toContain(successor);
  });

  test("the CORE door: an archived sibling does not blind the live memory", () => {
    const s = store();
    const kept = put(s, { body: "The zygomorphic orchid bloomed after the second frost." });
    const gone = put(s, { body: "The zygomorphic orchid was moved to the north window." });
    s.archive(gone, "duplicate");

    const out = new Recall({ store: s, owner: true }).recall({
      sessionId: "s1",
      text: "why did the zygomorphic orchid bloom",
    });
    expect(out.decision.storeSize).toBe(1);
    expect(out.decision.reason).toBe("rendered");
    expect(delivered(out.decision)).toContain(kept);
  });

  test("rebuildCache does not put the dead rows back", () => {
    // `verify --rebuild` is a supported operation, and a rebuild that re-indexed
    // archived rows would buy the bug back on the owner's next repair.
    const s = store();
    const first = put(s, { body: "The sourdough starter died after two weeks of neglect." });
    const successor = s.supersede(first, {
      type: "memory",
      kind: "fact",
      body: "The sourdough starter recovered after a week of daily feeding.",
    });
    const report = s.rebuildCache();
    expect(report.indexed).toBe(1);
    expect(s.docFrequency(["sourdough"]).get("sourdough")).toBe(1);
    expect(s.search("sourdough", 10).map((h) => h.id)).toEqual([successor]);
  });
});
