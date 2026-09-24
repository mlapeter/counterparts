/**
 * The adapter's configuration and its CAPABILITY REPORT.
 *
 * This file is where scar §2.18 lives — "a guarantee carried by something you
 * don't own is not a guarantee". v1 encoded one host's 9,000-byte injection
 * cliff as though it were physiology and discovered its socket ceiling by
 * watching calls die. Both are host facts. Here they are named, reported, and
 * CHECKABLE — and the core is told what they are rather than assuming them.
 *
 * The rule the CONTRACT states and this file mechanizes:
 *
 *   §4 G4 — every host-dependent limit is discovered or asserted at runtime and
 *   surfaced as a checkable value. `capabilities()` returns one row per limit
 *   with `reported: false` where the host said nothing, so "we never asked" and
 *   "the host said zero" are different records (scar §2.4).
 *
 * KEYLESS (owner, 2026-09-24). The package reads no API key and calls no model
 * API of its own: the Anthropic write-up of crashed sessions, the Voyage
 * embedder, the credentials file and the model seats that fed them were
 * removed. A configuration that still names one of them is read, not refused —
 * the setting is ignored and named in `retired` (see `loadConfig`).
 *
 * And one from observer-mode G5: an unreadable configuration resolves to
 * OBSERVER, never to "encode anyway". `loadConfig` never throws.
 */
import { isAbsolute } from "node:path";

import { PAGE_WRITER_MODES } from "../../core/self/index.js";
import type { PageWriterMode } from "../../core/self/index.js";
import { DEFAULT_KEEP as SNAPSHOT_DEFAULT_KEEP } from "../snapshots.js";


/** Every host-dependent limit this adapter depends on. One row each. */
export const CAPABILITIES = [
  "injectionBudgetBytes",
  "executionCeilingMs",
  "socketLifetimeMs",
] as const;
export type CapabilityName = (typeof CAPABILITIES)[number];

export interface CapabilityReport {
  readonly name: CapabilityName;
  /** False when the host told us nothing. Never silently defaulted. */
  readonly reported: boolean;
  readonly value: number | boolean | null;
  readonly why: string;
}

/**
 * The adapter's own tunables, in one visible place (the shape every core module
 * uses). Nothing here is a memory property; all of it is host trivia.
 */
export const TUNABLES = {
  /** Detached-worker watchdog, ms. Validated against `remember/`'s staleness
   *  window by `validateWatchdog` before any spawn (scars E4/E5). */
  WATCHDOG_MS: 5 * 60_000,
  /** The nightly page writer's own watchdog in `host` mode, ms. Longer than the
   *  worker's because the child is a whole host session — it loads MCP servers,
   *  runs SessionStart hooks and then makes a model call — and shorter than any
   *  person would wait, because a writer still running at the next boundary is a
   *  writer that failed. It bounds a process this package STARTED; unlike the
   *  worker's it is not validated against `remember/`'s claim staleness, because
   *  it claims no spans. */
  PAGE_WRITER_MS: 10 * 60_000,
  /** Reference resolution at a session-ending boundary (recall §9.2), ms. The
   *  resolver stops between candidates past it and the row says so
   *  (`recall.credit` reason `budget-exceeded`); nothing is truncated silently. */
  CREDIT_BUDGET_MS: 150,
  /** Identical consecutive spawn failures before the worker ESCALATES instead
   *  of re-logging the same line forever (scar E4's widening). */
  ESCALATE_AFTER: 3,
  /**
   * THE NEXT-SESSION WRITE-UP (roadmap C2, owner 2026-09-23). How many sessions
   * may be pointed at an ended session's words in one calendar day (local
   * time, `self/calendar.ts`). A sibling of the page writer's
   * `PAGE_WRITER_ASKS_PER_DAY` and the same number: the owner's ruling is that
   * the write-up SHARES the day's allowance rather than growing a pacer of its
   * own — and nothing here is at the Stop, where §13 G3's one pacer lives.
   */
  WRITE_UP_ASKS_PER_DAY: 2,
  /**
   * The host's cap on a hook's whole output, in characters. The host's own
   * words: "Hook output strings, including `additionalContext`, `systemMessage`,
   * and plain stdout, are capped at 10,000 characters. Output that exceeds this
   * limit is saved to a file and replaced with a preview and file path." Past
   * it, what the session would read is a preview — of the WAKE — so the
   * write-up pointer is measured so the wake, every ask and itself stay under
   * this. With no owner notice the hook prints PLAIN text, so there is no JSON
   * escaping to leave room for (PR #192 review, MAJOR 1); with one,
   * `bin/hook.ts#hostDelivery` drops the notice before it lets the envelope
   * pass `ENVELOPE_MAX_CHARS`. It is also why the words themselves travel
   * through the MCP door.
   */
  WRITE_UP_HOST_OUTPUT_CHARS: 10_000,
  // The Stop ask's pacing is NOT here any more, and that is the point: it was a
  // second pacer beside `self/`'s, and two pacers on one blocked moment is how
  // 13 owner turns drew about a dozen asks (2026-09-04). The one pair lives in
  // `self/tunables.ts` — REASK_TURNS / REASK_BYTES — which is also where the
  // numbers below were copied from when this knob was introduced.
} as const;

