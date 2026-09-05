/**
 * remember/ — the authorship pipeline's mechanics.
 *
 * Hermetic by construction (CLAUDE.md): a fresh temp data dir in `beforeEach`,
 * removed — and ONLY it — in `afterEach`. Nothing here can reach a real store, and
 * the guard that makes that structural is tested below.
 *
 * Every [M] guarantee in `src/core/remember/CONTRACT.md` §5 has at least one test
 * here, and assertions name the REASON (`CaptureReason`, `SubmitReason`,
 * `UpdatesReason`, `ChunkReason`), never just "it worked".
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import {
  appendFileSync,
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { DATA_DIR_ENV } from "../src/core/store/paths.js";
import { isStoreError } from "../src/core/store/errors.js";
import { hashText } from "../src/core/store/prose.js";
// The buffer's destruction seam, imported ON PURPOSE — holding a `SpanBuffer`
// does not reach it (`remember/owner-strike-seam.ts`, the WeakMap grant).
import { strikeSpans } from "../src/core/remember/owner-strike-seam.js";
import {
  ALREADY_AUTHORED_MARK,
  BOUNDARY_KINDS,
  NO_GATE,
  SpanBuffer,
  TUNABLES,
  WRITE_SITES,
  chunkSpans,
  enters,
  intake,
  keyFor,
  markCovered,
  renderForSweep,
  resolveUpdates,
  similarity,
  submitProposal,
  sweep,
  sweepAll,
  validateWatchdog,
} from "../src/core/remember/index.js";
import type {
  BufferOptions,
  Candidate,
  Claim,
  GateFn,
  GateInput,
  InterpretResult,
  Span,
  SweepChunk,
  Turn,
  UpdatesContext,
} from "../src/core/remember/index.js";

const REMEMBER_SRC = fileURLToPath(new URL("../src/core/remember/", import.meta.url));
const SCOPE = "/Users/test/project-one";
const OTHER = "/Users/test/project-two";

let dir: string;
let priorEnv: string | undefined;
/** Paths this test chmod'ed, restored in afterEach so the temp dir can be removed. */
const relaxed: string[] = [];

/**
 * THE TEST CLOCK, as an OFFSET on the real one. Every buffer this suite builds
 * reads it, because the crash fallback's eligibility is a fact about TIME: a
 * session is crashed when it has gone silent past `CRASH_STALE_MS` with no
 * `session-end` boundary. Making a session go quiet is the honest fixture for a
 * crash — the alternative, setting the window to zero, deletes the gate the
 * fixture is supposed to exercise.
 *
 * An OFFSET rather than a frozen instant because the orphan-merge path compares
 * this clock against a claim file's real `mtime`: a frozen clock set before the
 * file existed makes every orphan look like the future and never merge.
 */
let offsetMs = 0;

function testNow(): number {
  return Date.now() + offsetMs;
}

function buf(opts: Partial<BufferOptions> = {}): SpanBuffer {
  return new SpanBuffer({ dir, minClaimBytes: 0, staleClaimMs: 0, day: () => 3, now: testNow, ...opts });
}

/** The session stopped and nobody ever came back: this host's only crash signal. */
function goQuiet(): void {
  offsetMs += TUNABLES.CRASH_STALE_MS + 60_000;
}

function u(text: string): Turn {
  return { role: "user", text };
}

function a(text: string): Turn {
  return { role: "assistant", text };
}

/** ~60 bytes each, so byte-threshold tests are about the threshold, not the fixture. */
function long(tag: string): string {
  return `${tag}: a real stretch of conversation with enough words to matter here`;
}

function scopeFile(scope: string, name: string): string {
  return join(dir, "spans", keyFor(scope), name);
}

function harden(path: string): void {
  chmodSync(path, 0o400);
  relaxed.push(path);
}

function hardenDir(path: string): void {
  chmodSync(path, 0o500);
  relaxed.push(path);
}

const pass: GateFn = (input) => ({ ok: true, content: input.content });
const refuse: GateFn = () => ({ ok: false, gate: "secrets", reason: "CREDENTIAL_SHAPED" });
const explode: GateFn = () => {
  throw new Error("gate blew up");
};

function recorder(): { seen: GateInput[]; gate: GateFn } {
  const seen: GateInput[] = [];
  return { seen, gate: (input) => (seen.push(input), { ok: true, content: input.content }) };
}

/** A span that never entered a buffer — enough to reach a seam that takes one. */
function fakeSpan(): Span {
  return {
    hash: "h0",
    session: "s1",
    scope: SCOPE,
    kind: "conversation",
    text: "x",
    at: 0,
    day: 3,
    from: 0,
    to: 1,
  };
}

/** A claim() outcome, unwrapped — every call site here expects one. */
function claimed(buffer: SpanBuffer, scope = SCOPE, opts?: { minBytes?: number }): Claim {
  const out = buffer.claim(scope, opts ?? {});
  if (!out.claimed) throw new Error(`expected a claim, got ${out.reason}`);
  return out.claim;
}

beforeEach(() => {
  offsetMs = 0;
  priorEnv = process.env[DATA_DIR_ENV];
  dir = mkdtempSync(join(tmpdir(), "counterparts-"));
  process.env[DATA_DIR_ENV] = dir;
});

afterEach(() => {
  for (const path of relaxed.splice(0)) {
    try {
      chmodSync(path, 0o700);
    } catch {
      /* already gone */
    }
  }
  rmSync(dir, { recursive: true, force: true });
  if (priorEnv === undefined) delete process.env[DATA_DIR_ENV];
  else process.env[DATA_DIR_ENV] = priorEnv;
});

// ── capture: the appender ────────────────────────────────────────────────────

