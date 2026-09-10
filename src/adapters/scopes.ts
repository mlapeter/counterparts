/**
 * THE SCOPE REGISTRY — which directories this memory is for, and in what stance.
 *
 * **The ask (owner, 2026-09-10; `claude-code/INTERFACE-GAPS.md` host gaps 6–8).**
 * The hooks are registered globally, so a directory that has never heard of
 * Counterparts inherits capture, deposit and the wake the first time a session
 * opens in it. Until today the only way to say "not here" was a project
 * `.claude/settings.json` with an `env` block naming a second, observer-stanced
 * `claude-code.json` through `COUNTERPARTS_CONFIG` — a JSON file, a second
 * config file and two environment variables to say one word. Three private
 * directories run that way today and MUST KEEP RUNNING that way: nothing here
 * relaxes a stance, it only ever adds one.
 *
 * **Where it lives: beside the configuration, never inside the store.** A store
 * is memory; this is host state about which directories memory is for, and it
 * has to be readable by a process that has not opened a store yet — the hook
 * decides `off` BEFORE anything opens, which is what makes "no output, no
 * write" structural rather than promised. So the file sits next to
 * `claude-code.json`: under `COUNTERPARTS_CONFIG` or `--config`, beside THAT
 * file, so a scratch install's scopes are that install's own
 * (`scopesPath(choice.path)` at every entry point, and `config-path.ts` is
 * still the one rule for which config).
 *
 * **Longest prefix wins, and the match is segment-aware.** A subdirectory
 * inherits its nearest ancestor's entry, so a project turned off is off in
 * every worktree under it, and `/a/b` never matches `/a/bc` — the same class of
 * bug `assertSafeDataDir` resolves both sides to avoid. Both sides go through
 * `canonicalScope` (`sessions.ts`), which is where the `/tmp` vs `/private/tmp`
 * lesson on this host was already paid for.
 *
 * **Absent, unknown or UNREADABLE all mean `unset`, and `unset` means ON.**
 * That is a deliberate choice and the one the owner is asked to confirm: every
 * directory the parallel run touches is unset today, and a registry that
 * defaulted to observer would silently mute the live run on the day it shipped.
 * The fail direction for a CORRUPT file is the same "never fail the host" rule
 * the hooks live by (`claude-code/CONTRACT.md` §5 G2) — one ring event
 * (`adapter.scope.unreadable`), never a thrown hook — and the console refuses
 * to overwrite a file it could not parse without `--force`, so the corruption
 * is loud on the one surface that has a person in front of it.
 *
 * **This module never throws at a reader.** `readScopes` returns a reading;
 * only `writeScopes`, which is a console command with an owner watching, is
 * allowed to fail out loud.
 */
import { mkdirSync, readFileSync, realpathSync, renameSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve, sep } from "node:path";

/**
 * `sessions.ts#canonicalScope`, extended by one step this rule needs and that
 * one does not.
 *
 * `canonicalScope` realpaths a path that EXISTS and falls back to `resolve`
 * otherwise, which is exactly right for comparing two directories a session is
 * actually running in. A PREFIX rule needs more: on this host a registry key
 * written from `/tmp/x` canonicalises to `/private/tmp/x`, while a query for a
 * subdirectory that does not exist yet stays `/tmp/x/sub` — and an ancestor
 * that governs the parent but not the child is the one answer a prefix rule may
 * never give. So the deepest EXISTING ancestor is realpathed and the rest is
 * appended, which makes both sides land in the same tree whether or not the
 * leaf has been created.
 */
export function canonicalScopePath(dir: string): string {
  const abs = resolve(dir);
  let head = abs;
  const tail: string[] = [];
  for (;;) {
    try {
      return tail.length === 0 ? realpathSync(head) : join(realpathSync(head), ...tail);
    } catch {
      const parent = dirname(head);
      // The filesystem root did not resolve either: nothing here exists, so the
      // resolved path is the best canonical form available.
      if (parent === head) return abs;
      tail.unshift(basename(head));
      head = parent;
    }
  }
}

/** The file's name. It sits BESIDE the configuration, never inside a store. */
export const SCOPES_FILE_NAME = "scopes.json";

/** The only shape this reads. A file that says anything else is unreadable. */
export const SCOPES_VERSION = 1;

