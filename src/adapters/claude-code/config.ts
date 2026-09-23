/**
 * The adapter's configuration and its CAPABILITY REPORT.
 *
 * This file is where scar §2.18 lives — "a guarantee carried by something you
 * don't own is not a guarantee". v1 encoded one host's 9,000-byte injection
 * cliff as though it were physiology, discovered its socket ceiling by watching
 * calls die, and inherited a credential from whatever shell happened to launch
 * the session. All three are host facts. Here they are named, reported, and
 * CHECKABLE — and the core is told what they are rather than assuming them.
 *
 * Two rules the CONTRACT states and this file mechanizes:
 *
 *   §4 G4 — every host-dependent limit is discovered or asserted at runtime and
 *   surfaced as a checkable value. `capabilities()` returns one row per limit
 *   with `reported: false` where the host said nothing, so "we never asked" and
 *   "the host said zero" are different records (scar §2.4).
 *
 *   §4 (drops) / scar §2.15 — every model SEAT has its own knob, holds a pinned
 *   identifier, and a placeholder EXPIRES. v1's single `models.maintainer` knob
 *   fed three call sites, so a decision that had been made could not be
 *   implemented; and its inert placeholder became production by silence.
 *
 * And one from observer-mode G5: an unreadable configuration resolves to
 * OBSERVER, never to "encode anyway". `loadConfig` never throws.
 */
import { isAbsolute } from "node:path";

import { PAGE_WRITER_MODES } from "../../core/self/index.js";
import type { PageWriterMode } from "../../core/self/index.js";
import { DEFAULT_KEEP as SNAPSHOT_DEFAULT_KEEP } from "../snapshots.js";

import type { CredentialLoad } from "./credentials.js";


/** Every host-dependent limit this adapter depends on. One row each. */
export const CAPABILITIES = [
  "injectionBudgetBytes",
  "executionCeilingMs",
  "socketLifetimeMs",
  "credential",
] as const;
export type CapabilityName = (typeof CAPABILITIES)[number];

export interface CapabilityReport {
  readonly name: CapabilityName;
  /** False when the host told us nothing. Never silently defaulted. */
  readonly reported: boolean;
  readonly value: number | boolean | null;
  readonly why: string;
  /**
   * WHICH SOURCE ANSWERED, name-level only. On the credential row: `"env"` when
   * the process environment carried the name, `"file"` when the configured
   * credentials file filled the gap, `"absent"` when nothing did. Never a value,
   * never a hash of one.
   */
  readonly detail?: string;
}

/**
 * One model seat. `id` is a PINNED identifier held in configuration, never an
 * alias resolved at call time, and never shared with another seat.
 */
export interface ModelSeat {
  readonly id: string;
  /**
   * True while this id is a stand-in nobody has decided on. A placeholder MUST
   * carry `expires`; past that date `seatStatus()` reports `expired`, so
   * "never decided" cannot masquerade as "decided" (scar §2.15c).
   */
  readonly placeholder?: boolean;
  /** ISO date. Required when `placeholder` is true. */
  readonly expires?: string;
}

export type SeatStatus = "pinned" | "placeholder" | "expired" | "unbounded-placeholder";

export interface SeatVerdict {
  readonly seat: string;
  readonly id: string;
  readonly status: SeatStatus;
  readonly usable: boolean;
}

/**
 * The default interpreter seat. It is the crash fallback's only model call, and
 * the fallback is the path that must not lose the day, so it gets the strongest
 * tier rather than the cheapest. PINNED, not an alias — recorded here so the
 * decision has a place, per scar §2.15's first clause.
 */
export const DEFAULT_INTERPRET_MODEL = "claude-opus-5";

/**
 * The default EMBED seat. Its own knob, its own pinned id, its own provider —
 * scar §2.15b is exactly the case where one knob fed several call sites, and an
 * embedding model and an interpreter model are not interchangeable in any sense
 * (different vendor, different credential, different failure mode).
 *
 * PINNED, not an alias: `voyage-3` and `voyage-3-large` are different spaces, and
 * a store's vectors are only comparable to vectors from the generation that
 * wrote them. The id is therefore part of the data's identity, not a preference.
 */
