/**
 * `adapters/cli/keys.ts` — the two key questions, and the one file they write.
 *
 * New-user finding #3: "Nothing asks for the keys at all." A stranger who
 * installed `counterparts@0.1.0` on 2026-09-21 met an install that printed a
 * credentials TEMPLATE and never mentioned that a key could go in it, and a
 * `credentials set` that refused the terminal he was standing at (#2). This
 * file is the asking half; `credentialsCommand` in `commands.ts` is the
 * one-command half, and both write through `writeCredential` below, which lives
 * here so there is exactly one function in this package that puts a secret on
 * disk.
 *
 * ── The rules, and which of them are not mine to relax ──────────────────────
 *
 *   1. **A value is returned and written, and goes nowhere else.** Not to
 *      `io.out`, not to `io.err`, not into a warning, not into the result
 *      object, not into an event. Everything that leaves this module is a NAME,
 *      a PATH or an outcome word — the same bound `claude-code/credentials.ts`
 *      holds on the reading side.
 *   2. **Skipping is always offered and always fine** (the owner, 2026-09-21).
 *      Enter skips; every prompt says so; a skip is an ordinary outcome and
 *      never an error. Both keys are optional and the product says so in its
 *      README: "No API keys are required."
 *   3. **Embedding is opt-in because it sends text to a third party.** A Voyage
 *      key alone never turns the embedder on. The knob moves only after an
 *      explicit yes, and the edit writes the exact shape `doctor` names —
 *      `"embedder": { "enabled": true }` — because the config is read strictly.
 *   4. **Not a terminal → nothing happens.** `promptForKeys` asks nothing,
 *      writes nothing and says so in its result, so a scripted `install` (the
 *      install loop included) keeps its bytes.
 *
 * ── Why a separate file ─────────────────────────────────────────────────────
 *
 * `commands.ts` is six thousand lines and three builders were editing it at
 * once. More durably: this module imports only a TYPE from `commands.ts`, the
 * way `ui.ts` does, so `commands.ts` can import `writeCredential` and
 * `promptForKeys` back without minting an ESM cycle.
 */
import { chmodSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { API_KEY_ENV, EMBED_KEY_ENV } from "../claude-code/config.js";
import type { Io } from "./commands.js";
import { askHidden, confirm } from "./ui.js";
import type { Ui } from "./ui.js";

/** Where to get each key, printed beside the question. The owner asked for the
 *  link explicitly; a person who does not have a key cannot act on a prompt
 *  that does not say where one comes from. */
export const KEY_LINKS: Readonly<Record<string, string>> = {
  [API_KEY_ENV]: "https://console.anthropic.com/settings/keys",
  [EMBED_KEY_ENV]: "https://dash.voyageai.com/",
};

/**
 * ONE LINE each, and both of them are claims about what the product does, so
 * they are written from `README.md` ("No API keys are required") and
 * QUICKSTART §6 rather than invented here.
 *
 * The Anthropic line is the one that is easy to get wrong. The key does NOT buy
 * the ordinary write path — memory forms without it. It buys the crash-recovery
 * sweep: the interpretation of a session that ENDED before the assistant could
 * write it up. And it is an egress: that captured conversation is sent to
 * Anthropic. Both halves, or the sentence is a sales line.
 */
export const KEY_REASONS: Readonly<Record<string, string>> = {
  [API_KEY_ENV]:
    "Lets memory still be written for a session that ended before the assistant could write it up — it sends that captured conversation to Anthropic. Everything else works without it.",
  [EMBED_KEY_ENV]:
    "Buys recall by meaning, not just by words — it sends memory text to Voyage to be embedded. Recall works without it, on words alone.",
};

/** The prefix each provider's keys have had for as long as this was written.
 *  A mismatch is a WARNING and never a refusal: a prefix is a convention, and a
 *  console that refused a valid key because a vendor renamed one would be worse
 *  than wrong. */
const KEY_PREFIX: Readonly<Record<string, string>> = {
  [API_KEY_ENV]: "sk-ant-",
  [EMBED_KEY_ENV]: "pa-",
};

/** What happened to one key. */
export type KeyOutcome =
  /** A value was written to the credentials file. */
  | "set"
  /** Asked, and nothing was written: Enter, or a paste that did not survive
   *  the sanity check. Either way the file is as it was. */
  | "skipped"
  /** It was already there and the person kept it. Nothing was written. */
  | "kept"
  /** Nobody was asked — no terminal, or the caller opted out. */
  | "not-asked";

/** What happened to the embedder knob in the configuration. */
export type EmbedderOutcome =
  /** Turned on now, in the config, at the person's word. */
  | "enabled"
  /** It was already `true` before this ran. Nothing was written. */
  | "already-on"
  /** Asked, and the answer was no. The knob is untouched. */
  | "declined"
  /** Never reached: no embed key was given, or nobody was asked. */
  | "not-asked"
  /** Asked, answered yes, and the config could not be edited. The KEY is
   *  written; the knob is not. `embedderFix` says what to do. */
  | "failed";

export interface KeyPromptContext {
  /** The console's layout and manners, already built by the caller — which is
   *  also how this function knows whether anyone can be asked (`ui.interactive`
   *  folds in the caller's own `--yes` / `--no-input`). */
  readonly ui: Ui;
  /** The `claude-code.json` whose `embedder` knob a yes would move. */
  readonly configPath: string;
  /** The credentials file to write. The caller resolves it the way every other
   *  reader does — the config's `credentialsFile`, else the one beside it. */
  readonly credentialsPath: string;
  /** Which honored names the file ALREADY holds. NAMES ONLY — this is
   *  `install.ts#credentialsHeld`'s return, which never carries a value. */
  readonly held: readonly string[];
  /** Whether `embedder.enabled` is already literally `true` in the config. */
  readonly embedderOn?: boolean;
}

export interface KeyPromptResult {
  /** False when nobody was asked anything. Everything else is then inert. */
  readonly asked: boolean;
  readonly anthropic: KeyOutcome;
  readonly voyage: KeyOutcome;
  readonly embedder: EmbedderOutcome;
  /** Present only when `embedder` is `"failed"`: the one line that fixes it,
   *  in `doctor`'s own words. */
  readonly embedderFix?: string;
}

const NOT_ASKED: KeyPromptResult = {
  asked: false,
  anthropic: "not-asked",
  voyage: "not-asked",
  embedder: "not-asked",
};

/**
 * Ask for the two keys, write what is given, and say what happened.
 *
 * The step `install` calls. It asks in the order a person meets them — the
 * Anthropic key first, because it is the one the wake and the sweep want; the
 * Voyage key second, because it is optional twice over (the key, and then the
 * knob).
 *
 * **Ctrl-C PROPAGATES.** `PromptAborted` is thrown out of here rather than
 * folded into the result, exactly as `ui.ts` argues: a cancelled key prompt
 * that came back as "skipped" is an install that quietly carries on without the
 * key somebody was in the middle of cancelling. A key written before the abort
 * stays written — it is on disk and saying otherwise would be the lie.
 *
 * `env` is the run's environment, never `process.env`: it is read for ONE
 * thing, whether the same name is also exported in this shell, because the
 * environment wins over the file for any process that has it and a person who
 * has both should be told which one a hook will actually see.
 */
export async function promptForKeys(
  io: Io,
  env: Record<string, string | undefined>,
  ctx: KeyPromptContext,
): Promise<KeyPromptResult> {
  const u = ctx.ui;
  if (!u.interactive) return NOT_ASKED;

  const anthropic = await askForKey(io, env, ctx, API_KEY_ENV);
  const voyage = await askForKey(io, env, ctx, EMBED_KEY_ENV);

  // THE KNOB IS A SEPARATE YES (rule 3). No key, no question: turning the
  // embedder on with nothing to embed with buys an `embed-failed` on every ask
  // and a `doctor` line about a key that was never offered.
  //
  // A KEY THAT WAS ALREADY THERE COUNTS. Re-running `install` is the ordinary
  // case, not the odd one — the owner's own trial of 0.2 is a re-install — and a
  // person whose Voyage key is saved while the knob is off would otherwise never
  // be offered the thing the key is for. The question is asked for a key that
  // was just typed and for one that was kept; only a knob that is already `true`
  // is left alone, because there is nothing to offer.
  let embedder: EmbedderOutcome = "not-asked";
  let embedderFix: string | undefined;
  const haveEmbedKey = voyage === "set" || voyage === "kept";
  if (haveEmbedKey && ctx.embedderOn === true) {
    embedder = "already-on";
  } else if (haveEmbedKey) {
    u.blank();
    u.hint("Embedding sends memory text to Voyage. It stays off until you say otherwise.");
    const yes = await confirm(io, "Turn on recall by meaning now?", { default: true });
    if (!yes) {
      embedder = "declined";
      u.ok(`${EMBED_KEY_ENV} is saved and recall by meaning stays off.`);
    } else {
      const edit = enableEmbedder(ctx.configPath);
      if (edit.ok) {
        embedder = "enabled";
        // No full stop after a PATH: a sentence's own punctuation reads as part
        // of the thing it names, and this line is often copied.
        u.ok(`recall by meaning is on in ${ctx.configPath}`);
      } else {
        embedder = "failed";
        embedderFix = embedderFixLine(ctx.configPath);
        u.warn(`could not turn recall by meaning on: ${edit.reason}. The key is saved.`);
        u.hint(embedderFix);
      }
    }
  }

  return {
    asked: true,
    anthropic,
    voyage,
    embedder,
    ...(embedderFix === undefined ? {} : { embedderFix }),
  };
}

/** `doctor`'s own sentence for a knob that is off, so the two consoles cannot
 *  say different things about one setting. */
export function embedderFixLine(configPath: string): string {
  return `Add "embedder": { "enabled": true } to ${configPath} (read strictly: that exact shape).`;
}

/** One key: explain, link, read without echo, sanity-check, write. */
async function askForKey(
  io: Io,
  env: Record<string, string | undefined>,
  ctx: KeyPromptContext,
  name: string,
): Promise<KeyOutcome> {
  const u = ctx.ui;
  const label = name === API_KEY_ENV ? "Anthropic" : "Voyage";

  if (ctx.held.includes(name)) {
    u.blank();
    const keep = await confirm(io, `${label === "Anthropic" ? "An" : "A"} ${label} key is already saved. Keep it?`, {
      default: true,
    });
    if (keep) return "kept";
    // A no is a REPLACE, not a delete: the prompt below can still be skipped,
    // and skipping leaves the key that is there. Nothing in this console
    // removes a credential — that is `credentials set` with a new value, or the
    // file, by hand.
    u.hint("Paste a new one, or press Enter to keep the one that is saved.");
  } else {
    u.blank();
    u.heading(`${label} API key — optional`);
    u.hint(KEY_REASONS[name] ?? "");
    u.hint(`Get one: ${KEY_LINKS[name] ?? ""}`);
  }

  const value = await askHidden(io, `${name} (Enter to skip): `);
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    u.ok(ctx.held.includes(name) ? `${name} is unchanged.` : `skipped — no ${name} was written.`);
    return ctx.held.includes(name) ? "kept" : "skipped";
  }

  // A SPACE IN A KEY IS A PASTE THAT WENT WRONG, and a credential that is
  // present and broken is worse than one that is absent: absent is graded and
  // said out loud (`no-credential`), while broken fails at every boundary and
  // reads as configured. That is I32's shape. Refused, and NOT echoed back for
  // the person to check — what they typed is not going on the screen.
  if (/\s/.test(trimmed)) {
    u.warn("that value has a space in it, which no key has. Nothing was written.");
    u.hint(`Run 'counterparts credentials set ${name}' when you have it to hand.`);
    return "skipped";
  }

  const prefix = KEY_PREFIX[name];
  if (prefix !== undefined && !trimmed.startsWith(prefix)) {
    // A WARNING AND NOT A REFUSAL. The prefix is a convention, the console does
    // not call the network, and a key this console rejected for looking wrong
    // is a key the person has to work around.
    u.warn(`that does not look like a ${label} key (they start "${prefix}"). Saving it anyway.`);
  }

  writeCredential(ctx.credentialsPath, name, trimmed);
  u.ok(`set ${name} in ${ctx.credentialsPath}`);
  if ((env[name] ?? "").trim().length > 0) {
    // The rule `claude-code/credentials.ts` mechanizes, said where it matters:
    // the file fills gaps, and a process that HAS the variable keeps it.
    u.hint(`Your shell also exports ${name}; where a process has it, that value wins.`);
  }
  return "set";
}