/**
 * The embedder `embedder.kind` can name — one since 2026-09-24, when the Voyage
 * seat was removed. `"voyage"` in a configuration is read as this, with a note
 * in `retired` (see `loadConfig`).
 */
export type EmbedderKind = "static";
export const EMBEDDER_KINDS: readonly EmbedderKind[] = ["static"];

export interface AdapterConfig {
  /** Where the memory lives. Pinned onto the child's environment LAST. */
  readonly dataDir?: string;
  /** The host's reported injection ceiling, in bytes. NO DEFAULT (scar §2.18). */
  readonly injectionBudgetBytes?: number;
  /** How long the host lets a foreground hook run, ms. Reported, not assumed. */
  readonly executionCeilingMs?: number;
  /** How long a socket survives in this host, ms. The reason E3 rescoped here. */
  readonly socketLifetimeMs?: number;
  /** The detached worker's watchdog, ms. */
  readonly watchdogMs?: number;
  /**
   * RECALL BY MEANING — the local potion-base-8M table (`core/embed/static.ts`):
   * no key, no network, nothing leaves the machine. Its weights come from
   * `COUNTERPARTS_STATIC_WEIGHTS_DIR` or the installed `counterparts-model-potion`
   * package.
   *
   * An ABSENT block reads as the table, on (`resolveEmbedder`, roadmap C3);
   * `{ "enabled": false }` is how somebody says no. `kind` has one value,
   * `"static"`, and may be left out. It had a second — `"voyage"`, a paid remote
   * seat — until 2026-09-24; a configuration that still names it gets the local
   * table and a note in `retired`. Any OTHER kind on an enabled block is still
   * unreadable rather than guessed at.
   */
  readonly embedder?: { readonly enabled: boolean; readonly kind?: EmbedderKind };
  /**
   * THE PARALLEL-RUN KNOB, and it defaults to ABSENT.
   *
   * Absent ⇒ v2 delivers on every delivering hook, which is what it does in
   * every other situation and what every test that does not name this flag
   * asserts. Present and true ⇒ every delivering hook first asks
   * `primacy.ts` whether the OTHER system is speaking today, and stands down if
   * the answer is anything but a clean "engram" (parallel-run G3). It is a knob
   * rather than an inference for the same reason the egress knob is: the
   * presence of v1's file on the machine must not be the thing that decides
   * whether v2 speaks. RETIRED at PROMOTE.
   */
  readonly parallel?: { readonly enabled: boolean };
  /**
   * THE DAILY ROTATING SNAPSHOT (owner ruling 3, 2026-09-18).
   *
   * All three sub-keys are optional and the block as a whole may be absent: the
   * worker then keeps the newest `DEFAULT_KEEP` copies in a `snapshots/`
   * directory beside the store. `dir` names one explicitly — required when the
   * store is not the `store/` subdirectory of a base directory this package
   * created, because in that case there is no base directory to put copies
   * beside and helping ourselves to a sibling of somebody's own directory is not
   * this package's to do (`adapters/snapshots.ts#resolveSnapshotsDir`).
   *
   * `mirror` is a second location that receives the same copy and rotates on its
   * own terms; a mirror failure is reported and never fatal.
   *
   * **THIS ONE BLOCK IS READ LENIENTLY, AND IT IS THE ONLY ONE** (F2 review,
   * MAJOR-2, coordinator's ruling 2026-09-18). Everything else in this file
   * stands the whole configuration down to observer on a value it cannot read,
   * and that is right for a knob whose wrong answer would make the adapter act:
   * an egress switch, a path this package opens. It is wrong here. Measured on
   * the branch: `"keep": 0` — or `"14"` with quotes, which is the likelier typo
   * — returned `{ observer: true }` with `dataDir` GONE, so from the next hook on
   * nothing was captured, nothing recalled, no row written, and the one stderr
   * line a hook produces goes nowhere (I32). A backup preference is not worth
   * memory. Each bad field falls back to its default, `ignored` records which and
   * why, and doctor's Snapshot line says it out loud.
   */
  readonly snapshots?: {
    readonly dir?: string;
    readonly keep?: number;
    readonly mirror?: string;
    /**
     * What this file could not read inside the block, phrased for a person —
     * "snapshots.keep was 0; using 14". Empty is absent. It is a REPORT, not a
     * stance: nothing here changes what the adapter does beyond the default it
     * fell back to, and doctor is what puts it in front of somebody.
     */
    readonly ignored?: readonly string[];
  };
  /**
   * THE NIGHTLY PAGE WRITER (2026-09-20, S2), and it defaults to `session`.
   *
   * `session` — the plan's fallback, and the one that needs no background
   * process: the first session of the next day is asked, beside its wake, to
   * revise the page from the day just gone. `host` — the owner's pick: a
   * windowless `claude -p` started by the boundary's worker, woken by the
   * ordinary SessionStart hook, with one pre-approved tool. `off` — nothing
   * runs and nothing is written.
   *
   * **Absent means `session`, not off**, and that is a deliberate choice rather
   * than an oversight: S2 is how a new user's page forms at all (plan §3), and
   * a mechanism that only works for people who found a configuration key is not
   * the product. The cost of the default being wrong is one extra block beside
   * the wake, at most twice a day, deferred rather than truncated when the
   * ceiling has no room for it — and `"mode": "off"` is one line.
   *
   * **Read LENIENTLY**, the second of the two blocks here that are (S2 review,
   * 2026-09-20). It was written strict — `host` starts a process — and the
   * argument does not hold on its own terms: `mode` is an exact-string
   * allowlist, so a typo cannot resolve to `host` under a lenient reading
   * either. Strictness bought nothing and cost the owner his memory for one
   * misspelling in an optional block. The fallback is PINNED to `session`, each
   * bad field names itself in `ignored`, and doctor's Page writer line says so.
   */
  readonly pageWriter?: {
    readonly mode: PageWriterMode;
    /** The watchdog for that child, ms. Absent ⇒ `TUNABLES.PAGE_WRITER_MS`. */
    readonly timeoutMs?: number;
    /** What this file could not read inside the block, phrased for a person.
     *  Empty is absent. A REPORT, not a stance — doctor is what puts it in
     *  front of somebody. */
    readonly ignored?: readonly string[];
  };
  /**
   * SETTINGS THIS BUILD NO LONGER READS, phrased for a person — e.g.
   * `"credentialsFile" is no longer used …`. Present only when the file named
   * one. A REPORT, not a stance: the setting was ignored and nothing else
   * changed. Doctor prints it as a quiet note, never a warning — a key the
   * owner's configuration still carries from an older install is not a fault.
   */
  readonly retired?: readonly string[];
  /** Is this the owner's own session? Withholding is the safe direction. */
  readonly owner?: boolean;
  /** An instrument stands down. Fail direction: an unreadable config lands here. */
  readonly observer?: boolean;
  /** The identity core's name is the OWNER's; there is no default. */
  readonly identity?: { readonly name: string; readonly aliases?: readonly string[] };
}