describe("capture (G1, G2, G3)", () => {
  test("a boundary appends ONE span of the turns since the cursor, then advances", () => {
    const b = buf();
    const r = b.capture({ session: "s1", scope: SCOPE, turns: [u("alpha"), u("beta")] });
    expect({ captured: r.captured, reason: r.reason, spans: r.spans.length, to: r.cursorAfter }).toEqual(
      { captured: true, reason: "APPENDED", spans: 1, to: 2 },
    );
    expect(b.spans(SCOPE).map((s) => s.text)).toEqual(["alpha\n\nbeta"]);
    expect(b.cursor(SCOPE, "s1")).toBe(2);
    expect(b.spans(SCOPE)[0]?.day).toBe(3);
  });

  test("capture is SYNCHRONOUS and the module has no model call in it (G1)", () => {
    const r: unknown = buf().capture({ session: "s1", scope: SCOPE, turns: [u("hi")] });
    expect(typeof (r as { then?: unknown }).then).toBe("undefined");

    const src = readFileSync(join(REMEMBER_SRC, "spans.ts"), "utf8");
    for (const forbidden of ["fetch(", "https://", "anthropic", "openai", "child_process", "async capture"]) {
      expect({ forbidden, found: src.includes(forbidden) }).toEqual({ forbidden, found: false });
    }
  });

  test("the cursor slices a GROWING transcript — layer 1 (G3, G9 case 1)", () => {
    const b = buf();
    const all = [u("t0"), u("t1"), u("t2"), u("t3")];
    b.capture({ session: "s1", scope: SCOPE, turns: all.slice(0, 2) });
    const r = b.capture({ session: "s1", scope: SCOPE, turns: all });
    expect(r.spans.map((s) => s.text)).toEqual(["t2\n\nt3"]);
    expect(b.spans(SCOPE).map((s) => s.text)).toEqual(["t0\n\nt1", "t2\n\nt3"]);
  });

  test("the content hash catches an EXACT repeat a fresh cursor would miss — layer 2 (G3, G9 case 2)", () => {
    const b = buf();
    b.capture({ session: "s1", scope: SCOPE, turns: [u("the same words exactly")] });
    const r = b.capture({ session: "s2", scope: SCOPE, turns: [u("the same words exactly")] });
    expect({ reason: r.reason, deduped: r.deduped, captured: r.captured }).toEqual({
      reason: "DEDUPED",
      deduped: 1,
      captured: false,
    });
    expect(b.spans(SCOPE).length).toBe(1);
    expect(b.cursor(SCOPE, "s2")).toBe(1);
  });

  test("a SUPERSET re-read under a fresh cursor duplicates — bounded, and that is the spec (G9 case 3)", () => {
    // v1's hypothesis, carried into v2 as a test to write, not as an assumption:
    // a superset slice hashes differently, so hash dedup cannot see it. Bounded
    // duplication is an acceptable failure; loss is not.
    const b = buf();
    b.capture({ session: "s1", scope: SCOPE, turns: [u("a"), u("b")] });
    const r = b.capture({ session: "s2", scope: SCOPE, turns: [u("a"), u("b"), u("c")] });
    expect({ captured: r.captured, deduped: r.deduped }).toEqual({ captured: true, deduped: 0 });
    expect(b.spans(SCOPE).map((s) => s.text)).toEqual(["a\n\nb", "a\n\nb\n\nc"]);
  });

  test("read positions are per-session and disjoint (spec §2 G4)", () => {
    const b = buf();
    b.capture({ session: "s1", scope: SCOPE, turns: [u("one"), u("two")] });
    b.capture({ session: "s2", scope: SCOPE, turns: [u("other")] });
    expect({ s1: b.cursor(SCOPE, "s1"), s2: b.cursor(SCOPE, "s2"), s3: b.cursor(SCOPE, "s3") }).toEqual({
      s1: 2,
      s2: 1,
      s3: 0,
    });
  });

  test("one session id under TWO scopes captures in BOTH — the cursor is scoped (PR-1 review blocker 2)", () => {
    // 11 real-corpus session ids appear under more than one scope. With a
    // session-only cursor, scope B read scope A's advance as NOTHING_NEW and
    // its spans silently never entered the buffer.
    const b = buf();
    const r1 = b.capture({ session: "s1", scope: SCOPE, turns: [u(long("in scope one"))] });
    const r2 = b.capture({ session: "s1", scope: OTHER, turns: [u(long("in scope two"))] });
    expect({ one: r1.reason, two: r2.reason }).toEqual({ one: "APPENDED", two: "APPENDED" });
    expect({ one: b.spans(SCOPE).length, two: b.spans(OTHER).length }).toEqual({ one: 1, two: 1 });
    expect({ one: b.cursor(SCOPE, "s1"), two: b.cursor(OTHER, "s1") }).toEqual({ one: 1, two: 1 });
  });

  test("the assistant's turns are kept SEPARATELY and are never in the sweep's input", () => {
    const b = buf();
    const r = b.capture({ session: "s1", scope: SCOPE, turns: [u("hi"), a("hello back")] });
    expect(r.spans.map((s) => s.kind).sort()).toEqual(["assistant", "conversation"]);
    expect(b.spans(SCOPE).map((s) => s.text)).toEqual(["hi"]);
    expect(b.assistantSpans(SCOPE).map((s) => s.text)).toEqual(["hello back"]);
  });

  test("conversational text only: tool/file/image never enter, injected context does (G10/G11)", () => {
    const b = buf();
    const r = b.capture({
      session: "s1",
      scope: SCOPE,
      turns: [
        { role: "user", text: "TOOL RESULT blob", source: "tool" },
        { role: "user", text: "FILE contents", source: "file" },
        { role: "user", text: "IMAGE", source: "image" },
        { role: "user", text: "what I actually said", source: "conversation" },
        { role: "user", text: "host-injected context", source: "injected" },
      ],
    });
    expect({ excluded: r.excluded, text: r.spans[0]?.text }).toEqual({
      excluded: 3,
      text: "what I actually said\n\nhost-injected context",
    });
  });

  test("FOREIGN material — another memory system's injection — never enters (parallel-run G8)", () => {
    // The failure this forbids: while v2 runs beside v1, v1's own wake bundle
    // lands in the same transcript. It is user-role and it reads like prose, so
    // without this rule v2 would encode v1's briefing as a memory of having
    // thought it — two memory systems feeding each other.
    const b = buf();
    const r = b.capture({
      session: "s1",
      scope: SCOPE,
      turns: [
        { role: "user", text: "[bansai] recall: three memories bear on this turn", source: "foreign" },
        { role: "user", text: "what I actually said", source: "conversation" },
        { role: "user", text: "host-injected context", source: "injected" },
      ],
    });
    expect({ excluded: r.excluded, text: r.spans[0]?.text }).toEqual({
      excluded: 1,
      text: "what I actually said\n\nhost-injected context",
    });
    // `injected` is kept and merely unpaced; `foreign` is refused outright.
    expect(enters({ role: "user", text: "x", source: "foreign" })).toBe(false);
    expect(enters({ role: "user", text: "x", source: "injected" })).toBe(true);
    expect(enters({ role: "user", text: "x", source: "conversation" })).toBe(true);
    expect(enters({ role: "user", text: "x" })).toBe(true);
    // And `ritual` — THIS system's own ask, read back off a host that returns
    // hook output into the context — is refused for the mirror-image reason:
    // encoding it would make the ask's wording a memory of having thought it.
    expect(enters({ role: "user", text: "x", source: "ritual" })).toBe(false);
  });

  test("ritual text is refused and COUNTED — the ask does not become its own memory", () => {
    const b = buf();
    const r = b.capture({
      session: "s1",
      scope: SCOPE,
      turns: [
        { role: "user", text: "Stop hook feedback:\n- what did you LEARN here?", source: "ritual" },
        { role: "user", text: "what I actually said", source: "conversation" },
      ],
    });
    // The exclusion is a NUMBER, not an absence: a boundary that captured
    // nothing because everything was ritual must be distinguishable from a
    // boundary where nothing happened.
    expect({ excluded: r.excluded, text: r.spans[0]?.text }).toEqual({
      excluded: 1,
      text: "what I actually said",
    });
  });

  test("a boundary with nothing conversational still advances (ALL_EXCLUDED)", () => {
    const b = buf();
    const r = b.capture({
      session: "s1",
      scope: SCOPE,
      turns: [{ role: "user", text: "tool blob", source: "tool" }],
    });
    expect({ reason: r.reason, cursor: b.cursor(SCOPE, "s1"), spans: b.spans(SCOPE).length }).toEqual({
      reason: "ALL_EXCLUDED",
      cursor: 1,
      spans: 0,
    });
  });

  test("nothing new is its own reason, not a failure", () => {
    const b = buf();
    b.capture({ session: "s1", scope: SCOPE, turns: [u("only")] });
    expect(b.capture({ session: "s1", scope: SCOPE, turns: [u("only")] }).reason).toBe("NOTHING_NEW");
  });

  test("capture never throws into the host, and a failed append leaves the cursor put (G2, G3)", () => {
    const b = buf();
    b.capture({ session: "s1", scope: SCOPE, turns: [u("first")] });
    harden(scopeFile(SCOPE, "buffer.jsonl"));

    const r = b.capture({ session: "s1", scope: SCOPE, turns: [u("first"), u("second")] });
    expect({ reason: r.reason, captured: r.captured }).toEqual({ reason: "IO_FAILED", captured: false });
    expect(b.cursor(SCOPE, "s1")).toBe(1);
    expect(b.events("remember.write.failed")[0]?.data?.site).toBe("capture");

    // Advance-after-success means the retry re-reads the same turns and lands.
    chmodSync(scopeFile(SCOPE, "buffer.jsonl"), 0o600);
    const retry = b.capture({ session: "s1", scope: SCOPE, turns: [u("first"), u("second")] });
    expect({ reason: retry.reason, cursor: b.cursor(SCOPE, "s1") }).toEqual({ reason: "APPENDED", cursor: 2 });
    expect(b.spans(SCOPE).map((s) => s.text)).toEqual(["first", "second"]);
  });

  test("a jot rides in the buffer with everything else, deduped by content", () => {
    const b = buf();
    const r = b.jot({ session: "s1", scope: SCOPE, text: "remember this bit" });
    expect({ reason: r.reason, kind: r.spans[0]?.kind }).toEqual({ reason: "APPENDED", kind: "jot" });
    expect(b.jot({ session: "s1", scope: SCOPE, text: "remember this bit" }).reason).toBe("DEDUPED");
    expect(b.spans(SCOPE).length).toBe(1);
  });
});

// ── boundaries + the ask ─────────────────────────────────────────────────────

describe("boundaries (G11 mechanized half, G12)", () => {
  test("all three session-ending paths are boundaries and all three raise the ask", () => {
    const b = buf();
    for (const kind of BOUNDARY_KINDS) {
      const rec = b.boundary({ session: `s-${kind}`, scope: SCOPE, kind });
      expect({ kind: rec.kind, ask: rec.askRaised }).toEqual({ kind, ask: true });
    }
    expect(b.boundaries(SCOPE).map((r) => r.kind)).toEqual([...BOUNDARY_KINDS]);
    // All three ended; only two can ever be CRASHED. A `session-end` boundary is
    // the author reaching the host's own end-of-session path, and a session that
    // got the pen is never read by the fallback (owner ruling 2026-09-04).
    expect([...b.crashedSessions(SCOPE)]).toEqual([]);
    goQuiet();
    expect([...b.crashedSessions(SCOPE)].sort()).toEqual(["s-pre-compaction", "s-stop"]);
  });

  test("the unaskable stretch is bounded and measured, not assumed (G12)", () => {
    let clock = 1000;
    const b = buf({ now: () => (clock += 10) });
    b.capture({ session: "s1", scope: SCOPE, turns: [u(long("one"))] });
    b.boundary({ session: "s1", scope: SCOPE, kind: "session-end" });
    b.capture({ session: "s1", scope: SCOPE, turns: [u(long("one")), u(long("after"))] });

    const report = b.coverageReport(SCOPE);
    expect({ spans: report.spans, uncovered: report.uncovered, tail: report.unaskableSpans }).toEqual({
      spans: 2,
      uncovered: 2,
      tail: 1,
    });
    expect(report.unaskableBytes).toBe(long("after").length);
    expect(b.events("remember.coverage.measured")[0]?.data?.unaskableSpans).toBe(1);
  });
});

// ── observer mode ───────────────────────────────────────────────────────────

describe("observer (G8)", () => {
  test("an observer session captures nothing, asks for nothing, writes nothing", async () => {
    const o = buf({ observer: true });
    expect(o.capture({ session: "s1", scope: SCOPE, turns: [u("lived")] }).reason).toBe("OBSERVER");
    expect(o.jot({ session: "s1", scope: SCOPE, text: "jot" }).reason).toBe("OBSERVER");
    expect(o.boundary({ session: "s1", scope: SCOPE, kind: "session-end" }).askRaised).toBe(false);
    expect(o.claim(SCOPE)).toEqual({ claimed: false, reason: "OBSERVER", bytes: 0 });
    expect(o.claimCoverage({ scope: SCOPE, session: "s1", proposalId: "prp_x" })).toEqual([]);

    const fake: Claim = { id: "clm_x", scope: SCOPE, path: join(dir, "nope"), spans: [], bytes: 0, mergedOrphans: [] };
    expect(o.consume(fake).reason).toBe("OBSERVER");
    expect(o.restore(fake).reason).toBe("OBSERVER");
    expect(o.recordProposal(SCOPE, { id: "prp_x" })).toBe(false);
    expect((await submitProposal(o, { content: long("x") }, { session: "s1", scope: SCOPE, source: "session-end", gate: pass })).reason).toBe("OBSERVER");
    expect((await sweep(o, { scope: SCOPE, interpret: async () => ({ proposals: [] }) })).reason).toBe("OBSERVER");

    // Not one byte: an instrument leaves the store as it found it.
    expect(existsSync(join(dir, "spans"))).toBe(false);
  });

  test("every stand-down site is enumerated and every one of them emits (totality)", async () => {
    const o = buf({ observer: true });
    o.capture({ session: "s1", scope: SCOPE, turns: [u("x")] });
    o.jot({ session: "s1", scope: SCOPE, text: "x" });
    o.boundary({ session: "s1", scope: SCOPE, kind: "stop" });
    o.claim(SCOPE);
    o.claimCoverage({ scope: SCOPE, session: "s1", proposalId: "prp_x" });
    o.recordProposal(SCOPE, {});
    const fake: Claim = { id: "clm_x", scope: SCOPE, path: join(dir, "nope"), spans: [], bytes: 0, mergedOrphans: [] };
    o.consume(fake);
    o.restore(fake);
    o.noteFailures(SCOPE, [fakeSpan()], "THREW");
    strikeSpans(o, { scope: SCOPE, hashes: ["deadbeef"] });
    await sweep(o, { scope: SCOPE, interpret: async () => ({ proposals: [] }) });

    const sites = new Set(o.events("remember.observer.standdown").map((e) => String(e.data?.site)));
    expect([...sites].sort()).toEqual([...WRITE_SITES].sort());
  });
});

// ── the strike (the owner's destruction seam) ───────────────────────────────