// ── the configuration edit ──────────────────────────────────────────────────

export type EmbedderEdit = { ok: true } | { ok: false; reason: string };

/**
 * Turn `embedder.enabled` on in an existing `claude-code.json`.
 *
 * Three things this has to get right, and the third is why it is not
 * `writeOnce`:
 *
 *   - **The exact shape.** `loadConfig` reads the knob strictly — `embedder`
 *     must be an object whose `enabled` is literally `true` — and `doctor`'s fix
 *     line says so in as many words. Anything looser here would write a config
 *     that reads as off while the person was told it is on.
 *   - **Everything else in the file survives.** The parsed object is edited and
 *     re-serialised, so `dataDir`, `credentialsFile`, `identity`, the budget and
 *     anything an owner added by hand keep their values AND their order — JSON
 *     round-trips insertion order, and a knob that is not there is appended.
 *   - **Atomic.** Sibling, then rename: `install`'s `writeOnce` writes straight
 *     over the target, and a crash between the truncate and the write leaves the
 *     file the hooks read EMPTY, which is every hook standing down silently.
 *     That is I32's shape aimed at the config instead of the credentials.
 *
 * It never CREATES the file: this runs during an install that has already
 * written one, and a config invented here would name no store.
 */
export function enableEmbedder(configPath: string): EmbedderEdit {
  let text: string;
  let mode = 0o644;
  try {
    mode = statSync(configPath).mode & 0o777;
    text = readFileSync(configPath, "utf8");
  } catch {
    return { ok: false, reason: `${configPath} could not be read` };
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, reason: `${configPath} is not valid JSON` };
  }
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, reason: `${configPath} does not hold a JSON object` };
  }
  const body = { ...(raw as Record<string, unknown>), embedder: { enabled: true } };
  const tmp = `${configPath}.tmp`;
  try {
    writeFileSync(tmp, `${JSON.stringify(body, null, 2)}\n`, { mode });
    chmodSync(tmp, mode);
    renameSync(tmp, configPath);
  } catch (err) {
    return { ok: false, reason: String((err as Error).message ?? err) };
  }
  return { ok: true };
}