export interface LoadedConfig {
  readonly config: AdapterConfig;
  readonly ok: boolean;
  readonly reason: "loaded" | "absent" | "unreadable";
  /**
   * The keys that made it unreadable, where the reader can name them (today:
   * `embedder.enabled`, `embedder.kind`). Absent when it cannot, or when
   * nothing was wrong. A reason that names its key is one a person can fix
   * without reading this file.
   */
  readonly unreadableKeys?: readonly string[];
}

/**
 * Read the host's configuration object. Never throws, and FAILS TOWARD STANDING
 * DOWN: anything unreadable resolves to observer, because "encode anyway" on a
 * configuration we could not read is how an instrument writes to a live store
 * (observer-mode G5, scar E7).
 */
export function loadConfig(raw: unknown): LoadedConfig {
  if (raw === undefined || raw === null) {
    return { config: {}, ok: true, reason: "absent" };
  }
  if (typeof raw !== "object" || Array.isArray(raw)) {
    return { config: { observer: true }, ok: false, reason: "unreadable" };
  }
  const rec = raw as Record<string, unknown>;
  const out: {
    dataDir?: string;
    injectionBudgetBytes?: number;
    executionCeilingMs?: number;
    socketLifetimeMs?: number;
    watchdogMs?: number;
    embedder?: { enabled: boolean; kind?: EmbedderKind };
    parallel?: { enabled: boolean };
    snapshots?: { dir?: string; keep?: number; mirror?: string; ignored?: string[] };
    pageWriter?: { mode: PageWriterMode; timeoutMs?: number; ignored?: string[] };
    retired?: string[];
    owner?: boolean;
    observer?: boolean;
    identity?: { name: string; aliases?: readonly string[] };
  } = {};
  let unreadable = false;
  const badKeys: string[] = [];
  // The settings the keyless build dropped (2026-09-24). Each is IGNORED and
  // named — never a reason to stand the configuration down, because the owner's
  // own live configuration carries `credentialsFile` from the install that
  // wrote it, and an old key must not cost anybody their memory.
  const retired: string[] = [];

  const num = (key: string): number | undefined => {
    const value = rec[key];
    if (value === undefined) return undefined;
    if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
      unreadable = true;
      return undefined;
    }
    return value;
  };

  if (typeof rec["dataDir"] === "string") out.dataDir = rec["dataDir"];
  else if (rec["dataDir"] !== undefined) unreadable = true;

  if (rec["credentialsFile"] !== undefined) {
    const named = typeof rec["credentialsFile"] === "string" ? ` (${rec["credentialsFile"]})` : "";
    retired.push(
      `"credentialsFile" is no longer used — Counterparts reads no API keys; the file it names${named} can be deleted`,
    );
  }
  if (rec["models"] !== undefined) {
    retired.push(`"models" is no longer used — there is no model seat to configure; it was ignored`);
  }
  if (rec["crashWriteUp"] !== undefined && rec["crashWriteUp"] !== "next-session") {
    retired.push(
      `"crashWriteUp" is no longer used — a session that ended before it was written up is always written up by the next session in its project`,
    );
  }
  // The Stop ask's switch (B1, 2026-09-23), retired the next day when the ask
  // moved to the host's non-error route (`bin/hook.ts#HOST_STOP`). Any value —
  // the owner's own configuration says `"stderr"` — is read, ignored and named.
  if (rec["stopAskShape"] !== undefined) {
    retired.push(`"stopAskShape" is no longer used — the end-of-session ask has one shape now, shown as hook feedback`);
  }

  const injection = num("injectionBudgetBytes");
  if (injection !== undefined) out.injectionBudgetBytes = injection;
  const exec = num("executionCeilingMs");
  if (exec !== undefined) out.executionCeilingMs = exec;
  const socket = num("socketLifetimeMs");
  if (socket !== undefined) out.socketLifetimeMs = socket;
  const watchdog = num("watchdogMs");
  if (watchdog !== undefined) out.watchdogMs = watchdog;

  if (rec["owner"] !== undefined) {
    if (typeof rec["owner"] !== "boolean") unreadable = true;
    else out.owner = rec["owner"];
  }
  if (rec["observer"] !== undefined) {
    if (typeof rec["observer"] !== "boolean") unreadable = true;
    else out.observer = rec["observer"];
  }
  const embedder = rec["embedder"];
  if (embedder !== undefined) {
    // The egress knob is read STRICTLY. A misspelled or half-written `embedder`
    // block must not resolve to "on" by accident, and the unreadable rule below
    // sends the whole configuration to observer rather than guessing.
    // `kind` is read INSIDE the object check (re-review MINOR A): `"embedder":
    // null` reached `e["kind"]` first and threw, which stood a hook down with a
    // TypeError and crashed doctor. Now it is what every other malformed block
    // is — unreadable, the whole configuration to observer, the key named.
    const e = (typeof embedder === "object" && embedder !== null && !Array.isArray(embedder)
      ? embedder
      : {}) as Record<string, unknown>;
    // `"voyage"` NAMED THE REMOVED SEAT (2026-09-24): read as the local table,
    // and said so, rather than standing the configuration down over a choice
    // this build no longer offers.
    const voyage = e["kind"] === "voyage";
    if (voyage) {
      retired.push(`"embedder.kind" "voyage" is no longer available — recall by meaning uses the local table, where nothing leaves this machine`);
    }
    const kind = voyage ? "static" : e["kind"];
    const kindOk = kind === undefined || (typeof kind === "string" && (EMBEDDER_KINDS as readonly string[]).includes(kind));
    if (typeof embedder !== "object" || embedder === null || Array.isArray(embedder)) {
      unreadable = true;
      badKeys.push("embedder");
    } else if (typeof e["enabled"] !== "boolean") {
      unreadable = true;
      badKeys.push("embedder.enabled");
    } else if (e["enabled"] === false) {
      // OFF MEANS OFF, WHATEVER `kind` SAYS (review of #190, MINOR 5). A typo in
      // a knob that is switched off must not stand every memory down: `kind`
      // chooses an embedder, and with none running there is nothing for it to
      // choose. A valid kind is kept; an invalid one is dropped.
      out.embedder = { enabled: false, ...(kind !== undefined && kindOk ? { kind: kind as EmbedderKind } : {}) };
    } else if (!kindOk) {
      // On, and naming no embedder this build knows: unreadable, never a
      // default.
      unreadable = true;
      badKeys.push("embedder.kind");
    } else {
      out.embedder = { enabled: e["enabled"], ...(kind === undefined ? {} : { kind: kind as EmbedderKind }) };
    }
  }
  const parallel = rec["parallel"];
  if (parallel !== undefined) {
    // Read as strictly as the egress knob, and for the same reason: a
    // half-written `parallel` block must not resolve to "on" — and, this being
    // the mute switch, it must not resolve to "off" by accident either. An
    // unreadable one takes the whole configuration to observer below.
    const p = parallel as Record<string, unknown>;
    if (typeof parallel !== "object" || parallel === null || Array.isArray(parallel) || typeof p["enabled"] !== "boolean") {
      unreadable = true;
    } else {
      out.parallel = { enabled: p["enabled"] };
    }
  }
  // THE SECOND LENIENT BLOCK, and it became one under review (S2, 2026-09-20).
  //
  // It was written strict, beside the egress knob, on the argument that `host`
  // STARTS A PROCESS and a half-written block must not resolve to it. The
  // adversarial review took that argument apart on its own terms: `mode` is
  // matched against an exact-string allowlist, so a typo cannot resolve to
  // `host` under a lenient reading either — it can only resolve to the
  // fallback. Strictness bought no protection against the stated risk and cost
  // the owner his memory for one misspelling in an OPTIONAL block:
  // `{"mode": "sesion"}` stood the whole configuration down to observer,
  // `dataDir` went with it, and every session in that directory silently
  // stopped remembering with one doctor line about the file as a whole.
  // That is precisely the failure the F2 ruling moved `snapshots` out of
  // strictness to avoid.
  //
  // So it falls back, and **the fallback is pinned to `session` and can never
  // be `host`** — which is the one protection strictness was for, kept. Each
  // bad field names itself in `ignored`, and doctor's Page writer line prints
  // it. Nothing in here ever sets `unreadable`.
  const pageWriter = rec["pageWriter"];
  if (pageWriter !== undefined) {
    out.pageWriter = readPageWriter(pageWriter);
    // THE CHILD'S COMMAND IS NOT CONFIGURABLE ANY MORE (2026-09-24): a
    // configuration file that could name the program the worker starts was a
    // "runs a command named by config" finding. The writer always starts
    // `claude` (`page-writer.ts#DEFAULT_HOST_COMMAND`); an old key is ignored.
    const w = pageWriter as Record<string, unknown> | null;
    if (typeof w === "object" && w !== null && !Array.isArray(w) && w["command"] !== undefined) {
      retired.push(`"pageWriter.command" is no longer used — the page writer always starts claude`);
    }
  }
  // THE FIRST LENIENT BLOCK. See the `snapshots` knob above for why: a backup
  // preference that could not be read must cost the backup preference and
  // nothing else. Nothing in here ever sets `unreadable`.
  const snapshots = rec["snapshots"];
  if (snapshots !== undefined) {
    out.snapshots = readSnapshots(snapshots);
  }
  const identity = rec["identity"];
  if (identity !== undefined) {
    const i = identity as Record<string, unknown>;
    if (typeof i?.["name"] === "string" && i["name"].trim().length > 0) {
      const aliases = i["aliases"];
      out.identity = {
        name: i["name"],
        ...(Array.isArray(aliases)
          ? { aliases: aliases.filter((a): a is string => typeof a === "string") }
          : {}),
      };
    } else {
      unreadable = true;
    }
  }

  if (unreadable) {
    // Everything we did read is discarded along with the stance: a partially
    // understood configuration is not a configuration.
    return {
      config: { observer: true },
      ok: false,
      reason: "unreadable",
      ...(badKeys.length === 0 ? {} : { unreadableKeys: badKeys }),
    };
  }
  // A longer line cap than the lenient blocks': these phrases are this file's
  // own words plus, at most, the one path the owner wrote.
  if (retired.length > 0) out.retired = tidy(retired, RETIRED_LINE_CHARS);
  return { config: out, ok: true, reason: "loaded" };
}