describe("strikeSpans — the buffer's half of the destruction path", () => {
  const DOOMED = "ZQSTRIKE the culvert gate key is under the third fence post at Kestrel Barn.";
  const KEEPER = "ZQKEEP the north gate padlock key hangs in the tack room, on the left.";

  /** The raw bytes of one stream, so "gone" is a fact about the file. */
  function raw(scope: string, name: string): string {
    const file = scopeFile(scope, name);
    return existsSync(file) ? readFileSync(file, "utf8") : "";
  }

  test("it rewrites the jots file WITHOUT the struck line, and leaves every other line whole", () => {
    const b = buf();
    const doomed = b.jot({ session: "s1", scope: SCOPE, text: DOOMED }).spans[0];
    b.jot({ session: "s1", scope: SCOPE, text: KEEPER });
    b.capture({ session: "s1", scope: SCOPE, turns: [u(long("conversation"))] });
    expect(doomed).toBeDefined();

    const report = strikeSpans(b, { scope: SCOPE, hashes: [doomed?.hash ?? ""] });
    expect(report.reason).toBe("STRUCK");
    expect(report.struck).toBe(1);
    expect(report.files.map((f) => f.file.split("/")[1])).toEqual(["jots.jsonl"]);

    expect(raw(SCOPE, "jots.jsonl")).not.toContain("ZQSTRIKE");
    expect(raw(SCOPE, "jots.jsonl")).toContain("ZQKEEP");
    expect(raw(SCOPE, "buffer.jsonl")).toContain("conversation");
    // And through the buffer's own eyes: one jot left, still readable as JSON.
    expect(b.spans(SCOPE).filter((s) => s.kind === "jot").map((s) => s.text)).toEqual([KEEPER]);
  });

  test("the hash is ledgered FIRST, so nothing can re-admit the span", () => {
    const b = buf();
    const doomed = b.jot({ session: "s1", scope: SCOPE, text: DOOMED }).spans[0];
    strikeSpans(b, { scope: SCOPE, hashes: [doomed?.hash ?? ""] });

    // Layer 2 of dedup now holds it — which is what makes the three re-entry
    // paths (re-capture, restore, orphan merge) all refuse it.
    expect(b.seenHashes(SCOPE).has(doomed?.hash ?? "")).toBe(true);
    expect(raw(SCOPE, "consumed.jsonl")).not.toContain("culvert gate key");

    // 1. A RE-CAPTURE of the identical words dedups away instead of landing.
    const again = b.jot({ session: "s2", scope: SCOPE, text: DOOMED });
    expect(again.reason).toBe("DEDUPED");
    expect(raw(SCOPE, "jots.jsonl")).not.toContain("ZQSTRIKE");

    // 2. A RESTORE of a claim still holding it in memory puts it nowhere.
    const claim = {
      id: "clm_zombie",
      scope: SCOPE,
      path: join(dir, "spans", keyFor(SCOPE), "claims", "clm_zombie.jsonl"),
      spans: [doomed as Span],
      bytes: DOOMED.length,
      mergedOrphans: [],
    };
    expect(b.restore(claim).spans).toBe(0);
    expect(raw(SCOPE, "jots.jsonl")).not.toContain("ZQSTRIKE");
  });

  test("the SWEEP cannot re-mint a struck span: it is not in the buffer and not offered", async () => {
    const b = buf();
    const doomed = b.jot({ session: "s1", scope: SCOPE, text: DOOMED }).spans[0];
    b.capture({ session: "s1", scope: SCOPE, turns: [u(long("something else entirely"))] });
    b.boundary({ session: "s1", scope: SCOPE, kind: "stop" });
    strikeSpans(b, { scope: SCOPE, hashes: [doomed?.hash ?? ""] });
    goQuiet();

    const shown: string[] = [];
    const out = await sweep(b, {
      scope: SCOPE,
      interpret: async (chunk) => {
        shown.push(chunk.prompt);
        return { proposals: [] };
      },
    });
    expect(out.reason).not.toBe("IO_FAILED");
    // The model never saw the words, so it cannot propose them back.
    expect(shown.join("\n")).not.toContain("culvert gate key");
    expect(shown.join("\n")).toContain("something else entirely");
  });

  test("it strikes a CLAIM file too — a worker mid-arc is holding the words on disk", () => {
    const b = buf({ minClaimBytes: 0 });
    b.jot({ session: "s1", scope: SCOPE, text: DOOMED });
    b.jot({ session: "s1", scope: SCOPE, text: KEEPER });
    const claimed = b.claim(SCOPE);
    expect(claimed.claimed).toBe(true);
    if (!claimed.claimed) return;
    expect(readFileSync(claimed.claim.path, "utf8")).toContain("ZQSTRIKE");

    const doomed = claimed.claim.spans.find((s) => s.text === DOOMED);
    const report = strikeSpans(b, { scope: SCOPE, hashes: [doomed?.hash ?? ""] });
    expect(report.touchedClaim).toBe(true);
    expect(readFileSync(claimed.claim.path, "utf8")).not.toContain("ZQSTRIKE");
    expect(readFileSync(claimed.claim.path, "utf8")).toContain("ZQKEEP");
  });

  test("the QUARANTINE file is chased as well — a span the sweep gave up on is still text on disk", () => {
    const b = buf({ maxSpanFailures: 1 });
    const doomed = b.jot({ session: "s1", scope: SCOPE, text: DOOMED }).spans[0];
    const out = b.noteFailures(SCOPE, [doomed as Span], "THREW");
    expect(out.quarantined.length).toBe(1);
    expect(raw(SCOPE, "quarantine.jsonl")).toContain("ZQSTRIKE");

    strikeSpans(b, { scope: SCOPE, hashes: [doomed?.hash ?? ""] });
    expect(raw(SCOPE, "quarantine.jsonl")).not.toContain("ZQSTRIKE");
  });

  test("a PREDICATE is the fallback when no hash was ever recorded, and it strikes across scopes", () => {
    const b = buf();
    b.jot({ session: "s1", scope: SCOPE, text: DOOMED });
    b.jot({ session: "s1", scope: OTHER, text: DOOMED });
    b.jot({ session: "s1", scope: OTHER, text: KEEPER });

    const report = strikeSpans(b, { scope: null, predicate: (t) => t.includes("ZQSTRIKE") });
    expect(report.struck).toBe(2);
    expect(report.scopes).toBe(2);
    expect(raw(SCOPE, "jots.jsonl")).not.toContain("ZQSTRIKE");
    expect(raw(OTHER, "jots.jsonl")).not.toContain("ZQSTRIKE");
    expect(raw(OTHER, "jots.jsonl")).toContain("ZQKEEP");
  });

  test("a jot appended DURING the strike survives it — the aside is the reason", () => {
    // The race the choreography exists for: `mutate()` is a stance check and a
    // try/catch, not a lock. The strike renames the live file aside, so an
    // append racing it lands in a FRESH file at the same path. Simulated here by
    // appending through the buffer's own door while the aside is on disk.
    const b = buf();
    const doomed = b.jot({ session: "s1", scope: SCOPE, text: DOOMED }).spans[0];
    const file = scopeFile(SCOPE, "jots.jsonl");
    const aside = `${file}.striking`;
    // Stage exactly what a crash between the rename and the append-back leaves.
    renameSync(file, aside);
    b.jot({ session: "s2", scope: SCOPE, text: KEEPER });

    const report = strikeSpans(b, { scope: SCOPE, hashes: [doomed?.hash ?? ""] });
    expect(report.struck).toBe(1);
    expect(existsSync(aside)).toBe(false);
    const left = raw(SCOPE, "jots.jsonl");
    expect(left).not.toContain("ZQSTRIKE");
    expect(left).toContain("ZQKEEP");
  });

  test("nothing to strike is NOTHING, not a rewrite: an untouched scope keeps its bytes", () => {
    const b = buf();
    b.jot({ session: "s1", scope: SCOPE, text: KEEPER });
    const before = raw(SCOPE, "jots.jsonl");
    const report = strikeSpans(b, { scope: SCOPE, hashes: ["not-a-hash-in-this-store"] });
    expect(report.reason).toBe("NOTHING");
    expect(report.struck).toBe(0);
    expect(raw(SCOPE, "jots.jsonl")).toBe(before);
    expect(existsSync(scopeFile(SCOPE, "strikes.jsonl"))).toBe(false);
  });

  test("an instrument refuses to strike, and leaves the words exactly where they were", () => {
    const b = buf();
    const doomed = b.jot({ session: "s1", scope: SCOPE, text: DOOMED }).spans[0];
    const before = raw(SCOPE, "jots.jsonl");

    const o = buf({ observer: true });
    const report = strikeSpans(o, { scope: SCOPE, hashes: [doomed?.hash ?? ""] });
    expect(report.reason).toBe("OBSERVER");
    expect(report.struck).toBe(0);
    expect(raw(SCOPE, "jots.jsonl")).toBe(before);
    expect(o.events("remember.observer.standdown").some((e) => e.data?.site === "strike")).toBe(true);
  });

  test("holding a SpanBuffer does not reach the strike — the grant is the capability", () => {
    // The whole point of the seam: an object shaped like a buffer, that never
    // ran the constructor's `grantSpanStrike`, cannot be struck through.
    expect(() => strikeSpans({}, { scope: SCOPE, hashes: ["x"] })).toThrow("SPAN_STRIKE_UNGRANTED");
  });

  test("the durable record is counts and a day — never a hash, never a word", () => {
    const b = buf();
    const doomed = b.jot({ session: "s1", scope: SCOPE, text: DOOMED }).spans[0];
    strikeSpans(b, { scope: SCOPE, hashes: [doomed?.hash ?? ""] });

    const lines = readFileSync(scopeFile(SCOPE, "strikes.jsonl"), "utf8")
      .split("\n")
      .filter((l) => l.trim().length > 0)
      .map((l) => JSON.parse(l) as Record<string, unknown>);
    expect(lines.length).toBe(1);
    expect(lines[0]).toEqual({ at: expect.any(Number), day: 3, by: "owner", files: 1, struck: 1, ledgered: 1 });
    const text = JSON.stringify(lines[0]);
    expect(text).not.toContain(doomed?.hash ?? "");
    expect(text).not.toContain("culvert");
  });
});

// ── claim / consume / restore ───────────────────────────────────────────────