/**
 * The RING event a hook leaves when the registry is there and unreadable —
 * ring-only, for the same reason `adapter.config.file` is: a new DURABLE event
 * name is a core change and this one is not worth one. An ABSENT file emits
 * nothing at all; absent is the ordinary state of every machine.
 */
export const SCOPE_UNREADABLE_EVENT = "adapter.scope.unreadable";

/** The ring event naming the verdict this process ran under. */
export const SCOPE_EVENT = "adapter.scope";

/** Every mode a directory can be put in. */
export const SCOPE_MODES = ["on", "observer", "off", "paused"] as const;
export type ScopeMode = (typeof SCOPE_MODES)[number];

/** What `--resume` may restore to. A pause never resumes into `off`. */
export const RESUME_MODES = ["on", "observer"] as const;
export type ResumeMode = (typeof RESUME_MODES)[number];

/** A mode, or the absence of one. `unset` is not a mode; it is a question. */
export type EffectiveMode = ScopeMode | "unset";

/**
 * THE STANCE a scope resolves to — the vocabulary the adapters act on.
 * `paused` is `off` while it lasts; `unset` is `on` until somebody answers.
 */
export type ScopeStance = "on" | "observer" | "off";

/** Most restrictive last: the combination rule is a max over this order. */
const STANCE_ORDER: readonly ScopeStance[] = ["on", "observer", "off"];

export interface ScopeEntry {
  readonly mode: ScopeMode;
  /** Where `--resume` goes. Only meaningful on a `paused` entry. */
  readonly resumeTo?: ResumeMode;
  /** ISO timestamp of the decision. Written by whoever set it. */
  readonly since: string;
  /** Free text, the owner's own. Never read by anything that decides. */
  readonly note?: string;
}

export interface ScopeRegistry {
  readonly version: number;
  readonly scopes: Readonly<Record<string, ScopeEntry>>;
}

/** What a read of the file found. It NEVER throws; `error` carries the why. */
export interface ScopeRead {
  /** Null when the file is absent, or present and unreadable. */
  readonly registry: ScopeRegistry | null;
  /** True when the file exists at all — absent and corrupt are different. */
  readonly present: boolean;
  /** One sentence, when a file that IS there could not be understood. */
  readonly error: string | null;
}

/** Which entry decided, and what it said. */
export interface ScopeVerdict {
  readonly mode: EffectiveMode;
  /** The registry key that matched — the ancestor, when it is one. */
  readonly matched: string | null;
  readonly entry: ScopeEntry | null;
}

/** `<config dir>/scopes.json` — beside the file `config-path.ts` resolved. */
export function scopesPath(configPath: string): string {
  return join(dirname(configPath), SCOPES_FILE_NAME);
}

/** An empty registry, for a machine that has never answered the question. */
export function emptyRegistry(): ScopeRegistry {
  return { version: SCOPES_VERSION, scopes: {} };
}

function isMode(value: unknown): value is ScopeMode {
  return typeof value === "string" && (SCOPE_MODES as readonly string[]).includes(value);
}

function isResumeMode(value: unknown): value is ResumeMode {
  return typeof value === "string" && (RESUME_MODES as readonly string[]).includes(value);
}

/**
 * Parse a registry, or say why not.
 *
 * A single malformed ENTRY fails the whole file rather than being dropped: an
 * `off` somebody typed badly must not silently become an `on`, and the console
 * is standing right there to say so. The fail direction for the HOOK is still
 * `unset` (⇒ on), because a hook that refused to run over a JSON typo would be
 * a hook that failed the host (§5 G2) — the two are not in tension: the loud
 * half belongs on the surface with a person in front of it.
 */