/**
 * THE FALLBACK MODE, and it is never `host`.
 *
 * A block this could not read resolves to the mode that needs no background
 * process and no watchdog. "Fall back to the safe thing" and
 * "fall back to the default" happen to be the same value today; they are
 * written as one constant so they stay the same value if the default moves.
 */
export const PAGE_WRITER_FALLBACK_MODE: PageWriterMode = "session";

/**
 * The `pageWriter` block, read leniently — every rejection names the field,
 * what was in it, and what is being used instead.
 */
function readPageWriter(raw: unknown): {
  mode: PageWriterMode;
  timeoutMs?: number;
  ignored?: string[];
} {
  const raws: string[] = [];
  const out: { mode: PageWriterMode; timeoutMs?: number } = {
    mode: PAGE_WRITER_FALLBACK_MODE,
  };
  const done = (): typeof out & { ignored?: string[] } =>
    raws.length === 0 ? out : { ...out, ignored: tidy(raws) };
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    raws.push(`"pageWriter" was not an object; using mode ${PAGE_WRITER_FALLBACK_MODE}`);
    return done();
  }
  const w = raw as Record<string, unknown>;
  const mode = w["mode"];
  if (typeof mode === "string" && (PAGE_WRITER_MODES as readonly string[]).includes(mode)) {
    out.mode = mode as PageWriterMode;
  } else if (mode !== undefined) {
    raws.push(
      `"pageWriter.mode" was ${JSON.stringify(mode)}, which is not ${PAGE_WRITER_MODES.join(", ")}; using ${PAGE_WRITER_FALLBACK_MODE}`,
    );
  }
  const timeoutMs = w["timeoutMs"];
  if (typeof timeoutMs === "number" && Number.isFinite(timeoutMs) && timeoutMs > 0) {
    out.timeoutMs = timeoutMs;
  } else if (timeoutMs !== undefined) {
    raws.push(`"pageWriter.timeoutMs" was ${JSON.stringify(timeoutMs)}; using the default watchdog`);
  }
  // A key nobody here knows is named rather than passed over: a person who
  // typed `"modes"` gets told so instead of watching the block do nothing.
  // (`command` is named by `loadConfig`, among the retired settings.)
  for (const key of Object.keys(w)) {
    if (key !== "mode" && key !== "command" && key !== "timeoutMs") {
      raws.push(`"pageWriter.${key}" is not a setting this reads; it was ignored`);
    }
  }
  return done();
}