// ── the one place a secret is written ───────────────────────────────────────

/**
 * Write one name into the credentials file, keeping every other line.
 *
 * Three cases, in order: an ACTIVE line for this name is replaced where it
 * stands; else the template's own COMMENTED placeholder (`# NAME=...`) becomes
 * the real line — placed AFTER the indented comment lines that continue it, so
 * the explanation still sits above the line it explains; else the line is
 * appended. Every other line — every comment, the other name, anything the
 * owner added — is preserved byte for byte.
 *
 * **Written to a sibling and RENAMED over the target, never truncated in
 * place.** `writeFileSync` on the target opens it `O_TRUNC`: a crash, a full
 * disk or a kill between the truncate and the write leaves a file that exists
 * and is EMPTY — which is I32's own shape (the credentials file was empty from
 * 09-04, the worker refused `NO_CREDENTIAL` at every boundary for a week, and
 * every surface read healthy). `rename` is atomic on one filesystem, so a reader
 * sees the old file or the new one and never a zero-length one. The mode is set
 * on the TEMP file — `writeFileSync`'s `mode` applies only when a file is
 * created, so writing straight over an existing 0644 file would have held the
 * secret at 0644 until the `chmod` after it — and rename carries the bits with
 * the inode. The final `chmodSync` then holds the promise for the case where
 * the temp file already existed with looser bits.
 *
 * It lives in this file rather than in `commands.ts` so that the two doors that
 * write a key — `credentials set` and the install prompts — go through one
 * function, and so that `keys.ts` need not import a value from the module that
 * imports it.
 */
export function writeCredential(path: string, name: string, value: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const line = `${name}=${value}`;
  let text = "";
  try {
    text = readFileSync(path, "utf8");
  } catch {
    /* absent is ordinary: this command is how the file comes to exist */
  }
  // The names are `CREDENTIAL_NAMES` members, so there is nothing to escape.
  const active = new RegExp(`^\\s*(export\\s+)?${name}\\s*=`);
  const commented = new RegExp(`^\\s*#\\s*(export\\s+)?${name}\\s*=`);
  const out = text.length === 0 ? [] : text.split("\n");
  let replaced = false;
  for (let i = 0; i < out.length; i += 1) {
    if (active.test(out[i] ?? "")) {
      out[i] = line;
      replaced = true;
      break;
    }
  }
  if (!replaced) {
    for (let i = 0; i < out.length; i += 1) {
      if (commented.test(out[i] ?? "")) {
        // The placeholder OWNS the indented comment lines under it ("#" then
        // four or more spaces — the template's own continuation shape). Putting
        // the live line where the placeholder stood left them dangling under a
        // secret, reading as if they explained it; the line goes after them
        // instead, so `# NAME=... what it is / # <indent> why` stays a block.
        let end = i;
        while (/^#\s{4,}\S/.test(out[end + 1] ?? "")) end += 1;
        out.splice(i, 1);
        out.splice(end, 0, line);
        replaced = true;
        break;
      }
    }
  }
  if (!replaced) {
    while (out.length > 0 && (out[out.length - 1] ?? "").trim().length === 0) out.pop();
    out.push(line);
    out.push("");
  }
  // Sibling, then rename: see the note above — the target is never observed
  // truncated, and the secret is never on disk at anything but 0600.
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, out.join("\n"), { mode: 0o600 });
  chmodSync(tmp, 0o600);
  renameSync(tmp, path);
  chmodSync(path, 0o600);
}
