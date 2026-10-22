/**
 * A SETTING CHANGED FOR ONE RUN (2026-10-21, `harness compare`): a tunable
 * set from outside, by the harness, in its own process and in the server its
 * children reach (`serve-at.ts`), so a switch can be compared on and off
 * within one build. The product grows no knob for it: the modules' tunables
 * are plain objects read at use, and this sets a value on one before the run.
 *
 * Named `module.KEY=VALUE`, top-level numbers and booleans only. An unknown
 * module or key, or a value of another type, is refused before anything runs.
 * So is a key some reader copied at load (`CAPTURED`): set, it would change
 * some readers and not others, or none. `dream/index.ts`'s `FIT_OVERHEAD`
 * (from `fit.OVERHEAD`) is captured too, and `fit` isn't settable at all.
 */
import { TUNABLES as ASSOCIATE } from "../../src/core/associate/tunables.js";
import { COVERAGE_TUNABLES as COVERAGE } from "../../src/core/coverage/tunables.js";
import { DREAM_TUNABLES as DREAM } from "../../src/core/dream/tunables.js";
import { TUNABLES as ENCODE } from "../../src/core/encode/tunables.js";
import { TUNABLES as PHYSICS } from "../../src/core/physics/index.js";
import { TUNABLES as PROSPECTIVE } from "../../src/core/prospective/tunables.js";
import { TUNABLES as RECALL } from "../../src/core/recall/tunables.js";
import { TUNABLES as REMEMBER } from "../../src/core/remember/tunables.js";
import { TUNABLES as SCHEMAS } from "../../src/core/schemas/tunables.js";
import { SELF_TUNABLES as SELF } from "../../src/core/self/tunables.js";
import { TUNABLES as SLEEP } from "../../src/core/sleep/tunables.js";
import { setSettingsInForce } from "../../src/core/store/index.js";

/** The build a run ran (`package.json#version`, or "unknown"), for its record beside its settings (2026-10-22). */
export { runningBuild } from "../../src/core/store/index.js";

/** The variable that carries the settings to a child's server, as `module.KEY=VALUE` joined by `;`. */
export const SETTINGS_ENV = "HARNESS_SET";

const MODULES: Readonly<Record<string, Record<string, unknown>>> = {
  associate: ASSOCIATE as unknown as Record<string, unknown>,
  coverage: COVERAGE as unknown as Record<string, unknown>,
  dream: DREAM as unknown as Record<string, unknown>,
  encode: ENCODE as unknown as Record<string, unknown>,
  physics: PHYSICS as unknown as Record<string, unknown>,
  prospective: PROSPECTIVE as unknown as Record<string, unknown>,
  recall: RECALL as unknown as Record<string, unknown>,
  remember: REMEMBER as unknown as Record<string, unknown>,
  schemas: SCHEMAS as unknown as Record<string, unknown>,
  self: SELF as unknown as Record<string, unknown>,
  sleep: SLEEP as unknown as Record<string, unknown>,
};

/**
 * Keys read through a copy made at load (review of #566): refused, because
 * setting one would change only the readers of the live object.
 */
const CAPTURED: Readonly<Record<string, string>> = {
  "physics.W_REFERENCED": "USE_TIER_WEIGHT",
  "physics.W_ENGAGED": "USE_TIER_WEIGHT",
  "physics.W_SURFACED": "USE_TIER_WEIGHT",
  "physics.W_FOOTNOTED": "USE_TIER_WEIGHT",
  "physics.W_SHOWN": "USE_TIER_WEIGHT",
  "physics.W_ONTOPIC": "USE_TIER_WEIGHT",
  "physics.W_USEFUL": "USE_TIER_WEIGHT",
  "physics.ENGAGED_RECURRENCE_WEIGHT": "sleep/consolidate.ts RECURRENCE_SOURCES",
  "physics.SHOWN_RECURRENCE_WEIGHT": "sleep/consolidate.ts RECURRENCE_SOURCES",
  "physics.ONTOPIC_RECURRENCE_WEIGHT": "sleep/consolidate.ts RECURRENCE_SOURCES",
  "physics.HOLD_LEAD_DAYS": "prospective/tunables.ts",
  "physics.HOLD_GRACE_DAYS": "prospective/tunables.ts",
  "physics.PHI_PRUNE": "prospective/tunables.ts",
  "remember.CONSUMED_LEDGER_MAX": "counterpart.ts",
};