export const DEFAULT_EMBED_MODEL = "voyage-3-large";

/** The Messages API, raw. No SDK, no runtime dependency (constitution 10). */
export const ANTHROPIC_ENDPOINT = "https://api.anthropic.com/v1/messages";
export const ANTHROPIC_VERSION = "2023-06-01";

/** Voyage's embeddings endpoint, raw. Same rule: no SDK, no dependency. */
export const VOYAGE_ENDPOINT = "https://api.voyageai.com/v1/embeddings";

/**
 * The ONE environment variable a credential may come from — and, when the
 * environment is silent, the one file `credentialsFile` NAMES. See that knob for
 * the whole rule; the short form is: the environment first, a file the config
 * names second, a file found by convention never.
 */
export const API_KEY_ENV = "ANTHROPIC_API_KEY";

/**
 * The embedder's ONE environment variable — the same name v1 reads, so an owner
 * who already has a key in their environment does not learn a second name.
 * v1 also accepted a `.env` FILE found by CONVENTION (`resolveVoyageKey`, in
 * whatever directory the process happened to sit in); that half stays dropped.
 * §2.18: the credential comes from one configured source the package names, and
 * a file the process happens to FIND is not one — while a file the package's own
 * configuration NAMES is (`credentialsFile`).
 */
export const EMBED_KEY_ENV = "VOYAGE_API_KEY";

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
  /** Output headroom for the interpreter. A truncated JSON response is a
   *  failure, not data (scar E2) — headroom is how you stop paying for one. */
  MAX_OUTPUT_TOKENS: 16_000,
  /** Reference resolution at a session-ending boundary (recall §9.2), ms. The
   *  resolver stops between candidates past it and the row says so
   *  (`recall.credit` reason `budget-exceeded`); nothing is truncated silently. */
  CREDIT_BUDGET_MS: 150,
  /** Identical consecutive spawn failures before the worker ESCALATES instead
   *  of re-logging the same line forever (scar E4's widening). */
  ESCALATE_AFTER: 3,
  /** Texts per embeddings request. The provider's documented ceiling, and the
   *  unit of FAILURE ISOLATION: one poisoned input fails its own chunk and
   *  leaves every sibling chunk's vectors standing (scar E1). v1 used the same
   *  128. */
  EMBED_BATCH_SIZE: 128,
  // The Stop ask's pacing is NOT here any more, and that is the point: it was a
  // second pacer beside `self/`'s, and two pacers on one blocked moment is how
  // 13 owner turns drew about a dozen asks (2026-09-04). The one pair lives in
  // `self/tunables.ts` — REASK_TURNS / REASK_BYTES — which is also where the
  // numbers below were copied from when this knob was introduced.
} as const;

/** The two embedders `embedder.kind` can name. See `AdapterConfig.embedder`. */
export type EmbedderKind = "static" | "voyage";
export const EMBEDDER_KINDS: readonly EmbedderKind[] = ["static", "voyage"];