describe("claim choreography (G3, G4)", () => {
  test("the buffer is renamed ASIDE, so a concurrent append cannot be destroyed by the claim", () => {
    const b = buf();
    b.capture({ session: "s1", scope: SCOPE, turns: [u(long("lived"))] });
    const claim = claimed(b);
    expect(b.spans(SCOPE)).toEqual([]);

    // ... a boundary firing while the arc runs lands in a FRESH buffer file:
    b.capture({ session: "s2", scope: SCOPE, turns: [u(long("concurrent"))] });
    expect(b.spans(SCOPE).length).toBe(1);

    expect(b.consume(claim).reason).toBe("CONSUMED");
    expect(b.spans(SCOPE).map((s) => s.text)).toEqual([long("concurrent")]);
    expect(existsSync(claim.path)).toBe(false);
  });

  test("below the minimum claim size nothing runs — the scraps RIDE, they do not drop (spec §2 G8)", () => {
    const b = buf({ minClaimBytes: 200 });
    b.capture({ session: "s1", scope: SCOPE, turns: [u("tiny")] });
    const out = b.claim(SCOPE);
    expect(out).toEqual({ claimed: false, reason: "BELOW_MIN_CLAIM", bytes: 4 });
    expect(b.spans(SCOPE).map((s) => s.text)).toEqual(["tiny"]);
    expect(b.events("remember.claim.refused")[0]?.data?.reason).toBe("BELOW_MIN_CLAIM");
  });

  test("an empty buffer is EMPTY, not a failure", () => {
    expect(buf().claim(SCOPE)).toEqual({ claimed: false, reason: "EMPTY", bytes: 0 });
  });

  test("consuming records the hashes first, so the same content dedups afterwards", () => {
    const b = buf();
    b.capture({ session: "s1", scope: SCOPE, turns: [u(long("consumed"))] });
    b.consume(claimed(b));
    const again = b.capture({ session: "s9", scope: SCOPE, turns: [u(long("consumed"))] });
    expect({ reason: again.reason, deduped: again.deduped }).toEqual({ reason: "DEDUPED", deduped: 1 });
    expect(b.spans(SCOPE)).toEqual([]);
  });

  test("a failed restore FORBIDS consuming the claim (spec §2 G7)", () => {
    const b = buf();
    b.capture({ session: "s1", scope: SCOPE, turns: [u(long("at risk"))] });
    const claim = claimed(b);
    hardenDir(join(dir, "spans", keyFor(SCOPE)));

    const out = b.restore(claim);
    expect({ restored: out.restored, reason: out.reason }).toEqual({ restored: false, reason: "IO_FAILED" });
    // Still in claim-or-buffer: the claim file is kept, so nothing is in neither place.
    expect(existsSync(claim.path)).toBe(true);
    expect(b.events("remember.claim.restore.failed").length).toBe(1);
  });

  test("the arc commits its output or restores its input, and empty is not failed (G4)", async () => {
    const b = buf();
    b.capture({ session: "s1", scope: SCOPE, turns: [u(long("arc"))] });
    const committed: string[] = [];
    const ok = await b.arc(
      claimed(b),
      async (spans) => spans.map((s) => s.hash),
      (hashes) => {
        committed.push(...hashes);
      },
    );
    expect({ ok: ok.ok, committed: committed.length, left: b.spans(SCOPE).length }).toEqual({
      ok: true,
      committed: 1,
      left: 0,
    });
    expect(b.events("remember.arc.done").length).toBe(1);
    expect(b.events("remember.arc.failed").length).toBe(0);
  });

  test("a throw mid-arc means the arc is RETRIED, not lost", async () => {
    const b = buf();
    b.capture({ session: "s1", scope: SCOPE, turns: [u(long("outage"))] });
    const claim = claimed(b);
    const out = await b.arc(
      claim,
      async () => {
        throw new Error("the model went away");
      },
      () => undefined,
    );
    expect(out).toEqual({ ok: false, reason: "RESTORED", code: "Error" });
    expect(b.spans(SCOPE).map((s) => s.text)).toEqual([long("outage")]);
    expect(existsSync(claim.path)).toBe(false);
    expect(b.events("remember.arc.failed")[0]?.data?.restored).toBe(true);
    // And the retry claims it again — nothing was lost.
    expect(claimed(b).spans.length).toBe(1);
  });

  test("a consumer KILLED mid-arc leaves its input claimable (scar E6)", () => {
    const b = buf();
    b.capture({ session: "s1", scope: SCOPE, turns: [u(long("killed")), u(long("mid-arc"))] });
    const before = b.spans(SCOPE).map((s) => s.hash);
    expect(before.length).toBe(1);

    const modUrl = pathToFileURL(join(REMEMBER_SRC, "index.ts")).href;
    const script = `
      import(${JSON.stringify(modUrl)}).then((m) => {
        const b = new m.SpanBuffer({ dir: ${JSON.stringify(dir)}, minClaimBytes: 0, staleClaimMs: 0 });
        const out = b.claim(${JSON.stringify(SCOPE)});
        if (!out.claimed) process.exit(3);
        // Dies holding the claim: no restore runs, no consume runs, no marker.
        process.kill(process.pid, "SIGKILL");
      });
    `;
    const child = spawnSync(process.execPath, ["-e", script], {
      env: { ...process.env, [DATA_DIR_ENV]: dir },
      encoding: "utf8",
    });
    expect(child.signal).toBe("SIGKILL");
    expect(b.spans(SCOPE)).toEqual([]); // the buffer really was claimed away

    // The next claim past the staleness window merges the crashed run's leftovers.
    const recovered = claimed(b);
    expect(recovered.spans.map((s) => s.hash)).toEqual(before);
    expect(recovered.mergedOrphans.length).toBe(1);
    expect(b.events("remember.claim.orphan.merged").length).toBe(1);
  });

  test("a crash mid-claim leaves an ORDINARY orphan — every span stays in claim-or-buffer", () => {
    // The window the SIGKILL test cannot reach: a death between renaming the jots
    // aside and folding them into the claim. The leftover must stay discoverable
    // as an ordinary orphan, or those spans are in neither claim nor buffer.
    const b = buf();
    const jot = b.jot({ session: "s1", scope: SCOPE, text: long("jotted then crashed") });
    const line = readFileSync(scopeFile(SCOPE, "jots.jsonl"), "utf8");
    rmSync(scopeFile(SCOPE, "jots.jsonl"));
    mkdirSync(join(dir, "spans", keyFor(SCOPE), "claims"), { recursive: true });
    writeFileSync(join(dir, "spans", keyFor(SCOPE), "claims", "clm_dead.jots.jsonl"), line, "utf8");

    const recovered = claimed(b);
    expect(recovered.spans.map((s) => s.hash)).toEqual([jot.spans[0]?.hash ?? "missing"]);
    expect(recovered.mergedOrphans.length).toBe(1);
  });

  test("an orphan merge dedups against the consumed ledger (the consume/rm crash window)", () => {
    const b = buf();
    b.capture({ session: "s1", scope: SCOPE, turns: [u(long("already applied"))] });
    const claim = claimed(b);
    // Simulate a crash between "hashes recorded" and "claim file removed": record
    // the hashes, leave the file. The next claim must NOT re-sweep the spans.
    b.consume({ ...claim, path: join(dir, "spans", keyFor(SCOPE), "claims", "gone.jsonl") });
    expect(existsSync(claim.path)).toBe(true);

    const out = b.claim(SCOPE);
    expect(out).toEqual({ claimed: false, reason: "EMPTY", bytes: 0 });
  });
});

// ── proposal intake ─────────────────────────────────────────────────────────