export interface Setting {
  readonly module: string;
  readonly key: string;
  readonly value: number | boolean;
  /** The build's own value, before the run set it. */
  readonly was: number | boolean;
}

export class SettingError extends Error {
  readonly code: "SETTING_SHAPE" | "SETTING_MODULE" | "SETTING_KEY" | "SETTING_TYPE" | "SETTING_TWICE" | "SETTING_CAPTURED" | "SETTING_PRESET";
  constructor(code: SettingError["code"], message: string) {
    super(`${code}: ${message}`);
    this.code = code;
  }
}

/** Read one `module.KEY=VALUE` against this build's tunables, refusing what it can't set. Pure. */
export function parseSetting(text: string): Omit<Setting, "was"> & { readonly was: number | boolean } {
  const m = /^([a-z]+)\.([A-Z0-9_]+)=(.+)$/.exec(text.trim());
  if (m === null) throw new SettingError("SETTING_SHAPE", `"${text}" is not module.KEY=VALUE`);
  const [, module, key, raw] = m as unknown as [string, string, string, string];
  const target = MODULES[module];
  if (target === undefined) throw new SettingError("SETTING_MODULE", `no module "${module}" (${Object.keys(MODULES).join(", ")})`);
  if (!Object.prototype.hasOwnProperty.call(target, key)) throw new SettingError("SETTING_KEY", `${module} has no ${key}`);
  const copy = CAPTURED[`${module}.${key}`];
  if (copy !== undefined) throw new SettingError("SETTING_CAPTURED", `${module}.${key} is copied at load into ${copy}; a run can't set it`);
  const was = target[key];
  if (typeof was === "boolean") {
    if (raw !== "true" && raw !== "false") throw new SettingError("SETTING_TYPE", `${module}.${key} is a boolean, not "${raw}"`);
    return { module, key, value: raw === "true", was };
  }
  if (typeof was === "number") {
    const value = Number(raw);
    if (raw.trim() === "" || !Number.isFinite(value)) throw new SettingError("SETTING_TYPE", `${module}.${key} is a number, not "${raw}"`);
    return { module, key, value, was };
  }
  throw new SettingError("SETTING_TYPE", `${module}.${key} is not a number or a boolean`);
}

/**
 * NAMED SETS OF SETTINGS (2026-10-22, `harness compare --preset`): a name for
 * a list of `module.KEY=VALUE`, expanded before anything runs, so each one is
 * checked and recorded like a `--set`. A preset adds no knob: every entry is a
 * tunable the build already reads at use.
 *
 * `physics-off` is the "just files" side of the question "do the engineered
 * parts beat plain storage?": the same record with the memory's arithmetic
 * switched off as far as top-level tunables reach. What they can't reach is
 * listed in tools/harness/README.md ("physics-off").
 */