export interface AdapterConfig {
  /** Where the memory lives. Pinned onto the child's environment LAST. */
  readonly dataDir?: string;
  /**
   * THE CREDENTIAL FILE, and it is the source only because THIS FILE NAMES IT.
   *
   * Measured on day 0 of the parallel run: this host's hook processes carry
   * neither documented name, even with both exported in the owner's shell rc —
   * the host's process environment is not the login shell's. So a `process.env`
   * that answers in a terminal answers nothing in a hook: the worker's sweep
   * would skip itself at every boundary and the embedder would never open.
   *
   * The rules, mechanized in `credentials.ts`:
   *
   *   - the file is `KEY=value` lines (`export KEY=value`, quotes and CRLF
   *     tolerated; blank and `#` lines skipped);
   *   - ONLY the two documented names are honored — `API_KEY_ENV` and
   *     `EMBED_KEY_ENV`. Anything else in the file is IGNORED AND COUNTED;
   *   - a value already present in `process.env` WINS. The environment stays the
   *     first source; the file only fills the gap;
   *   - values are never logged, never emitted, never hashed. Names and counts
   *     are the only things that leave.
   *
   * §2.18 permits exactly this and no more: "credentials come from one
   * configured source the package owns". A file the package's own configuration
   * NAMES is that source. A file found by CONVENTION — v1's `.env` in whatever
   * directory the process sat in — is not, and stays forbidden.
   */
  readonly credentialsFile?: string;
  /** The host's reported injection ceiling, in bytes. NO DEFAULT (scar §2.18). */
  readonly injectionBudgetBytes?: number;
  /** How long the host lets a foreground hook run, ms. Reported, not assumed. */
  readonly executionCeilingMs?: number;
  /** How long a socket survives in this host, ms. The reason E3 rescoped here. */
  readonly socketLifetimeMs?: number;
  /** The detached worker's watchdog, ms. */
  readonly watchdogMs?: number;
  /** One knob per seat (scar §2.15b). Two seats, two knobs, two providers. */
  readonly models?: { readonly interpret?: ModelSeat; readonly embed?: ModelSeat };
  /**
   * THE EGRESS KNOB, and it defaults to OFF.
   *
   * Embedding means sending the text of a memory to a third party. v2's
   * "no-silent-egress" rescope (2026-08-25) is the reason this is a decision the
   * owner makes rather than a capability a key in the environment switches on:
   * a `VOYAGE_API_KEY` exported for some other tool must never be the thing that
   * starts shipping this store's contents anywhere. Absent ⇒ no client is built,
   * no socket is opened, and the brain runs exactly as it does today — blind,
   * and countably so (`novelty.reason = "no-chunk-vector"`).
   *
   * `kind` (roadmap C1, 2026-09-23) picks WHICH embedder `enabled` switches on:
   *
   *   - `"voyage"` — the paid remote seat (`models.embed`, `VOYAGE_API_KEY`).
   *     ABSENT `kind` MEANS THIS, so every configuration written before the
   *     field existed behaves exactly as it did.
   *   - `"static"` — the local potion-base-8M table (`core/embed/static.ts`):
   *     no key, no network, no egress, so `enabled` is not an egress decision
   *     for it — it is only "use the semantic channel". Its weights come from
   *     `COUNTERPARTS_STATIC_WEIGHTS_DIR` or the installed
   *     `counterparts-model-potion` package.
   *
   * Read as strictly as `enabled`: a `kind` that is present and not one of the
   * two stands the whole configuration down, rather than guessing which
   * provider a typo meant — one guess sends memory text to a third party.
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
    /**
     * The host CLI to launch in `host` mode. Absent ⇒ `claude`, resolved on the
     * child's PATH. Named here because the one machine this has to work on is
     * the owner's, and because a test proves the whole path against a stub.
     */
    readonly command?: string;
    /** The watchdog for that child, ms. Absent ⇒ `TUNABLES.PAGE_WRITER_MS`. */
    readonly timeoutMs?: number;
    /** What this file could not read inside the block, phrased for a person.
     *  Empty is absent. A REPORT, not a stance — doctor is what puts it in
     *  front of somebody. */
    readonly ignored?: readonly string[];
  };
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
    credentialsFile?: string;
    injectionBudgetBytes?: number;
    executionCeilingMs?: number;
    socketLifetimeMs?: number;
    watchdogMs?: number;
    models?: { interpret?: ModelSeat; embed?: ModelSeat };
    embedder?: { enabled: boolean; kind?: EmbedderKind };
    parallel?: { enabled: boolean };
    snapshots?: { dir?: string; keep?: number; mirror?: string; ignored?: string[] };
    pageWriter?: { mode: PageWriterMode; command?: string; timeoutMs?: number; ignored?: string[] };
    owner?: boolean;
    observer?: boolean;
    identity?: { name: string; aliases?: readonly string[] };
  } = {};
  let unreadable = false;

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

  // Validated exactly like `dataDir`, and for the same reason: a path this
  // package will OPEN is either a string the owner wrote or a configuration we
  // did not understand, and the second one stands down rather than guessing.
  if (typeof rec["credentialsFile"] === "string") out.credentialsFile = rec["credentialsFile"];
  else if (rec["credentialsFile"] !== undefined) unreadable = true;

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
  // One parser, both seats: a second spelling of "what a seat is" is how the two
  // knobs drift apart while both look configured (scar §2.15b).
  const readSeat = (raw: unknown): ModelSeat | undefined => {
    if (raw === undefined) return undefined;
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
      unreadable = true;
      return undefined;
    }
    const s = raw as Record<string, unknown>;
    if (typeof s["id"] !== "string" || s["id"].length === 0) {
      unreadable = true;
      return undefined;
    }
    const parsed: { id: string; placeholder?: boolean; expires?: string } = { id: s["id"] };
    if (s["placeholder"] === true) parsed.placeholder = true;
    if (typeof s["expires"] === "string") parsed.expires = s["expires"];
    return parsed;
  };

  const models = rec["models"];
  if (models !== undefined) {
    if (typeof models !== "object" || models === null || Array.isArray(models)) {
      unreadable = true;
    } else {
      const interpret = readSeat((models as Record<string, unknown>)["interpret"]);
      const embed = readSeat((models as Record<string, unknown>)["embed"]);
      if (interpret !== undefined || embed !== undefined) {
        out.models = {
          ...(interpret === undefined ? {} : { interpret }),
          ...(embed === undefined ? {} : { embed }),
        };
      }
    }
  }
  const embedder = rec["embedder"];
  if (embedder !== undefined) {
    // The egress knob is read STRICTLY. A misspelled or half-written `embedder`
    // block must not resolve to "on" by accident, and the unreadable rule below
    // sends the whole configuration to observer rather than guessing.
    const e = embedder as Record<string, unknown>;
    const kind = e["kind"];
    if (typeof embedder !== "object" || embedder === null || Array.isArray(embedder) || typeof e["enabled"] !== "boolean") {
      unreadable = true;
    } else if (kind !== undefined && !(typeof kind === "string" && (EMBEDDER_KINDS as readonly string[]).includes(kind))) {
      // Present and not one of the two: unreadable, never a default.
      unreadable = true;
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
    return { config: { observer: true }, ok: false, reason: "unreadable" };
  }
  return { config: out, ok: true, reason: "loaded" };
}