describe("proposals (G5, G6, G7, §4.1 G8/G9)", () => {
  const ctx = (over: Record<string, unknown> = {}) => ({
    session: "s1",
    scope: SCOPE,
    source: "session-end" as const,
    gate: pass,
    ...over,
  });

  test("the ENGINE claims coverage by hash; the author never can (G5)", async () => {
    const b = buf();
    b.capture({ session: "s1", scope: SCOPE, turns: [u(long("what happened"))] });
    const hashes = b.spans(SCOPE).map((s) => s.hash);

    const res = await submitProposal(
      b,
      { content: "I got the retry logic right and it felt like relief.", claimed: 0.8, covers: ["forged"] },
      ctx(),
    );
    expect({ accepted: res.accepted, reason: res.reason }).toEqual({ accepted: true, reason: "ACCEPTED" });
    expect(res.proposal?.covers).toEqual(hashes);
    expect(res.droppedFields).toEqual(["covers"]);
    expect(b.coveredHashes(SCOPE)).toEqual(new Set(hashes));
    expect(res.proposal?.salience.claimed).toBe(0.8);
  });

  test("novelty is COMPUTED, never claimed — an authored novelty is stripped even with no vector source (§2.9)", async () => {
    // The PR-3 review's regression: with no vector source wired — the DEFAULT
    // config — the gate's verdict carries no novelty, and relying on override
    // alone let a claimed 0.99 survive to the stored row, feeding salience and
    // banding (F5 through a new door). The strip must be explicit.
    const b = buf();
    b.capture({ session: "s1", scope: SCOPE, turns: [u(long("a quiet afternoon"))] });
    const res = await submitProposal(
      b,
      {
        content: "The retry logic finally landed, and the afternoon stayed quiet.",
        salience: { novelty: 0.99, relevance: 0.4, emotional: 0.3, predictive: 0.3 },
        claimed: 0.5,
      },
      ctx(),
    );
    expect({ accepted: res.accepted, reason: res.reason }).toEqual({ accepted: true, reason: "ACCEPTED" });
    // Null — "never asked" — not the author's 0.99, and not undefined either:
    // the omitted-vs-null distinction is the gate's to make, not the author's.
    expect(res.proposal?.salience.novelty ?? null).toBeNull();
    // The three authored dimensions survive untouched.
    expect(res.proposal?.salience.relevance).toBe(0.4);
  });

  test("a REJECTED proposal claims no coverage — its spans stay in the sweep's input (G6)", async () => {
    const b = buf();
    b.capture({ session: "s1", scope: SCOPE, turns: [u(long("still unauthored"))] });
    const res = await submitProposal(b, { content: long("secret-ish") }, ctx({ gate: refuse }));
    expect({ accepted: res.accepted, reason: res.reason, gate: res.gate, coverage: res.coverage.length }).toEqual(
      { accepted: false, reason: "GATE_REJECTED", gate: "secrets", coverage: 0 },
    );
    expect(b.coveredHashes(SCOPE).size).toBe(0);
  });

  test("a gate that THROWS fails toward not-authoring, and claims nothing", async () => {
    const b = buf();
    b.capture({ session: "s1", scope: SCOPE, turns: [u(long("unauthored"))] });
    const res = await submitProposal(b, { content: long("something") }, ctx({ gate: explode }));
    expect({ reason: res.reason, coverage: res.coverage.length }).toEqual({ reason: "GATE_FAILED", coverage: 0 });
    expect(b.coveredHashes(SCOPE).size).toBe(0);
  });

  test("no injected gate means REFUSE, never 'everything passes'", async () => {
    const b = buf();
    const res = await submitProposal(b, { content: long("ungated") }, { session: "s1", scope: SCOPE, source: "session-end" });
    expect({ reason: res.reason, gate: res.gate }).toEqual({ reason: "GATE_REJECTED", gate: "none" });
    expect(NO_GATE({} as GateInput)).toEqual({ ok: false, gate: "none", reason: "NO_GATE_INJECTED" });
  });

  test("a malformed proposal degrades to an ordinary span, with its reason (§4.1 G8)", async () => {
    const b = buf();
    const res = await submitProposal(b, { content: "the words I actually wrote", claimed: "very high" }, ctx());
    expect({ reason: res.reason, malformed: res.malformed, degraded: res.degradedToSpan }).toEqual({
      reason: "MALFORMED",
      malformed: "CLAIMED_NOT_NUMERIC",
      degraded: true,
    });
    expect(b.spans(SCOPE).map((s) => s.text)).toEqual(["the words I actually wrote"]);
  });

  test("every malformed shape names its own reason", () => {
    const reasons = [
      [null, "NOT_AN_OBJECT"],
      [{}, "CONTENT_MISSING"],
      [{ content: "   " }, "CONTENT_EMPTY"],
      [{ content: "x", claimed: 4 }, "CLAIMED_OUT_OF_RANGE"],
      [{ content: "x", kind: "vibe" }, "KIND_UNKNOWN"],
      [{ content: "x", title: 7 }, "TITLE_NOT_STRING"],
      [{ content: "x", updates: 12 }, "UPDATES_NOT_STRING"],
      [{ content: "x", aliases: [3] }, "ALIASES_NOT_STRINGS"],
      [{ content: "x", feeling: { feeling: "", quote: "q", subject: "self" } }, "FEELING_MALFORMED"],
    ] as const;
    for (const [raw, reason] of reasons) {
      const r = intake(raw);
      expect({ raw: JSON.stringify(raw), ok: r.ok, reason: r.ok ? null : r.reason }).toEqual({
        raw: JSON.stringify(raw),
        ok: false,
        reason,
      });
    }
    expect(intake({ content: "fine", kind: "person", unresolved: true }).ok).toBe(true);
  });

  test("privilege caps are structural: an operation has nowhere to land (§4.1 G7)", async () => {
    const b = buf();
    b.capture({ session: "s1", scope: SCOPE, turns: [u(long("privileged"))] });
    const res = await submitProposal(
      b,
      { content: long("I learned something"), protect: true, promote: "identity", "schema.create": { name: "x" } },
      ctx(),
    );
    expect(res.droppedFields.sort()).toEqual(["promote", "protect", "schema.create"]);
    expect(Object.keys(res.proposal ?? {})).not.toContain("protect");
  });

  test("deliberate deposits are idempotent by CONTENT, not by span text (§4.1 G9)", async () => {
    const b = buf();
    b.capture({ session: "s1", scope: SCOPE, turns: [u(long("first stretch"))] });
    const first = await submitProposal(b, { content: "The same lesson, learned once." }, ctx());
    expect(first.accepted).toBe(true);

    // New spans, so the SPAN hashes differ — only content dedup can catch this.
    b.capture({ session: "s1", scope: SCOPE, turns: [u(long("first stretch")), u(long("second stretch"))] });
    const second = await submitProposal(b, { content: "  the same LESSON,  learned once.  " }, ctx());
    expect({ reason: second.reason, coverage: second.coverage.length }).toEqual({
      reason: "DUPLICATE_CONTENT",
      coverage: 0,
    });
    expect(b.coveredHashes(SCOPE).size).toBe(1);
  });

  test("successive proposals PARTITION a session instead of each claiming the backlog (§4.1 G4)", async () => {
    const b = buf();
    b.capture({ session: "s1", scope: SCOPE, turns: [u(long("part one"))] });
    const p1 = await submitProposal(b, { content: "Lesson one, written down." }, ctx());
    b.capture({ session: "s1", scope: SCOPE, turns: [u(long("part one")), u(long("part two"))] });
    const p2 = await submitProposal(b, { content: "Lesson two, written down." }, ctx());

    expect(p1.proposal?.covers.length).toBe(1);
    expect(p2.proposal?.covers.length).toBe(1);
    expect(p1.proposal?.covers[0]).not.toBe(p2.proposal?.covers[0]);
  });

  test("coverage marks are prompt-side only — no gate can be loosened by a mark (G7)", async () => {
    const b = buf();
    const jot = b.jot({ session: "s1", scope: SCOPE, text: long("the jotted moment") });
    const seen = recorder();
    await submitProposal(
      b,
      { content: "A thing worth keeping from the moment." },
      ctx({ gate: seen.gate, ownSpanHash: jot.spans[0]?.hash }),
    );

    const gateInput = seen.seen[0];
    expect(gateInput?.content.includes(ALREADY_AUTHORED_MARK)).toBe(false);
    expect(gateInput?.span?.text.includes(ALREADY_AUTHORED_MARK)).toBe(false);

    const spans = b.spans(SCOPE);
    const marked = markCovered(spans, b.coveredHashes(SCOPE));
    expect(marked[0]?.mark).toBe(ALREADY_AUTHORED_MARK);
    expect(marked[0]?.span.text.includes(ALREADY_AUTHORED_MARK)).toBe(false);
    expect(renderForSweep(marked)).toContain(ALREADY_AUTHORED_MARK);
  });
});

// ── updates: resolution ─────────────────────────────────────────────────────

describe("updates: resolution (G10)", () => {
  const CONTENT = "the deploy script needs a retry on flaky network calls";
  const NEAR: Candidate = { id: "mem_near", text: "deploy script needs retry on flaky network calls" };
  const FAR: Candidate = { id: "mem_far", text: "the coffee grinder broke this morning" };

  const logged: { name: string; data: Record<string, string | number | boolean | null> }[] = [];
  const ctx = (over: Partial<UpdatesContext> = {}): UpdatesContext => ({
    scope: SCOPE,
    content: CONTENT,
    resolveId: () => null,
    candidates: () => [],
    onEvent: (name, data) => {
      logged.push({ name, data });
    },
    ...over,
  });

  beforeEach(() => {
    logged.length = 0;
  });

  test("no declaration is not a failure", async () => {
    const r = await resolveUpdates(null, ctx());
    expect({ method: r.method, reason: r.reason, resolved: r.resolved }).toEqual({
      method: "none",
      reason: "NO_DECLARATION",
      resolved: null,
    });
  });

  test("a declared id that RESOLVES is honored, forwarding included", async () => {
    const r = await resolveUpdates("mem_old", ctx({ resolveId: (id) => (id === "mem_old" ? "mem_head" : null) }));
    expect({ method: r.method, reason: r.reason, resolved: r.resolved, score: r.score }).toEqual({
      method: "declared",
      reason: "DECLARED_RESOLVED",
      resolved: "mem_head",
      score: null,
    });
  });

  test("a miss falls back to content matching, and logs method/score/margin", async () => {
    const r = await resolveUpdates("mem_confabulated", ctx({ candidates: () => [NEAR, FAR] }));
    expect({ method: r.method, reason: r.reason, resolved: r.resolved }).toEqual({
      method: "content",
      reason: "MATCHED",
      resolved: "mem_near",
    });
    expect(r.score).toBeGreaterThan(TUNABLES.UPDATES_FLOOR);
    expect(r.margin).toBeGreaterThanOrEqual(TUNABLES.UPDATES_MARGIN);
    expect(logged[0]?.data).toMatchObject({ method: "content", reason: "MATCHED", declared: "mem_confabulated" });
    expect(typeof logged[0]?.data.score).toBe("number");
  });

  test("below the floor it REFUSES — and the hint is powerless there", async () => {
    // The declared id is literally one of the candidates' ids. It still cannot
    // attach the memory to a weak match: a hint may break a tie, never rescue.
    const r = await resolveUpdates("mem_far", ctx({ candidates: () => [FAR] }));
    expect({ reason: r.reason, resolved: r.resolved, hintUsed: r.hintUsed, method: r.method }).toEqual({
      reason: "BELOW_FLOOR",
      resolved: null,
      hintUsed: false,
      method: "content",
    });
  });

  test("ambiguity REFUSES (scar §2.5: a plausible id in the wrong section)", async () => {
    const twin: Candidate = { id: "mem_twin", text: NEAR.text };
    const r = await resolveUpdates("mem_nowhere", ctx({ candidates: () => [NEAR, twin] }));
    expect({ reason: r.reason, resolved: r.resolved, hintUsed: r.hintUsed }).toEqual({
      reason: "AMBIGUOUS",
      resolved: null,
      hintUsed: false,
    });
    expect(r.margin).toBe(0);
  });

  test("the hint is a TIEBREAK inside the margin", async () => {
    const twin: Candidate = { id: "mem_twin", text: NEAR.text };
    const r = await resolveUpdates("mem_twin", ctx({ candidates: () => [NEAR, twin] }));
    expect({ method: r.method, reason: r.reason, resolved: r.resolved, hintUsed: r.hintUsed }).toEqual({
      method: "content+hint",
      reason: "MATCHED",
      resolved: "mem_twin",
      hintUsed: true,
    });
  });

  test("a hint naming BOTH tied candidates stays ambiguous", async () => {
    const one: Candidate = { id: "mem_one", text: `${NEAR.text} see mem_ref`, aliases: ["mem_ref"] };
    const two: Candidate = { id: "mem_two", text: `${NEAR.text} see mem_ref` };
    const r = await resolveUpdates("mem_ref", ctx({ candidates: () => [one, two] }));
    expect({ reason: r.reason, resolved: r.resolved }).toEqual({ reason: "AMBIGUOUS", resolved: null });
  });

  test("no candidates at all is its own reason", async () => {
    const r = await resolveUpdates("mem_x", ctx());
    expect({ reason: r.reason, resolved: r.resolved }).toEqual({ reason: "NO_CANDIDATES", resolved: null });
  });

  test("a refusal costs nothing durable: the memory still lands, unlinked", async () => {
    const b = buf();
    b.capture({ session: "s1", scope: SCOPE, turns: [u(long("a revision"))] });
    const res = await submitProposal(
      b,
      { content: CONTENT, updates: "mem_confabulated" },
      {
        session: "s1",
        scope: SCOPE,
        source: "session-end",
        gate: pass,
        resolveUpdates: (declared, content) =>
          resolveUpdates(declared, ctx({ content, candidates: () => [FAR] })),
      },
    );
    expect(res.accepted).toBe(true);
    expect({ resolved: res.proposal?.updates?.resolved, reason: res.proposal?.updates?.reason }).toEqual({
      resolved: null,
      reason: "BELOW_FLOOR",
    });
    expect(res.proposal?.covers.length).toBe(1);
  });

  test("similarity is deterministic and needs no embedder", () => {
    expect(similarity(CONTENT, CONTENT)).toBe(1);
    expect(similarity(CONTENT, FAR.text)).toBeLessThan(TUNABLES.UPDATES_FLOOR);
    expect(similarity("", "")).toBe(0);
  });
});