/**
 * The `snapshots` block, read leniently — the FIRST place in this file that
 * never stands the configuration down.
 *
 * Every rejection here names the field, what was in it, and what is being used
 * instead, because "ignored silently" is the failure mode this block was moved
 * out of strictness to avoid. `adapters/snapshots.ts#keepOf` owns the numeric
 * fallback and is not restated; the two paths fall back to "no configured path",
 * which means the default location beside the store.
 */
/** How much of one ignored line, and how many lines, ever leave this function. */
const IGNORED_LINE_CHARS = 120;
const IGNORED_LINES = 8;
/** The cap for a `retired` line (see `loadConfig`). */
const RETIRED_LINE_CHARS = 240;

/**
 * The `ignored` phrases, made safe to print.
 *
 * They are built from the owner's own configuration file, and they end up on a
 * doctor line in his terminal. A key carrying ANSI escapes was measured reaching
 * that terminal raw, and a 200,000-character value made a 200,000-character line
 * (second F2 review, MINOR-d). Control characters go, each line is capped, and
 * the list is capped — sanitized HERE, at the one place the phrases are made,
 * rather than at each of the surfaces that print them.
 */
function tidy(lines: readonly string[], lineChars: number = IGNORED_LINE_CHARS): string[] {
  const clean = lines.map((line) => {
    const stripped = line.replace(/[\u0000-\u001f\u007f]/g, "");
    return stripped.length > lineChars ? `${stripped.slice(0, lineChars - 1)}…` : stripped;
  });
  if (clean.length <= IGNORED_LINES) return clean;
  return [
    ...clean.slice(0, IGNORED_LINES),
    `and ${String(clean.length - IGNORED_LINES)} more`,
  ];
}