export const PRESETS: Readonly<Record<string, readonly string[]>> = {
  "physics-off": [
    // Decay and forgetting: stability so large the curve stays at 1 for any
    // record's length (S0 rather than POWER_LAW_PSI=0, which leaves the
    // closed form and walks 100,000 days per memory), and no wait under the
    // floor ever ends (PHI_PRUNE is captured at load).
    "physics.S0=1000000000",
    "physics.D_FLOOR_DAYS=1000000000",
    // Every memory in reach, as a plain file store keeps every file to hand.
    "physics.REACH=0",
    // Salience and feeling as weights. STABILITY_GAIN and EMO_Q only shape the
    // curve, so under S0=1e9 they are inert; kept so the preset still says
    // "off" if S0 is ever set back on its own. EMO_LIFT moves height and works.
    "physics.STABILITY_GAIN=0",
    "physics.EMO_Q=0",
    "physics.EMO_LIFT=0",
    // Reinforcement: use adds no height and no durability; returns of every
    // source lengthen nothing; the legacy consolidation bonus is gone.
    "physics.REP_CAP=0",
    "physics.BETA=0",
    "physics.RETURN_GAIN=0",
    "physics.CONS_BONUS=0",
    // A belief's support arm (§5.13) is reinforcement too: it adds no height.
    "physics.BELIEF_SUPPORT_CAP=0",
    "physics.DREAM_RETURN_WEIGHT=0",
    "physics.REFLECTION_RETURN_WEIGHT=0",
    "physics.ENGAGED_RETURN_WEIGHT=0",
    // The core: no lane promotes (the nightly cap is 0).
    "sleep.CORE_MAX_PER_SLEEP=0",
    // Learned association: no edge from use, co-use, order or a dream's link.
    "associate.HEBB_RATE=0",
    "associate.CO_USE_DEPOSIT=0",
    "associate.CONTIGUITY_RATE=0",
    "associate.SHOWN_TOGETHER_DEPOSIT=0",
    "dream.LINK_WEIGHT=0",
    "dream.REPLAY_LINK_WEIGHT=0",
    // Recall's engineered lifts: spreading along links, priming (links,
    // train of thought, tags), habituation, salience in the bar and the sort.
    "recall.HOP_CEILING=0",
    "recall.PRIME_LINK_UNITS=0",
    "recall.PRIME_TRAIN_SHARE=0",
    "recall.TAGS_PRIME=false",
    "recall.HABITUATION_BAR_LIFT=0",
    "recall.SAL_BAR_WEIGHT=0",
    "recall.SAL_SORT_WEIGHT=0",
  ],
};

/** Physics' reach as this run has it (a setting included), for the replay's below-reach count. */
export function reachInForce(): number {
  return PHYSICS.REACH as number;
}

/** The settings a preset names; an unknown name is refused before anything runs. */
export function expandPreset(name: string): readonly string[] {
  const p = PRESETS[name];
  if (p === undefined) throw new SettingError("SETTING_PRESET", `no preset "${name}" (${Object.keys(PRESETS).join(", ")})`);
  return p;
}

let applied: Setting[] = [];

/** Set each on its module, in order; refuses all of them (nothing set) when any one is refused or a key comes twice. */
export function applySettings(texts: readonly string[]): readonly Setting[] {
  const parsed = texts.map(parseSetting);
  const seen = new Set<string>();
  for (const s of parsed) {
    const name = `${s.module}.${s.key}`;
    if (seen.has(name)) throw new SettingError("SETTING_TWICE", `${name} is set twice`);
    seen.add(name);
  }
  for (const s of parsed) MODULES[s.module]![s.key] = s.value;
  applied = [...applied, ...parsed];
  // Mirrored into core, so the build log of a store this process opens next
  // names them (`build.<version>.settings`, 2026-10-22).
  setSettingsInForce(applied);
  return parsed;
}

/** Put every applied setting back to the build's own value (tests). */
export function restoreSettings(): void {
  for (const s of [...applied].reverse()) MODULES[s.module]![s.key] = s.was;
  applied = [];
  setSettingsInForce([]);
}

/** What this process set, for the run's record. */
export function appliedSettings(): readonly Setting[] {
  return applied;
}

/** The settings as the child's server reads them (`SETTINGS_ENV`); "" when none. */
export function settingsForChild(): string {
  return applied.map((s) => `${s.module}.${s.key}=${String(s.value)}`).join(";");
}

/** Apply what a parent passed down in `SETTINGS_ENV` (the child's server). */
export function applySettingsFromEnv(env: NodeJS.ProcessEnv = process.env): readonly Setting[] {
  const raw = env[SETTINGS_ENV];
  if (raw === undefined || raw.trim() === "") return [];
  return applySettings(raw.split(";").filter((x) => x.trim() !== ""));
}