// ── the crash fallback ──────────────────────────────────────────────────────

describe("crash fallback (G4, E1, E2, E7)", () => {
  function interpretOk(calls: SweepChunk[]): (c: SweepChunk) => Promise<InterpretResult> {
    return async (chunk) => {
      calls.push(chunk);
      return { proposals: [{ content: `from chunk ${chunk.index}` }], stopReason: "end_turn" };
    };
  }

  test("no session-ending boundary means no sweep, and no model call", async () => {
    const b = buf();
    b.capture({ session: "s1", scope: SCOPE, turns: [u(long("still live"))] });
    const calls: SweepChunk[] = [];
    const report = await sweep(b, { scope: SCOPE, interpret: interpretOk(calls) });
    expect({ ran: report.ran, reason: report.reason, calls: calls.length }).toEqual({
      ran: false,
      reason: "NO_CRASHED_SESSION",
      calls: 0,
    });
    expect(b.spans(SCOPE).length).toBe(1);
  });

  test("THE CRASH DEFINITION, all three clauses (owner ruling 2026-09-04)", async () => {
    const b = buf();
    // `quiet` stops and never comes back; `ritual` reaches the host's own
    // end-of-session path; `live` is still going.
    b.capture({ session: "quiet", scope: SCOPE, turns: [u(long("stopped mid-thought"))] });
    b.capture({ session: "ritual", scope: SCOPE, turns: [u(long("wrote it up first"))] });
    b.capture({ session: "live", scope: SCOPE, turns: [u(long("still talking"))] });
    b.boundary({ session: "quiet", scope: SCOPE, kind: "stop" });
    b.boundary({ session: "ritual", scope: SCOPE, kind: "stop" });
    b.boundary({ session: "ritual", scope: SCOPE, kind: "session-end" });

    // Clause 2, before the window: a stop is not a crash, however uncovered.
    expect([...b.crashedSessions(SCOPE)]).toEqual([]);
    expect(b.crashedPending(SCOPE)).toEqual({ sessions: new Set(), spans: 0, uncovered: 0 });
    const calls: SweepChunk[] = [];
    expect((await sweep(b, { scope: SCOPE, interpret: interpretOk(calls) })).reason).toBe("NO_CRASHED_SESSION");
    expect(calls.length).toBe(0);

    // Past the window: only `quiet`. `ritual` got the pen (clause 1) and `live`
    // has ended nothing at all.
    goQuiet();
    expect([...b.crashedSessions(SCOPE)]).toEqual(["quiet"]);
    expect(b.crashedPending(SCOPE).spans).toBe(1);
    await sweep(b, { scope: SCOPE, interpret: interpretOk(calls) });
    expect(calls[0]?.spans.map((s) => s.session)).toEqual(["quiet"]);
    expect(b.spans(SCOPE).map((s) => s.session).sort()).toEqual(["live", "ritual"]);
  });

  test("the gate counts spans held in a CLAIM FILE, so a crashed run's orphans are not stranded by it", async () => {
    const b = buf();
    b.capture({ session: "s1", scope: SCOPE, turns: [u(long("claimed by a run that died"))] });
    b.boundary({ session: "s1", scope: SCOPE, kind: "stop" });
    goQuiet();
    // A worker claimed these spans and never came back: the buffer is empty and
    // the only copy is the orphan claim file.
    const orphan = claimed(b);
    expect(b.spans(SCOPE)).toEqual([]);
    expect(existsSync(orphan.path)).toBe(true);

    // The gate must still see them, or its own pre-claim check would keep the
    // orphan from ever being merged back in.
    expect(b.crashedPending(SCOPE).spans).toBe(1);
    const calls: SweepChunk[] = [];
    const report = await sweep(b, { scope: SCOPE, interpret: interpretOk(calls) });
    expect({ ran: report.ran, reason: report.reason }).toEqual({ ran: true, reason: "SWEPT" });
    expect(calls[0]?.spans.length).toBe(1);
  });

  test("unclaimed spans past a boundary are swept, applied, and consumed", async () => {
    const b = buf();
    b.capture({ session: "s1", scope: SCOPE, turns: [u(long("crashed session"))] });
    b.boundary({ session: "s1", scope: SCOPE, kind: "pre-compaction" });
    goQuiet();
    const calls: SweepChunk[] = [];
    const applied: unknown[] = [];
    const report = await sweep(b, {
      scope: SCOPE,
      interpret: interpretOk(calls),
      apply: (proposals) => {
        applied.push(...proposals);
      },
    });
    expect({ ran: report.ran, reason: report.reason, swept: report.spansSwept, consumed: report.consumed }).toEqual(
      { ran: true, reason: "SWEPT", swept: 1, consumed: true },
    );
    expect({ chunks: report.chunks.map((c) => c.reason), applied: applied.length }).toEqual({
      chunks: ["APPLIED"],
      applied: 1,
    });
    expect(b.spans(SCOPE)).toEqual([]);
  });

  test("per-chunk failure isolation: one bad chunk does not fail the run (scar E1)", async () => {
    const b = buf();
    for (let i = 0; i < 3; i++) {
      b.capture({ session: "s1", scope: SCOPE, turns: turnsUpTo(i + 1) });
    }
    b.boundary({ session: "s1", scope: SCOPE, kind: "stop" });
    goQuiet();
    const doomed = b.spans(SCOPE)[1];

    const report = await sweep(b, {
      scope: SCOPE,
      chunkBytes: 10,
      interpret: async (chunk) => {
        if (chunk.index === 1) throw new Error("this chunk is bad");
        return { proposals: [{ content: "ok" }], stopReason: "end_turn" };
      },
    });
    expect(report.chunks.map((c) => c.reason)).toEqual(["APPLIED", "THREW", "APPLIED"]);
    expect({ swept: report.spansSwept, restored: report.spansRestored, consumed: report.consumed }).toEqual({
      swept: 2,
      restored: 1,
      consumed: true,
    });
    // Exactly the failed chunk's span is back, ready for the next boundary.
    expect(b.spans(SCOPE).map((s) => s.hash)).toEqual([doomed?.hash ?? "missing"]);
  });

  test("the SECOND failure of the same content still restores — the ledger holds only what was APPLIED (replay-review P0)", async () => {
    const b = buf();
    b.capture({ session: "s1", scope: SCOPE, turns: [u(long("twice doomed"))] });
    b.boundary({ session: "s1", scope: SCOPE, kind: "stop" });
    goQuiet();
    const doomed = b.spans(SCOPE)[0];
    const failing = async (): Promise<InterpretResult> => {
      throw new Error("NO_JSON_IN_RESPONSE");
    };

    // First failure: restored, consumed — and the restored hash must stay OUT
    // of the consumed ledger.
    const first = await sweep(b, { scope: SCOPE, interpret: failing });
    expect({ restored: first.spansRestored, consumed: first.consumed }).toEqual({
      restored: 1,
      consumed: true,
    });
    expect(b.spans(SCOPE).map((s) => s.hash)).toEqual([doomed?.hash ?? "missing"]);
    // The MECHANISM, not just the outcome (tests can lie about why they pass):
    // the ledger on disk must not hold the restored hash — its presence there is
    // precisely what made the second restore silently return zero spans.
    const ledgerFile = scopeFile(SCOPE, "consumed.jsonl");
    const ledger = existsSync(ledgerFile) ? readFileSync(ledgerFile, "utf8") : "";
    expect(ledger).not.toContain(doomed?.hash ?? "missing");

    // Second failure of the SAME content. Before the fix, the first consume had
    // recorded the restored hash, so this restore silently returned zero spans
    // and the claim was deleted anyway — the span was in neither buffer nor
    // claim, the one state spec §2 G6 forbids. Fired live in the 2026-08-26
    // replay (the 723-byte span lost between days 12 and 13).
    const second = await sweep(b, { scope: SCOPE, interpret: failing });
    expect({ restored: second.spansRestored, consumed: second.consumed }).toEqual({
      restored: 1,
      consumed: true,
    });
    expect(b.spans(SCOPE).map((s) => s.hash)).toEqual([doomed?.hash ?? "missing"]);

    // Third boundary, healthy interpreter: the span finally converts — and only
    // NOW does its hash belong in the ledger.
    const applied: unknown[] = [];
    const third = await sweep(b, {
      scope: SCOPE,
      interpret: async () => ({ proposals: [{ content: "finally" }], stopReason: "end_turn" }),
      apply: (proposals) => {
        applied.push(...proposals);
      },
    });
    expect({ swept: third.spansSwept, consumed: third.consumed, applied: applied.length }).toEqual({
      swept: 1,
      consumed: true,
      applied: 1,
    });
    expect(b.spans(SCOPE)).toEqual([]);
  });

  /** A chunk failure that carries a real code, the way an injected client's would. */
  function poison(counter: { calls: number }): () => Promise<InterpretResult> {
    return async () => {
      counter.calls += 1;
      throw Object.assign(new Error("no json in response"), { code: "NO_JSON_IN_RESPONSE" });
    };
  }

  test("the poison pill is BOUNDED: at MAX_SPAN_FAILURES distinct lived days the span is QUARANTINED, not restored again", async () => {
    let day = 3;
    const b = buf({ day: () => day });
    b.capture({ session: "s1", scope: SCOPE, turns: [u(long("permanently doomed"))] });
    b.boundary({ session: "s1", scope: SCOPE, kind: "stop" });
    goQuiet();
    const doomed = b.spans(SCOPE)[0];
    const counter = { calls: 0 };
    const failing = poison(counter);

    const reports = [];
    for (let i = 0; i < TUNABLES.MAX_SPAN_FAILURES; i++) {
      reports.push(await sweep(b, { scope: SCOPE, interpret: failing }));
      day += 1; // a poison pill fails on every day it is tried
    }
    // Every boundary up to the bound paid for one call; the last one quarantined.
    expect(counter.calls).toBe(TUNABLES.MAX_SPAN_FAILURES);
    expect(reports.map((r) => ({ restored: r.spansRestored, quarantined: r.spansQuarantined }))).toEqual([
      ...Array.from({ length: TUNABLES.MAX_SPAN_FAILURES - 1 }, () => ({ restored: 1, quarantined: 0 })),
      { restored: 0, quarantined: 1 },
    ]);

    // The buffer holds ZERO copies, and the span is not lost — it is readable.
    expect(b.spans(SCOPE)).toEqual([]);
    expect(b.quarantined(SCOPE).map((s) => s.hash)).toEqual([doomed?.hash ?? "missing"]);
    expect(b.quarantined(SCOPE)[0]?.text).toBe(doomed?.text ?? "missing");
    expect(b.coverageReport(SCOPE).quarantined).toBe(1);

    // The event fired ONCE, for one span.
    const fired = b.events("remember.span.quarantined");
    expect(fired.length).toBe(1);
    expect(fired[0]?.data?.spans).toBe(1);

    // Nothing can resurrect it: the claim file is gone, so no orphan merge can
    // bring it back, and the next boundary makes no model call at all.
    expect(readdirSync(join(dir, "spans", keyFor(SCOPE), "claims"))).toEqual([]);
    b.boundary({ session: "s1", scope: SCOPE, kind: "stop" });
    goQuiet();
    const after = await sweep(b, { scope: SCOPE, interpret: failing });
    expect({ reason: after.reason, calls: counter.calls }).toEqual({
      reason: "NOTHING_TO_SWEEP",
      calls: TUNABLES.MAX_SPAN_FAILURES,
    });
    expect(b.quarantined(SCOPE).length).toBe(1);
  });

  test("an OUTAGE is not a poison pill: any number of failures on ONE lived day never quarantines", async () => {
    // Three Stop hooks inside one API outage would have quarantined the whole
    // chunk under an attempt count (PR-8 review). The bound counts distinct
    // lived days, so the same day's retries are one failure.
    const b = buf({ day: () => 3 });
    b.capture({ session: "s1", scope: SCOPE, turns: [u(long("caught in an outage"))] });
    b.boundary({ session: "s1", scope: SCOPE, kind: "stop" });
    goQuiet();
    const counter = { calls: 0 };
    const failing = poison(counter);
    for (let i = 0; i < TUNABLES.MAX_SPAN_FAILURES + 2; i++) {
      const r = await sweep(b, { scope: SCOPE, interpret: failing });
      expect({ restored: r.spansRestored, quarantined: r.spansQuarantined }).toEqual({ restored: 1, quarantined: 0 });
    }
    expect(counter.calls).toBe(TUNABLES.MAX_SPAN_FAILURES + 2);
    expect(b.spans(SCOPE).length).toBe(1);
    expect(b.quarantined(SCOPE)).toEqual([]);
    // The ledger still records every attempt — history, not the count.
    expect(b.failureCounts(SCOPE).get(b.spans(SCOPE)[0]?.hash ?? "")).toBe(1);
  });

  test("BELOW the bound the span is restored and retried, and the ledger counts the failures", async () => {
    let day = 3;
    const b = buf({ day: () => day });
    b.capture({ session: "s1", scope: SCOPE, turns: [u(long("doomed for now"))] });
    b.boundary({ session: "s1", scope: SCOPE, kind: "stop" });
    goQuiet();
    const doomed = b.spans(SCOPE)[0];
    const counter = { calls: 0 };

    for (let i = 0; i < TUNABLES.MAX_SPAN_FAILURES - 1; i++) {
      const report = await sweep(b, { scope: SCOPE, interpret: poison(counter) });
      day += 1;
      expect({ restored: report.spansRestored, quarantined: report.spansQuarantined }).toEqual({
        restored: 1,
        quarantined: 0,
      });
      // Still in the buffer, still claimable: existing behavior, preserved.
      expect(b.spans(SCOPE).map((s) => s.hash)).toEqual([doomed?.hash ?? "missing"]);
    }
    expect(counter.calls).toBe(TUNABLES.MAX_SPAN_FAILURES - 1);
    expect(b.quarantined(SCOPE)).toEqual([]);
    expect(b.events("remember.span.quarantined")).toEqual([]);

    // The ledger on disk: one line per failure, by hash and code — never text.
    const raw = readFileSync(scopeFile(SCOPE, "failures.jsonl"), "utf8");
    const lines = raw.trim().split("\n").map((l) => JSON.parse(l) as Record<string, unknown>);
    expect(lines.length).toBe(TUNABLES.MAX_SPAN_FAILURES - 1);
    expect(lines.map((l) => Object.keys(l).sort())).toEqual(
      lines.map(() => ["at", "code", "day", "hash"]),
    );
    expect(lines[0]?.["hash"]).toBe(doomed?.hash ?? "missing");
    expect(lines[0]?.["code"]).toBe("NO_JSON_IN_RESPONSE");
    expect(raw).not.toContain("doomed for now");
    expect(b.failureCounts(SCOPE).get(doomed?.hash ?? "missing")).toBe(TUNABLES.MAX_SPAN_FAILURES - 1);
  });

  test("a restore that is a DEFERRAL, not a failure, never touches the failure ledger", async () => {
    // 1. Scraps under the minimum ride to the next boundary (spec §2 G8).
    const small = buf({ minClaimBytes: 5_000 });
    small.capture({ session: "s1", scope: SCOPE, turns: [u(long("too small to run"))] });
    small.boundary({ session: "s1", scope: SCOPE, kind: "stop" });
    goQuiet();
    const scraps = await sweep(small, { scope: SCOPE, interpret: async () => ({ proposals: [] }) });
    expect(scraps.reason).toBe("BELOW_MIN_CLAIM");
    expect(small.spans(SCOPE).length).toBe(1);
    expect(existsSync(scopeFile(SCOPE, "failures.jsonl"))).toBe(false);

    // 2. Spans of a session that has not ended go straight back, unmarked.
    const b = buf();
    b.capture({ session: "ended", scope: SCOPE, turns: [u(long("done"))] });
    b.capture({ session: "live", scope: SCOPE, turns: [u(long("still going"))] });
    b.boundary({ session: "ended", scope: SCOPE, kind: "stop" });
    goQuiet();
    await sweep(b, { scope: SCOPE, interpret: interpretOk([]) });
    expect(b.spans(SCOPE).map((s) => s.session)).toEqual(["live"]);
    expect(existsSync(scopeFile(SCOPE, "failures.jsonl"))).toBe(false);

    // 3. And the already-authored retirement, which restores without a call.
    //    Its OWN session id: the read cursor is per (scope, session), so reusing
    //    part 1's would capture nothing and prove nothing.
    const authored = buf();
    authored.capture({ session: "wrote-it-up", scope: SCOPE, turns: [u(long("all authored"))] });
    await submitProposal(
      authored,
      { content: "I wrote the whole session up myself." },
      { session: "wrote-it-up", scope: SCOPE, source: "session-end", gate: pass },
    );
    authored.boundary({ session: "wrote-it-up", scope: SCOPE, kind: "stop" });
    goQuiet();
    const retired = await sweep(authored, { scope: SCOPE, interpret: interpretOk([]) });
    expect(retired.reason).toBe("NOTHING_UNCLAIMED");
    expect(existsSync(scopeFile(SCOPE, "failures.jsonl"))).toBe(false);
  });

  test("the ledger is HISTORY, not state: a previously-failed span still converts normally", async () => {
    let day = 3;
    const b = buf({ day: () => day });
    b.capture({ session: "s1", scope: SCOPE, turns: [u(long("doomed then fine"))] });
    b.boundary({ session: "s1", scope: SCOPE, kind: "stop" });
    goQuiet();
    const doomed = b.spans(SCOPE)[0];
    const counter = { calls: 0 };
    for (let i = 0; i < TUNABLES.MAX_SPAN_FAILURES - 1; i++) {
      await sweep(b, { scope: SCOPE, interpret: poison(counter) });
      day += 1;
    }

    const applied: unknown[] = [];
    const report = await sweep(b, {
      scope: SCOPE,
      interpret: async () => ({ proposals: [{ content: "finally" }], stopReason: "end_turn" }),
      apply: (proposals) => {
        applied.push(...proposals);
      },
    });
    expect({ swept: report.spansSwept, consumed: report.consumed, applied: applied.length }).toEqual({
      swept: 1,
      consumed: true,
      applied: 1,
    });
    expect({ spans: b.spans(SCOPE).length, quarantined: b.quarantined(SCOPE).length }).toEqual({
      spans: 0,
      quarantined: 0,
    });
    // Success does not rewrite history — the failures stay on the record.
    expect(b.failureCounts(SCOPE).get(doomed?.hash ?? "missing")).toBe(TUNABLES.MAX_SPAN_FAILURES - 1);
  });

  test("a ledger that cannot be written quarantines NOTHING — the failure path fails toward retry", async () => {
    const b = buf();
    b.capture({ session: "s1", scope: SCOPE, turns: [u(long("doomed, unwritable"))] });
    b.boundary({ session: "s1", scope: SCOPE, kind: "stop" });
    goQuiet();
    const doomed = b.spans(SCOPE)[0];
    const counter = { calls: 0 };
    for (let i = 0; i < TUNABLES.MAX_SPAN_FAILURES - 1; i++) {
      await sweep(b, { scope: SCOPE, interpret: poison(counter) });
    }

    // The bound is reached — but the ledger append cannot land. A quarantine with
    // no durable record is a span in neither place: it must not happen.
    harden(scopeFile(SCOPE, "failures.jsonl"));
    const report = await sweep(b, { scope: SCOPE, interpret: poison(counter) });
    expect({ restored: report.spansRestored, quarantined: report.spansQuarantined }).toEqual({
      restored: 1,
      quarantined: 0,
    });
    expect(b.spans(SCOPE).map((s) => s.hash)).toEqual([doomed?.hash ?? "missing"]);
    expect(existsSync(scopeFile(SCOPE, "quarantine.jsonl"))).toBe(false);
    expect(b.events("remember.span.quarantined")).toEqual([]);
    expect(b.events("remember.write.failed")[0]?.data?.site).toBe("failure");
  });

  test("the quarantine event carries counts and a code — never text, never a content hash", async () => {
    let day = 3;
    const b = buf({ day: () => day });
    b.capture({ session: "s1", scope: SCOPE, turns: [u(long("secret-looking doom"))] });
    b.boundary({ session: "s1", scope: SCOPE, kind: "stop" });
    goQuiet();
    const doomed = b.spans(SCOPE)[0];
    const counter = { calls: 0 };
    for (let i = 0; i < TUNABLES.MAX_SPAN_FAILURES; i++) {
      await sweep(b, { scope: SCOPE, interpret: poison(counter) });
      day += 1;
    }

    const fired = b.events("remember.span.quarantined")[0];
    expect(Object.keys(fired?.data ?? {}).sort()).toEqual(["code", "scope", "spans"]);
    expect(fired?.data).toEqual({ scope: keyFor(SCOPE), spans: 1, code: "NO_JSON_IN_RESPONSE" });
    // By REFERENCE: no span text, and not the hash of the text either — hashing
    // low-entropy content leaks it.
    expect(fired?.ref).toBeUndefined();
    const serialized = JSON.stringify(fired);
    expect(serialized).not.toContain("secret-looking");
    expect(serialized).not.toContain(doomed?.hash ?? "missing");
  });

  test("a truncated response is a FAILURE, not data (scar E2)", async () => {
    const b = buf();
    b.capture({ session: "s1", scope: SCOPE, turns: [u(long("long answer"))] });
    b.boundary({ session: "s1", scope: SCOPE, kind: "stop" });
    goQuiet();
    const report = await sweep(b, {
      scope: SCOPE,
      interpret: async () => ({ proposals: [{ content: "half a" }], stopReason: "max_tokens" }),
    });
    expect(report.chunks.map((c) => ({ reason: c.reason, code: c.code }))).toEqual([
      { reason: "TRUNCATED", code: "max_tokens" },
    ]);
    expect({ swept: report.spansSwept, restored: report.spansRestored }).toEqual({ swept: 0, restored: 1 });
    expect(b.spans(SCOPE).length).toBe(1);
  });

  test("a malformed result is a failure with its own reason", async () => {
    const b = buf();
    b.capture({ session: "s1", scope: SCOPE, turns: [u(long("garbage back"))] });
    b.boundary({ session: "s1", scope: SCOPE, kind: "stop" });
    goQuiet();
    const report = await sweep(b, {
      scope: SCOPE,
      interpret: async () => ({ proposals: "not an array" } as unknown as InterpretResult),
    });
    expect(report.chunks.map((c) => c.reason)).toEqual(["MALFORMED_RESULT"]);
    expect(b.spans(SCOPE).length).toBe(1);
  });

  test("returned-nothing and failed are DISTINCT records (scar §2.4)", async () => {
    const b = buf();
    b.capture({ session: "s1", scope: SCOPE, turns: [u(long("nothing here"))] });
    b.boundary({ session: "s1", scope: SCOPE, kind: "stop" });
    goQuiet();
    const report = await sweep(b, { scope: SCOPE, interpret: async () => ({ proposals: [], stopReason: "end_turn" }) });
    expect(report.chunks.map((c) => ({ ok: c.ok, reason: c.reason }))).toEqual([{ ok: true, reason: "EMPTY" }]);
    expect({ empty: b.events("remember.chunk.empty").length, failed: b.events("remember.chunk.failed").length }).toEqual(
      { empty: 1, failed: 0 },
    );
    expect(b.spans(SCOPE)).toEqual([]);
  });

  test("an apply failure keeps the chunk's spans, not the sweep's verdict", async () => {
    const b = buf();
    b.capture({ session: "s1", scope: SCOPE, turns: [u(long("apply fails"))] });
    b.boundary({ session: "s1", scope: SCOPE, kind: "stop" });
    goQuiet();
    const report = await sweep(b, {
      scope: SCOPE,
      interpret: async () => ({ proposals: [{ content: "x" }], stopReason: "end_turn" }),
      apply: () => {
        throw new Error("store said no");
      },
    });
    expect(report.chunks.map((c) => c.reason)).toEqual(["APPLY_FAILED"]);
    expect(b.spans(SCOPE).length).toBe(1);
  });

  test("covered spans ride ALONG marked; a proposal's own span is withheld outright (§4.1 G4)", async () => {
    const b = buf();
    const jot = b.jot({ session: "s1", scope: SCOPE, text: long("my own words") });
    b.capture({ session: "s1", scope: SCOPE, turns: [u(long("what we discussed"))] });
    const ownHash = jot.spans[0]?.hash;
    await submitProposal(
      b,
      { content: "Something I chose to write down myself." },
      { session: "s1", scope: SCOPE, source: "jot", gate: pass, ownSpanHash: ownHash },
    );
    // Now a second, unauthored stretch arrives and the session ends in a crash.
    b.capture({ session: "s1", scope: SCOPE, turns: [u(long("what we discussed")), u(long("the residual"))] });
    b.boundary({ session: "s1", scope: SCOPE, kind: "stop" });
    goQuiet();

    const calls: SweepChunk[] = [];
    await sweep(b, { scope: SCOPE, interpret: interpretOk(calls) });
    const chunk = calls[0];
    const texts = chunk?.spans.map((s) => s.text) ?? [];
    expect(texts).not.toContain(long("my own words"));
    expect(texts).toContain(long("the residual"));
    expect(chunk?.marked.filter((m) => m.mark !== null).map((m) => m.span.text)).toEqual([
      long("what we discussed"),
    ]);
    expect(chunk?.prompt.includes(ALREADY_AUTHORED_MARK)).toBe(true);
  });

  test("when everything eligible was already authored, the spans retire without a model call", async () => {
    const b = buf();
    b.capture({ session: "s1", scope: SCOPE, turns: [u(long("all authored"))] });
    await submitProposal(
      b,
      { content: "I wrote the whole session up myself." },
      { session: "s1", scope: SCOPE, source: "session-end", gate: pass },
    );
    b.boundary({ session: "s1", scope: SCOPE, kind: "stop" });
    goQuiet();
    const calls: SweepChunk[] = [];
    const report = await sweep(b, { scope: SCOPE, interpret: interpretOk(calls) });
    expect({ ran: report.ran, reason: report.reason, calls: calls.length, consumed: report.consumed }).toEqual({
      ran: false,
      reason: "NOTHING_UNCLAIMED",
      calls: 0,
      consumed: true,
    });
    expect(b.spans(SCOPE)).toEqual([]);
  });

  test("spans from a session that has NOT ended go straight back", async () => {
    const b = buf();
    b.capture({ session: "ended", scope: SCOPE, turns: [u(long("done"))] });
    b.capture({ session: "live", scope: SCOPE, turns: [u(long("still going"))] });
    b.boundary({ session: "ended", scope: SCOPE, kind: "stop" });
    goQuiet();
    const calls: SweepChunk[] = [];
    await sweep(b, { scope: SCOPE, interpret: interpretOk(calls) });
    expect(calls[0]?.spans.map((s) => s.session)).toEqual(["ended"]);
    expect(b.spans(SCOPE).map((s) => s.session)).toEqual(["live"]);
  });

  test("every scope holding experience gets swept, not only the one that fired (spec §2 G9)", async () => {
    const b = buf();
    for (const scope of [SCOPE, OTHER]) {
      b.capture({ session: `s-${scope}`, scope, turns: [u(long(`lived in ${scope}`))] });
      b.boundary({ session: `s-${scope}`, scope, kind: "stop" });
      goQuiet();
    }
    const calls: SweepChunk[] = [];
    const reports = await sweepAll(b, { interpret: interpretOk(calls) });
    expect(reports.map((r) => ({ scope: r.scope, reason: r.reason })).sort((x, y) => x.scope.localeCompare(y.scope))).toEqual([
      { scope: SCOPE, reason: "SWEPT" },
      { scope: OTHER, reason: "SWEPT" },
    ]);
    expect(b.scopes().sort()).toEqual([SCOPE, OTHER].sort());
  });

  test("chunking is by bytes and every span lands in exactly one chunk", () => {
    const b = buf();
    for (let i = 0; i < 4; i++) b.capture({ session: "s1", scope: SCOPE, turns: turnsUpTo(i + 1) });
    const spans = b.spans(SCOPE);
    const chunks = chunkSpans(spans, new Set(), 10);
    expect(chunks.length).toBe(4);
    expect(chunks.flatMap((c) => c.spans.map((s) => s.hash)).sort()).toEqual(spans.map((s) => s.hash).sort());
    expect(chunks.map((c) => c.index)).toEqual([0, 1, 2, 3]);
  });
});