/**
 * THE FALLBACK MODE, and it is never `host`.
 *
 * A block this could not read resolves to the mode that needs no background
 * process, no credential and no watchdog. "Fall back to the safe thing" and
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
  command?: string;
  timeoutMs?: number;
  ignored?: string[];
} {
  const raws: string[] = [];
  const out: { mode: PageWriterMode; command?: string; timeoutMs?: number } = {
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
  const command = w["command"];
  if (typeof command === "string" && command.trim().length > 0) out.command = command.trim();
  else if (command !== undefined) {
    raws.push(`"pageWriter.command" was ${JSON.stringify(command)}; using the default host command`);
  }
  const timeoutMs = w["timeoutMs"];
  if (typeof timeoutMs === "number" && Number.isFinite(timeoutMs) && timeoutMs > 0) {
    out.timeoutMs = timeoutMs;
  } else if (timeoutMs !== undefined) {
    raws.push(`"pageWriter.timeoutMs" was ${JSON.stringify(timeoutMs)}; using the default watchdog`);
  }
  // A key nobody here knows is named rather than passed over: a person who
  // typed `"modes"` gets told so instead of watching the block do nothing.
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
function tidy(lines: readonly string[]): string[] {
  const clean = lines.map((line) => {
    const stripped = line.replace(/[\u0000-\u001f\u007f]/g, "");
    return stripped.length > IGNORED_LINE_CHARS
      ? `${stripped.slice(0, IGNORED_LINE_CHARS - 1)}…`
      : stripped;
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
 * The capability report — one row per host-dependent limit, each saying whether
 * the host actually reported it. This is the "surfaced as a checkable value"
 * half of §4 G4; the "exceeding one is an event" half lives at the call sites.
 *
 * The credential row also says WHICH SOURCE ANSWERED. `load` is the result of
 * this process's `loadCredentials` call, passed in rather than looked up: the
 * provenance of a credential is a fact about one process's startup, and a module
 * that remembered it globally would leak between the runs of a test suite and
 * lie about which source answered.
 */
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