export function parseRegistry(raw: unknown): {
  registry: ScopeRegistry | null;
  error: string | null;
} {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return { registry: null, error: "the file is not a JSON object" };
  }
  const rec = raw as Record<string, unknown>;
  if (rec["version"] !== SCOPES_VERSION) {
    return {
      registry: null,
      error: `"version" is ${JSON.stringify(rec["version"])}, and this reads version ${String(SCOPES_VERSION)}`,
    };
  }
  const scopesRaw = rec["scopes"];
  if (scopesRaw === undefined) return { registry: emptyRegistry(), error: null };
  if (scopesRaw === null || typeof scopesRaw !== "object" || Array.isArray(scopesRaw)) {
    return { registry: null, error: '"scopes" is not an object' };
  }
  const scopes: Record<string, ScopeEntry> = {};
  for (const [path, value] of Object.entries(scopesRaw as Record<string, unknown>)) {
    if (!path.startsWith("/")) {
      return { registry: null, error: `the key ${JSON.stringify(path)} is not an absolute path` };
    }
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      return { registry: null, error: `the entry for ${path} is not an object` };
    }
    const entry = value as Record<string, unknown>;
    if (!isMode(entry["mode"])) {
      return {
        registry: null,
        error: `the entry for ${path} has mode ${JSON.stringify(entry["mode"])}; it takes ${SCOPE_MODES.join(", ")}`,
      };
    }
    const since = entry["since"];
    if (typeof since !== "string" || since.length === 0) {
      return { registry: null, error: `the entry for ${path} has no "since"` };
    }
    const resumeTo = entry["resumeTo"];
    if (resumeTo !== undefined && !isResumeMode(resumeTo)) {
      return {
        registry: null,
        error: `the entry for ${path} has resumeTo ${JSON.stringify(resumeTo)}; it takes ${RESUME_MODES.join(", ")}`,
      };
    }
    const note = entry["note"];
    if (note !== undefined && typeof note !== "string") {
      return { registry: null, error: `the entry for ${path} has a "note" that is not text` };
    }
    scopes[path] = {
      mode: entry["mode"],
      since,
      ...(resumeTo === undefined ? {} : { resumeTo }),
      ...(note === undefined ? {} : { note }),
    };
  }
  return { registry: { version: SCOPES_VERSION, scopes }, error: null };
}

/**
 * Read the registry at `path`. Absent is ordinary and silent; present and
 * unreadable carries a sentence. Never throws.
 */
export function readScopes(
  path: string,
  read: (p: string) => string = (p) => readFileSync(p, "utf8"),
): ScopeRead {
  let text: string;
  try {
    text = read(path);
  } catch (err) {
    const code =
      err !== null && typeof err === "object" && typeof (err as { code?: unknown }).code === "string"
        ? (err as { code: string }).code
        : "UNREADABLE";
    // ENOENT is the ordinary state of every machine that has never answered the
    // question. Anything else — a permission bit, a directory where a file
    // should be — is a file that IS there and could not be read.
    if (code === "ENOENT") return { registry: null, present: false, error: null };
    return { registry: null, present: true, error: `it could not be read (${code})` };
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    return {
      registry: null,
      present: true,
      error: `it is not JSON (${err instanceof Error ? err.message : String(err)})`,
    };
  }
  const parsed = parseRegistry(raw);
  return { registry: parsed.registry, present: true, error: parsed.error };
}

/** Is `dir` at or under `key`? Segment-aware: `/a/b` never matches `/a/bc`. */
function under(key: string, dir: string): boolean {
  if (key === dir) return true;
  const base = key.endsWith(sep) ? key : `${key}${sep}`;
  return dir.startsWith(base);
}

/**
 * Which entry governs `dir` — the LONGEST matching ancestor, or `unset`.
 *
 * Both sides go through `canonicalScopePath`, so a registry written from
 * `/tmp/x` still governs a hook whose cwd arrives as `/private/tmp/x`, and a
 * subdirectory that does not exist yet still inherits its ancestor. Specificity
 * is measured on the canonical key, which is the only form the comparison saw.
 */
export function lookupScope(registry: ScopeRegistry | null, dir: string): ScopeVerdict {
  if (registry === null) return { mode: "unset", matched: null, entry: null };
  const target = canonicalScopePath(dir);
  let best: { key: string; canonical: string; entry: ScopeEntry } | null = null;
  for (const [key, entry] of Object.entries(registry.scopes)) {
    const canonical = canonicalScopePath(key);
    if (!under(canonical, target)) continue;
    if (best === null || canonical.length > best.canonical.length) best = { key, canonical, entry };
  }
  if (best === null) return { mode: "unset", matched: null, entry: null };
  return { mode: best.entry.mode, matched: best.key, entry: best.entry };
}

/**
 * The stance a mode resolves to. `unset` is ON — today's behaviour, and the
 * choice this whole file asks the owner to confirm. `paused` is OFF while it
 * lasts; the difference between them is what `--resume` restores, not what a
 * session may do.
 */
export function stanceOfMode(mode: EffectiveMode): ScopeStance {
  switch (mode) {
    case "observer":
      return "observer";
    case "off":
    case "paused":
      return "off";
    default:
      return "on";
  }
}

