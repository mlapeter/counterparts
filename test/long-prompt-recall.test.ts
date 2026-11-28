/**
 * LONG-PROMPT RECALL, characterized (2026-11-28, stage 1 of the long-prompt lane:
 * diagnosis only). Through the real door — `Counterpart#recallForTurn`, what the
 * UserPromptSubmit hook calls — on a temp store of made-up memories.
 *
 * The case: a prompt whose request sits in its last lines, after ~6,000 chars of
 * made-up policy boilerplate (the shape of a long typed or pasted prompt; on the
 * owner's real use most long prompts are peer messages, framed by the host).
 * Today the memory the request names is not even a CANDIDATE: the
 * token loop in `recall/activate.ts#activate` stops at `MAX_CUES * 3` distinct
 * tokens, document frequency is asked only for those, and `buildCues` drops a
 * word with no df, so no word after the window's end can be a cue. The same
 * request alone reaches it.
 *
 * No embedder here, so this pins the cue channel only; the semantic channel's
 * head clip (`session.ts#IN_LINE_TEXT_CHARS`, 2,000 chars) is not exercised.
 * The `test.failing` is stage 2's target: when a fix lands it passes, bun
 * reports it, and it becomes a plain test.
 *
 * Hermetic: a fresh temp dir per test, removed after; an unnamed store refuses.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Counterpart } from "../src/core/counterpart.js";
import type { RecallDecision } from "../src/core/recall/index.js";
import { TUNABLES as RECALL } from "../src/core/recall/index.js";
import { findable } from "./store-fixture.js";

const ENV = "COUNTERPARTS_DATA_DIR";
const EXPLICIT = "COUNTERPARTS_REQUIRE_EXPLICIT_DIR";
let dir: string;
let priorEnv: string | undefined;
let priorExplicit: string | undefined;
let cp: Counterpart | null = null;

beforeEach(() => {
  priorEnv = process.env[ENV];
  priorExplicit = process.env[EXPLICIT];
  dir = mkdtempSync(join(tmpdir(), "counterparts-longprompt-"));
  process.env[ENV] = dir;
  process.env[EXPLICIT] = "1";
});

afterEach(() => {
  cp?.close();
  cp = null;
  if (priorEnv === undefined) delete process.env[ENV];
  else process.env[ENV] = priorEnv;
  if (priorExplicit === undefined) delete process.env[EXPLICIT];
  else process.env[EXPLICIT] = priorExplicit;
  rmSync(dir, { recursive: true, force: true });
});

const FILLER = [
  "The garage door opener needs a new battery soon.",
  "The library closes early on Sundays now.",
  "The kitchen tap drips when the pressure is high.",
  "The bus route changed and adds ten minutes.",
  "Fixed the wobbling chair leg with a shim.",
  "The printer jams on heavy paper stock.",
  "Booked the dentist for a routine cleaning.",
  "The heating engineer comes on Thursday morning.",
  "Every contractor signs the vendor compliance attestation before onboarding.",
  "Quarterly retention reviews archive inactive procurement records.",
];
const TARGET = "The lighthouse tide almanac for Port Marrow lives in the cobalt binder on the chartroom shelf.";
const REQUEST = "Where is the lighthouse tide almanac for Port Marrow kept?";

/** Made-up policy boilerplate: varied wording, so its distinct words fill the token window. */
const CLAUSES = [
  "Contractors must complete the vendor compliance attestation before onboarding begins.",
  "Procurement records older than eighteen months are archived after quarterly retention review.",
  "Escalations follow the documented severity matrix and require written acknowledgement within business hours.",
  "Personnel handling confidential material complete annual awareness training and sign the acceptable usage statement.",
  "Expense submissions require itemised receipts, approver signatures and a matching purchase order reference.",
  "Facilities requests are triaged weekly by the operations steering committee according to budget availability.",
  "Remote workstations must run current endpoint protection, encrypted storage and automatic patch scheduling.",
  "Incident postmortems remain blameless, capture contributing factors and list remediation owners with target dates.",
  "Supplier invoices outside agreed payment terms are flagged for treasury reconciliation and dispute handling.",
  "Records management guidance supersedes departmental conventions wherever the two conflict materially.",
  "Travel bookings route through the preferred agency unless an exemption is recorded beforehand.",
  "Accessibility reviews accompany every customer-facing publication prior to distribution.",
];
function boilerplate(chars: number): string {
  const out: string[] = [];
  let n = 0;
  for (let i = 0; out.join("\n").length < chars; i++) {
    n += 1;
    out.push(`Section ${n}. ${CLAUSES[i % CLAUSES.length]}`);
  }
  return out.join("\n");
}
const LONG_PROMPT = `${boilerplate(6000)}\n\nWith all of that in mind, one question.\n${REQUEST}`;

function world(): { target: string } {
  cp = Counterpart.open({ dir });
  findable(cp.store);
  cp.store.advanceClock("2026-08-01");
  for (const body of FILLER) cp.store.put({ type: "memory", kind: "fact", body });
  return { target: cp.store.put({ type: "memory", kind: "fact", body: TARGET }) };
}

let n = 0;
function turn(text: string): RecallDecision {
  n += 1;
  return cp!.recallForTurn({ sessionId: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`, text }).decision;
}
const candidates = (d: RecallDecision): string[] => d.verdicts.map((v) => v.id);

describe("a long prompt whose request is at its end", () => {
  test("the fixture is what it claims: ~6,000 chars before the request, which is past the token window", () => {
    expect(LONG_PROMPT.length).toBeGreaterThan(6000);
    expect(LONG_PROMPT.indexOf(REQUEST)).toBeGreaterThan(6000);
    // The boilerplate alone holds more distinct 4+ char words than the window takes.
    const distinct = new Set(boilerplate(6000).toLowerCase().match(/[a-z0-9]+/g)!.filter((w) => w.length >= RECALL.MIN_CUE_LENGTH));
    expect(distinct.size).toBeGreaterThan(RECALL.MAX_CUES * 3);
  });

  test("the request alone reaches the target memory (control)", () => {
    const { target } = world();
    const d = turn(REQUEST);
    expect(candidates(d)).toContain(target);
    expect([...d.surfaced, ...d.footnotes]).toContain(target);
  });

  test("the same request at the HEAD of the same long prompt reaches it (position, not length)", () => {
    const { target } = world();
    expect(candidates(turn(`${REQUEST}\n\n${boilerplate(6000)}`))).toContain(target);
  });

  test("today: behind the boilerplate, the target is not a candidate at all", () => {
    const { target } = world();
    const d = turn(LONG_PROMPT);
    expect(candidates(d)).not.toContain(target);
    expect([...d.surfaced, ...d.footnotes]).not.toContain(target);
  });

  test.failing("stage 2's target: behind the boilerplate, the target is still a candidate", () => {
    const { target } = world();
    expect(candidates(turn(LONG_PROMPT))).toContain(target);
  });
});