export function capabilities(
  config: AdapterConfig,
  env: NodeJS.ProcessEnv = process.env,
  load?: CredentialLoad,
): CapabilityReport[] {
  const key = env[API_KEY_ENV];
  const present = key !== undefined && key.trim().length > 0;
  // Name-level only. "Which source" is the whole answer; the value never
  // reaches this function's output in any form.
  const source = !present ? "absent" : load?.loaded.includes(API_KEY_ENV) === true ? "file" : "env";
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
    {
      name: "credential",
      reported: key !== undefined,
      value: present,
      why: "The detached worker starved for two days on a credential it expected to inherit (scar E4).",
      detail: source,
    },
  ];
}

/** The seat, and whether its identifier is a decision or a silence. */
export function seatStatus(
  name: string,
  seat: ModelSeat | undefined,
  today: string,
  /** The pinned id this seat falls back to when the host configured none. */
  fallbackId: string = DEFAULT_INTERPRET_MODEL,
): SeatVerdict {
  const resolved: ModelSeat = seat ?? { id: fallbackId };
  if (resolved.placeholder !== true) {
    return { seat: name, id: resolved.id, status: "pinned", usable: true };
  }
  if (resolved.expires === undefined) {
    // A placeholder with no expiry is precisely the thing that becomes
    // production by silence. It is refused, not warned about.
    return { seat: name, id: resolved.id, status: "unbounded-placeholder", usable: false };
  }
  if (today > resolved.expires) {
    return { seat: name, id: resolved.id, status: "expired", usable: false };
  }
  return { seat: name, id: resolved.id, status: "placeholder", usable: true };
}

/** The interpreter seat, resolved. One seat, one knob (scar §2.15b). */
export function interpretSeat(config: AdapterConfig, today: string): SeatVerdict {
  return seatStatus("interpret", config.models?.interpret, today);
}

/** The embedder seat, resolved. Its own knob, its own pinned default. */
export function embedSeat(config: AdapterConfig, today: string): SeatVerdict {
  return seatStatus("embed", config.models?.embed, today, DEFAULT_EMBED_MODEL);
}

/**
 * Is the embedder switched on, and is its credential present? Both halves are
 * REPORTED rather than inferred, so "the owner said no" and "the owner said yes
 * and the key is missing" are different records — the second is a refusal worth
 * an event, the first is not (scar §2.4).
 */
export function embedderState(
  config: AdapterConfig,
  env: NodeJS.ProcessEnv = process.env,
): {
  readonly enabled: boolean;
  readonly credential: boolean;
} {
  const key = env[EMBED_KEY_ENV];
  return {
    enabled: config.embedder?.enabled === true,
    credential: key !== undefined && key.trim().length > 0,
  };
}

/**
 * Which embedder `embedder.enabled` switches on. Absent `kind` is `"voyage"`:
 * the one embedder that existed before the field did, so an old configuration
 * reads the way it always has.
 */
export function embedderKind(config: AdapterConfig): EmbedderKind {
  return config.embedder?.kind ?? "voyage";
}