/**
 * THE COMBINATION RULE: the MOST RESTRICTIVE of the stance the configuration
 * and the environment already produced, and the one the registry names.
 *
 * It only ever adds restriction. The three private directories running under
 * `COUNTERPARTS_CONFIG` + `COUNTERPARTS_OBSERVER` today have no registry entry
 * at all, so they combine `observer` with `unset` and stay exactly observer —
 * which is the one property this feature was not allowed to break.
 */
export function effectiveStance(configObserver: boolean, mode: EffectiveMode): ScopeStance {
  const fromConfig: ScopeStance = configObserver ? "observer" : "on";
  const fromScope = stanceOfMode(mode);
  return STANCE_ORDER.indexOf(fromConfig) >= STANCE_ORDER.indexOf(fromScope)
    ? fromConfig
    : fromScope;
}

/**
 * THIS directory's OWN entry — never an ancestor's, and found by canonical
 * path rather than by string key, so a hand-edited `/tmp/x` is the same entry
 * as a written `/private/tmp/x`.
 *
 * It is separate from `lookupScope` because the two answer different questions:
 * "what governs here" inherits, and "what did somebody set HERE" must not —
 * `--resume` on a directory that merely inherits an ancestor's pause would
 * quietly create a new entry and leave the ancestor paused.
 */
export function ownEntry(registry: ScopeRegistry | null, dir: string): ScopeEntry | null {
  if (registry === null) return null;
  const key = canonicalScopePath(dir);
  for (const [existing, entry] of Object.entries(registry.scopes)) {
    if (canonicalScopePath(existing) === key) return entry;
  }
  return null;
}

/** Where `--resume` puts this entry. A pause with no memory resumes to `on`. */
export function resumeTarget(entry: ScopeEntry | null): ResumeMode {
  return entry?.resumeTo ?? "on";
}

/**
 * Set one directory's entry. PURE — it returns the registry to write, so the
 * caller decides when a file changes and nothing here can half-write one.
 *
 * `--pause` remembers what it interrupted (`resumeTo`), which is the whole
 * difference between pausing and turning off: an afternoon that is not recorded
 * does not change what the directory thinks it is.
 */
export function setScope(
  registry: ScopeRegistry | null,
  dir: string,
  mode: ScopeMode,
  opts: { at: string; note?: string; resumeTo?: ResumeMode },
): ScopeRegistry {
  const base = registry ?? emptyRegistry();
  const key = canonicalScopePath(dir);
  const prior = ownEntry(base, dir) ?? undefined;
  const resumeTo =
    opts.resumeTo ??
    (mode === "paused"
      ? prior !== undefined && (prior.mode === "on" || prior.mode === "observer")
        ? prior.mode
        : resumeTarget(prior ?? null)
      : undefined);
  const entry: ScopeEntry = {
    mode,
    since: opts.at,
    ...(resumeTo === undefined ? {} : { resumeTo }),
    // A note is REPLACED when one is given and CARRIED when one is not: the
    // reason a directory is off outlives the flag that paused it.
    ...(opts.note !== undefined
      ? opts.note.length === 0
        ? {}
        : { note: opts.note }
      : prior?.note === undefined
        ? {}
        : { note: prior.note }),
  };
  // EVERY key that names this directory is replaced, not just the canonical
  // spelling. A registry may have been hand-edited with `/tmp/x` where this
  // writes `/private/tmp/x`; leaving the old one behind would put two entries
  // for one directory in the file, and `lookupScope` would go on honouring
  // whichever of them happened to sort first — a setting that appears to change
  // and does not.
  const scopes: Record<string, ScopeEntry> = {};
  for (const [existing, value] of Object.entries(base.scopes)) {
    if (canonicalScopePath(existing) === key) continue;
    scopes[existing] = value;
  }
  scopes[key] = entry;
  return { version: SCOPES_VERSION, scopes };
}

/**
 * Write the registry: temp file beside the target, then `rename` — the same
 * shape `sessions.ts` uses, and for the same reason (a reader never sees half a
 * file, and same directory means same filesystem means the rename is a rename).
 *
 * This one MAY throw: its only caller is a console command with an owner
 * watching, and a write that failed silently is the failure this whole package
 * keeps recording.
 */
export function writeScopes(path: string, registry: ScopeRegistry): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${String(process.pid)}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(registry, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  renameSync(tmp, path);
}