function readSnapshots(raw: unknown): {
  dir?: string;
  keep?: number;
  mirror?: string;
  ignored?: string[];
} {
  const raws: string[] = [];
  const ignored = (line: string): void => {
    raws.push(line);
  };
  const out: { dir?: string; keep?: number; mirror?: string; ignored?: string[] } = {};
  const done = (): typeof out =>
    raws.length === 0 ? out : { ...out, ignored: tidy(raws) };
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    ignored('"snapshots" was not an object; the whole block was ignored');
    return done();
  }
  const sn = raw as Record<string, unknown>;
  const known = new Set(["dir", "keep", "mirror"]);
  for (const key of Object.keys(sn)) {
    // An unknown sub-key is REPORTED rather than dropped in silence: a typo'd
    // `"mirrors"` that quietly did nothing is how somebody believes they have a
    // second copy and does not.
    if (!known.has(key)) ignored(`"snapshots.${key}" is not a setting this reads`);
  }
  for (const key of ["dir", "mirror"] as const) {
    const value = sn[key];
    if (value === undefined) continue;
    if (typeof value !== "string") {
      ignored(`"snapshots.${key}" was not a path; using the default location`);
      continue;
    }
    if (value.trim().length === 0) {
      // Blank meaning "the default" was measured as a surprise: somebody who
      // blanks the value to switch snapshots OFF gets the default location.
      ignored(`"snapshots.${key}" was blank; using the default location`);
      continue;
    }
    if (!isAbsolute(value)) {
      // A relative path resolves against the WORKER's current directory, which
      // is whatever directory the host session happened to be in — copies would
      // scatter one per project and rotation would run inside each.
      ignored(`"snapshots.${key}" must be an absolute path; using the default location`);
      continue;
    }
    out[key] = value;
  }
  const keep = sn["keep"];
  if (keep !== undefined) {
    if (typeof keep !== "number" || !Number.isInteger(keep) || keep <= 0) {
      ignored(
        `"snapshots.keep" was ${JSON.stringify(keep)}; using ${String(SNAPSHOT_DEFAULT_KEEP)}`,
      );
    } else {
      out.keep = keep;
    }
  }
  return done();
}

