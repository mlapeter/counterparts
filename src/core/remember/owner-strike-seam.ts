/**
 * THE STRIKE — the one place in `remember/` that destroys lived experience.
 *
 * It is the span buffer's half of the destruction path, and it exists because
 * "anything can be removed loudly" (constitution 6/7) was not true of a note.
 * A note is CAPTURED before it is minted: `captureJot` appends the verbatim text
 * to `spans/<key>/jots.jsonl`, and nothing ever pruned that file. `remove`
 * chased the prose, the rows, the links and the cache, reported `unchased:
 * nothing`, and the words stayed on disk — where a later `backup` copied them
 * (LAUNCH-STATUS §I2, measured 2026-09-04; the honest-report half shipped as
 * option A in #53, and this is option B).
 *
 * **Why it is a seam and not a method.** `SpanBuffer` is held by `Counterpart`,
 * which is held by the MCP server, which a model talks to. A public
 * `buffer.strike()` would be the same mistake as a `Store.delete()`: reachable
 * by anyone holding the object (`store/` §5 G2, §16 G1 — "enforced by
 * absence"). So the buffer HANDS this module a capability at construction time
 * (a WeakMap the rest of the program cannot see), exactly the way `Store` hands
 * `store/owner-op-seam.ts` its own, and `test/cli.test.ts` pins who may import
 * this file at all. Nothing reaches `strikeSpans` by having a `SpanBuffer`.
 *
 * **Why it is not an `rmSync` from the destruction path.** `spans/` is
 * `remember/`'s state machine. Spec §2 G6 forbids a span being in NEITHER a
 * claim nor the buffer, and a claim renaming a file out from under a chase is
 * exactly the race that guarantee exists to prevent (cli/INTERFACE-GAPS §9).
 *
 * **The choreography, and what each move is for.** Per text-bearing file:
 *
 *   1. **Ledger first.** Every struck hash goes into `consumed.jsonl` BEFORE a
 *      byte moves. That file is the terminal ledger `seenHashes`, `restore` and
 *      `mergeOrphans` all already filter against — so from this moment a
 *      re-capture of the same words dedups away, a worker mid-arc cannot
 *      restore the span it is holding in memory, and a crashed run's orphan
 *      cannot merge it back. It is the same disposition a QUARANTINED span
 *      gets, and for the same reason: terminal, not pass-through, so scar
 *      §2.20's "restored hashes must not enter the ledger" does not apply.
 *   2. **Rename ASIDE, then append the survivors back** — `claim()`'s move, for
 *      `claim()`'s reason. `mutate()` is a stance check and a try/catch, NOT a
 *      lock: a read-filter-write-over would lose a turn appended between the
 *      read and the rename, because that append lands on the old inode. The
 *      aside carries a `.striking` suffix, which is not `.jsonl`, so nothing —
 *      `claimFiles()` least of all — picks it up as an ordinary orphan.
 *   3. **Fold a previous crash's aside back in first.** A `.striking` file left
 *      by a crashed strike is read, filtered through the same predicate, and
 *      merged (deduped by hash) before this strike runs. Nothing is stranded.
 *
 * **What it writes.** `strikes.jsonl` beside the streams: counts, file names and
 * a lived day — never a hash, never a word. §16 G9's rule about the removal
 * record is the rule here too: a hash of low-entropy content is brute-forceable,
 * so the durable trace of a destruction must not carry one.
 */