// ── the rest of the contract's mechanics ────────────────────────────────────

describe("seams and safety", () => {
  test("a watchdog must fire INSIDE the claim-staleness window (scars E4/E5)", () => {
    expect(validateWatchdog(60_000)).toEqual({ ok: true, reason: "OK" });
    expect(validateWatchdog(TUNABLES.STALE_CLAIM_MS)).toEqual({
      ok: false,
      reason: "TIMEOUT_EXCEEDS_STALENESS",
    });
    expect(validateWatchdog(0)).toEqual({ ok: false, reason: "TIMEOUT_NOT_FINITE" });
    expect(validateWatchdog(5_000, 4_000)).toEqual({ ok: false, reason: "TIMEOUT_EXCEEDS_STALENESS" });
  });

  test("the buffer inherits the data-dir guard: it cannot be pointed at a live v1 store", () => {
    process.env[DATA_DIR_ENV] = join(process.env["HOME"] ?? "/tmp", ".bansai", "spans");
    let code = "NO_THROW";
    try {
      new SpanBuffer();
    } catch (err) {
      code = isStoreError(err) ? err.code : `OTHER:${String(err)}`;
    }
    process.env[DATA_DIR_ENV] = dir;
    expect(code).toBe("DATA_DIR_FORBIDDEN");
  });

  test("everything the buffer writes stays under spans/, and telemetry is by reference", () => {
    const b = buf();
    b.capture({ session: "s1", scope: SCOPE, turns: [u("a secret-looking sentence")] });
    b.boundary({ session: "s1", scope: SCOPE, kind: "stop" });
    expect(existsSync(join(dir, "spans"))).toBe(true);
    expect(new Set(readdirSync(dir))).toEqual(new Set(["spans"]));

    for (const event of b.events()) {
      for (const value of Object.values(event.data ?? {})) {
        expect(String(value)).not.toContain("secret-looking");
      }
      expect(event.ref ?? "").not.toContain("secret-looking");
    }
  });

  test("a corrupt buffer line is skipped and COUNTED, never fatal", () => {
    const b = buf();
    b.capture({ session: "s1", scope: SCOPE, turns: [u(long("good line"))] });
    appendFileSync(scopeFile(SCOPE, "buffer.jsonl"), "{not json\n", "utf8");
    expect(b.spans(SCOPE).length).toBe(1);
    expect(b.events("remember.line.corrupt")[0]?.data?.count).toBe(1);
  });

  test("the scope legend makes hashed directory names readable back", () => {
    const b = buf();
    b.capture({ session: "s1", scope: SCOPE, turns: [u("x")] });
    const legend = JSON.parse(readFileSync(join(dir, "spans", "scopes.json"), "utf8")) as Record<string, string>;
    expect(legend[keyFor(SCOPE)]).toBe(SCOPE);
    expect(keyFor(SCOPE)).toBe(hashText(SCOPE).slice(0, 12));
  });
});

/**
 * The first `n` turns of one session. Growing it by one per capture is how a real
 * transcript arrives, and each boundary appends exactly one short span — small
 * enough that byte-based chunking splits them one per chunk.
 */
function turnsUpTo(n: number): Turn[] {
  return Array.from({ length: n }, (_, i) => u(`turn-${i}-xxx`));
}