/**
 * WHICH MODE THE NIGHTLY PAGE WRITER RUNS IN — the one place the default lives.
 *
 * Absent ⇒ `session`: the fallback that needs no background process, so a store
 * a stranger installed grows a page without them configuring anything. An
 * observer is `off` whatever the file says, for the reason every stance check
 * in this package gives: an instrument does not set writers going against a
 * store it may not write.
 */
export function pageWriterMode(config: AdapterConfig): PageWriterMode {
  if (config.observer === true) return "off";
  return config.pageWriter?.mode ?? "session";
}

/**
 * The capability report — one row per host-dependent limit, each saying whether
 * the host actually reported it. This is the "surfaced as a checkable value"
 * half of §4 G4; the "exceeding one is an event" half lives at the call sites.
 */
export function capabilities(config: AdapterConfig): CapabilityReport[] {
  return [
    {
      name: "injectionBudgetBytes",
      reported: config.injectionBudgetBytes !== undefined,
      value: config.injectionBudgetBytes ?? null,
      why: "The host's injection cliff. v1 hardcoded 90% of one host's, as though it were physiology.",
    },
    {
      name: "executionCeilingMs",
      reported: config.executionCeilingMs !== undefined,
      value: config.executionCeilingMs ?? null,
      why: "How long a foreground hook may run before the host gives up on it.",
    },
    {
      name: "socketLifetimeMs",
      reported: config.socketLifetimeMs !== undefined,
      value: config.socketLifetimeMs ?? null,
      why: "Why long calls stream (scar E3, rescoped to the adapter that owns the host).",
    },
  ];
}