import { appendFileSync, existsSync, readFileSync, renameSync, rmSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { basename } from "node:path";

import type { Span, SpanKind, WriteSite } from "./spans.js";

// ── the capability ──────────────────────────────────────────────────────────

/**
 * What a `SpanBuffer` hands this module, and nothing else. Every entry is a
 * bound closure over the buffer's own private members, so the strike writes
 * through the SAME seam (`mutate`) every other write site uses and inherits its
 * stand-down instead of remembering to check.
 */
export interface SpanStrikeAccess {
  readonly observer: boolean;
  scopes(): string[];
  scopeDir(scope: string): string;
  path(scope: string, name: string): string;
  claimFiles(scope: string): string[];
  streamPath(scope: string, kind: SpanKind): string;
  ensureScope(scope: string): void;
  readLines<T>(file: string): T[];
  mutate<T>(
    site: WriteSite,
    fn: () => T,
  ): { ok: true; value: T } | { ok: false; reason: "OBSERVER" | "IO_FAILED"; code: string };
  emit(name: string, ref?: string, data?: Record<string, string | number | boolean | null>): void;
  now(): number;
  day(): number;
}

const GRANTS = new WeakMap<object, SpanStrikeAccess>();

/** Called once, by `SpanBuffer`'s constructor. */
export function grantSpanStrike(buffer: object, access: SpanStrikeAccess): void {
  GRANTS.set(buffer, access);
}

// ── the request and the report ──────────────────────────────────────────────

export interface StrikeRequest {
  /** One scope, or every scope holding experience when the origin is unrecorded. */
  scope: string | null;
  /**
   * Span hashes to strike — the chase BY IDENTITY. `origin.spanHash` in the
   * memory's prose meta is one; the `own: true` coverage marks for its
   * `origin_ref` are the other, and they are what makes the chase work on rows
   * minted before the meta key existed.
   */
  hashes?: readonly string[];
  /**
   * The fallback for a memory whose provenance never recorded a hash: a
   * predicate over a span's TEXT. The destruction path passes the doomed body,
   * which is the only thing it can match on before it destroys it. The text
   * never leaves the caller — this module receives a function, not a string.
   */
  predicate?: (text: string) => boolean;
}

/** What one strike touched. Counts and file names — never contents (§16 G9). */
export interface StrikeReport {
  readonly reason: "STRUCK" | "NOTHING" | "OBSERVER" | "IO_FAILED";
  /** Lines removed, across every file and every scope. */
  readonly struck: number;
  /** Per file, scope-relative: `<12-hex key>/jots.jsonl`. */
  readonly files: readonly { readonly file: string; readonly struck: number }[];
  /** Scopes looked at. A strike with no `scope` looks at all of them. */
  readonly scopes: number;
  /** Hashes appended to `consumed.jsonl` so nothing re-admits the span. */
  readonly ledgered: number;
  /** True when a claim file was one of the files rewritten (see the note below). */
  readonly touchedClaim: boolean;
  /** True when the terminal ledger already held every hash — a repeated strike. */
  readonly alreadyLedgered: boolean;
}

/** The streams that carry TEXT. Everything else under a scope is hashes and counts. */
const TEXT_STREAMS: readonly SpanKind[] = ["conversation", "jot", "assistant"];

const EMPTY: StrikeReport = {
  reason: "NOTHING",
  struck: 0,
  files: [],
  scopes: 0,
  ledgered: 0,
  touchedClaim: false,
  alreadyLedgered: false,
};

/**
 * Strike every span matching the request out of the buffer, atomically per file.
 *
 * It refuses under observer (the stand-down is the buffer's own, emitted from
 * `mutate`) and it never throws: like every path in this module, it returns a
 * REASON, because the caller — the owner's console mid-removal — must be able to
 * report a partial success rather than crash inside a destruction (§16 G15).
 */
export function strikeSpans(buffer: object, request: StrikeRequest): StrikeReport {
  const access = GRANTS.get(buffer);
  if (access === undefined) throw new Error("SPAN_STRIKE_UNGRANTED");
  // STANCE FIRST, WORK SECOND — the store seam's ordering and this module's:
  // an instrument refuses before it has read a byte, let alone staged one, and
  // the stand-down is emitted through `mutate` so the totality test sees this
  // site the same way it sees every other (§5 G8). Before the has-anything-to-do
  // check on purpose: "there was nothing to strike" and "I am not allowed to
  // strike" are different answers and must not collapse into each other.
  if (access.observer) {
    access.mutate("strike", () => undefined);
    return { ...EMPTY, reason: "OBSERVER" };
  }
  const hashes = new Set(request.hashes ?? []);
  const predicate = request.predicate;
  if (hashes.size === 0 && predicate === undefined) return EMPTY;

  const matches = (span: Span): boolean => {
    if (hashes.has(span.hash)) return true;
    return predicate !== undefined && typeof span.text === "string" && predicate(span.text);
  };

  const scopes = request.scope === null ? access.scopes() : [request.scope];
  const files: { file: string; struck: number }[] = [];
  let struck = 0;
  let ledgered = 0;
  let touchedClaim = false;
  let alreadyLedgered = true;
  let failed = false;
  let observed = false;

  for (const scope of scopes) {
    if (!existsSync(access.scopeDir(scope))) continue;
    const targets = [
      ...TEXT_STREAMS.map((kind) => access.streamPath(scope, kind)),
      access.path(scope, "quarantine.jsonl"),
      ...access.claimFiles(scope),
    ];

    // The hashes this scope is about to lose, read BEFORE anything moves.
    const doomed = new Set<string>();
    for (const file of targets) {
      for (const span of access.readLines<Span>(file)) {
        if (typeof span.hash === "string" && matches(span)) doomed.add(span.hash);
      }
    }
    // A crashed strike's aside counts too — its lines are still on disk.
    for (const file of targets) {
      for (const span of access.readLines<Span>(`${file}.striking`)) {
        if (typeof span.hash === "string" && matches(span)) doomed.add(span.hash);
      }
    }
    if (doomed.size === 0) continue;

    // 1. THE LEDGER, first and on its own. If this fails, nothing is rewritten:
    //    a struck span whose hash never reached the ledger is one a restore or
    //    an orphan merge can put straight back.
    const ledger = access.mutate("strike", () => {
      access.ensureScope(scope);
      const file = access.path(scope, "consumed.jsonl");
      const held = new Set(
        access.readLines<{ hash: string }>(file).map((l) => l.hash),
      );
      const fresh = [...doomed].filter((h) => !held.has(h));
      if (fresh.length > 0) {
        const at = access.now();
        appendFileSync(
          file,
          `${fresh.map((hash) => JSON.stringify({ hash, at })).join("\n")}\n`,
          "utf8",
        );
      }
      return fresh.length;
    });
    if (!ledger.ok) {
      if (ledger.reason === "OBSERVER") observed = true;
      else failed = true;
      continue;
    }
    ledgered += ledger.value;
    if (ledger.value > 0) alreadyLedgered = false;

    // 2. THE REWRITE, one file at a time.
    for (const file of targets) {
      const outcome = access.mutate("strike", () => rewrite(access, file, matches));
      if (!outcome.ok) {
        if (outcome.reason === "OBSERVER") observed = true;
        else failed = true;
        continue;
      }
      if (outcome.value === 0) continue;
      struck += outcome.value;
      files.push({ file: relName(access, scope, file), struck: outcome.value });
      if (file.includes(`${sep}claims${sep}`)) touchedClaim = true;
    }

    // 3. THE RECORD. Counts and file names, never a hash and never a word.
    access.mutate("strike", () => {
      access.ensureScope(scope);
      appendFileSync(
        access.path(scope, "strikes.jsonl"),
        `${JSON.stringify({
          at: access.now(),
          day: access.day(),
          by: "owner",
          files: files.length,
          struck,
          ledgered,
        })}\n`,
        "utf8",
      );
    });
  }

  const reason: StrikeReport["reason"] = observed
    ? "OBSERVER"
    : failed
      ? "IO_FAILED"
      : struck > 0 || ledgered > 0
        ? "STRUCK"
        : "NOTHING";

  if (reason !== "NOTHING") {
    // The durable record's twin on the ring. Counts only, here too.
    access.emit("remember.span.struck", undefined, {
      reason,
      struck,
      files: files.length,
      scopes: scopes.length,
      ledgered,
      touchedClaim,
    });
  }

  return {
    reason,
    struck,
    files,
    scopes: scopes.length,
    ledgered,
    touchedClaim,
    alreadyLedgered: alreadyLedgered && struck > 0,
  };
}

// ── internals ───────────────────────────────────────────────────────────────

const sep = "/";

function relName(access: SpanStrikeAccess, scope: string, file: string): string {
  const dir = access.scopeDir(scope);
  const rel = file.startsWith(dir) ? file.slice(dir.length + 1) : basename(file);
  return `${basename(dir)}/${rel}`;
}

/**
 * One file, rewritten WITHOUT the matching lines. Returns how many went.
 *
 * The aside is the point: `renameSync` is atomic, so an append racing this
 * lands in a fresh file at the original path and is untouched by what follows.
 * The survivors are then appended back to that path — after the racing append,
 * which reorders by at most one batch and loses nothing. Ordering inside a
 * stream is `at`-sorted on read (`spans()`), so the shuffle is invisible.
 */
function rewrite(
  access: SpanStrikeAccess,
  file: string,
  matches: (span: Span) => boolean,
): number {
  const aside = `${file}.striking`;

  // A previous crash's aside, folded back in first — through the same filter, so
  // a struck line never returns, and deduped so a half-finished append-back does
  // not double a survivor.
  const carried: string[] = [];
  const carriedHashes = new Set<string>();
  let struck = 0;
  if (existsSync(aside)) {
    for (const line of lines(aside)) {
      const span = parse(line);
      if (span === null) {
        carried.push(line);
        continue;
      }
      if (matches(span)) {
        struck += 1;
        continue;
      }
      if (carriedHashes.has(span.hash)) continue;
      carriedHashes.add(span.hash);
      carried.push(line);
    }
    rmSync(aside, { force: true });
  }

  if (!existsSync(file)) {
    if (carried.length > 0) appendFileSync(file, `${carried.join("\n")}\n`, "utf8");
    return struck;
  }

  // Nothing to do is nothing to do: a rename-and-restore of an untouched file
  // would churn every stream in the scope on every strike.
  const before = lines(file);
  const hits = before.filter((line) => {
    const span = parse(line);
    return span !== null && matches(span);
  }).length;
  if (hits === 0 && carried.length === 0) return struck;

  const tmp = `${aside}.${process.pid}.${randomBytes(3).toString("hex")}`;
  renameSync(file, tmp);
  renameSync(tmp, aside);
  const keep: string[] = [...carried];
  const seen = new Set(carriedHashes);
  for (const line of lines(aside)) {
    const span = parse(line);
    if (span === null) {
      keep.push(line);
      continue;
    }
    if (matches(span)) {
      struck += 1;
      continue;
    }
    if (seen.has(span.hash)) continue;
    seen.add(span.hash);
    keep.push(line);
  }
  if (keep.length > 0) appendFileSync(file, `${keep.join("\n")}\n`, "utf8");
  rmSync(aside, { force: true });
  return struck;
}

function lines(file: string): string[] {
  if (!existsSync(file)) return [];
  try {
    return readFileSync(file, "utf8").split("\n").filter((l) => l.trim().length > 0);
  } catch {
    return [];
  }
}

function parse(line: string): Span | null {
  try {
    const span = JSON.parse(line) as Span;
    return typeof span.hash === "string" && typeof span.text === "string" ? span : null;
  } catch {
    // A half-written line from a crash. It is KEPT — this module destroys what
    // it was asked to destroy and nothing else, and an unreadable line is not
    // something it can claim to have identified.
    return null;
  }
}