/** Where an effective embedder block came from (`resolveEmbedder`). */
export type EmbedderSource =
  /** The configuration names one — on or off, either kind. Used as written. */
  | "explicit"
  /** No block: the local table, switched on. */
  | "default-static"
  /** No block, and the configuration is an observer's: nothing is assumed. */
  | "absent-observer";

/** The local table, switched on — the block an absent one reads as. */
export const DEFAULT_EMBEDDER: { readonly enabled: true; readonly kind: "static" } = {
  enabled: true,
  kind: "static",
};

/**
 * THE RUNTIME DEFAULT FOR AN ABSENT `embedder` BLOCK (roadmap C3, coordinator's
 * ruling 2026-09-23).
 *
 * Absent used to mean OFF, for a privacy reason: the only embedder was a paid
 * third party. The local table has no egress, so that reason is gone — and a
 * configuration written before C3 has no block at all. So:
 *
 *   - **A block the file writes is used exactly as written** (`explicit`),
 *     `{ "enabled": false }` included — that is how somebody says no.
 *   - **No block** → `{ enabled: true, kind: "static" }`.
 *   - **An observer** gets nothing assumed — it opens no embedder anyway, and
 *     an unreadable configuration resolves to one.
 *
 * (Until 2026-09-24 a saved Voyage key kept an absent block off; there are no
 * keys any more, so there is no such exception.) `loadConfig` stays strict and
 * pure; every entry point applies this after it.
 */
export function resolveEmbedder(
  config: AdapterConfig,
): { block: { enabled: boolean; kind?: EmbedderKind } | undefined; source: EmbedderSource } {
  if (config.embedder !== undefined) return { block: config.embedder, source: "explicit" };
  if (config.observer === true) return { block: undefined, source: "absent-observer" };
  return { block: { ...DEFAULT_EMBEDDER }, source: "default-static" };
}

/** The configuration with its effective embedder block — `resolveEmbedder`,
 *  applied. What each entry point hands on after reading its configuration. */
export function withEmbedderDefault(config: AdapterConfig): AdapterConfig {
  const { block, source } = resolveEmbedder(config);
  return source === "explicit" || block === undefined ? config : { ...config, embedder: block };
}
