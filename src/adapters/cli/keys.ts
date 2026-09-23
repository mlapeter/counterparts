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
 *      Since 2026-09-22 the offer is the FIRST thing each key asks — `[y/N]`,
 *      where Enter is no — and an empty paste after a yes is a skip too. A skip
 *      is an ordinary outcome and never an error. Both keys are optional and
 *      the product says so in its README: "No API keys are required."
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
import {
  chmodSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
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
 * THE QUESTION ITSELF, one line, with what the key buys inside it — the shape
 * the owner settled on 2026-09-22 (item 10): **y/N first**, and the work of
 * deciding done by the question rather than by a paragraph above it.
 *
 * The first version put a heading, the reason, the link and then a hidden
 * prompt in front of somebody who had not yet said they wanted a key, four
 * times over for two optional things. `confirm` appends ` [y/N] `, so these are
 * the sentences and nothing else.
 */
export const KEY_QUESTIONS: Readonly<Record<string, string>> = {
  [API_KEY_ENV]:
    "Add an Anthropic key? Optional — lets a session that ended too soon get written up anyway.",
  [EMBED_KEY_ENV]:
    "Add a Voyage key? Optional — lets recall match by meaning, not just words.",
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
 *
 * NOT PRINTED BY THE INSTALL SCREEN ANY MORE (item 10 — the screen is the
 * question, the link and the outcome). Kept, exported and still the one place
 * these two sentences are written, because the fact they carry is an EGRESS and
 * a product that stops saying where text goes has stopped being able to say it.
 * `help install` / `help credentials` is where they belong now.
 */
export const KEY_REASONS: Readonly<Record<string, string>> = {
  [API_KEY_ENV]:
    "Only used to write up a session that ended before the assistant could. Sends that conversation to Anthropic. Everything else works without it.",
  [EMBED_KEY_ENV]:
    "Lets recall match by meaning, not just by words. Sends memory text to Voyage. Recall still works without it.",
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
  const haveEmbedKey = voyage === "set" || voyage === "kept";
  const knob = haveEmbedKey
    ? await offerEmbedder(io, u, ctx.configPath, ctx.embedderOn === true)
    : { embedder: "not-asked" as EmbedderOutcome };

  return {
    asked: true,
    anthropic,
    voyage,
    ...knob,
  };
}

/**
 * "Turn on recall by meaning now?" — the SECOND yes, and the one `credentials
 * set VOYAGE_API_KEY` needed too.
 *
 * Split out of `promptForKeys` on 2026-09-22 (item 6). Doctor's fix line for an
 * embedder that is off now says `counterparts credentials set VOYAGE_API_KEY`
 * — a command, never a JSON edit (item 12) — and that sentence is only true if
 * the standalone command does what the install does. One function, two doors:
 * the offer cannot come to mean two different things.
 *
 * Rule 3 in full: a KEY IS NOT CONSENT. Embedding sends memory text to a third
 * party, so the knob moves on an explicit yes and on nothing else — and
 * **`[y/N]`, not `[Y/n]`** (adversarial review M3, 2026-09-22). A bare Enter
 * had been turning a third-party egress ON, one line under a docstring saying
 * it could not; and this file now asks the two key questions above it as
 * `[y/N]`, so the Enter a person has just pressed twice to mean "no" would have
 * meant "yes, send my memory to Voyage". If the yes is ever to be the easy
 * answer, the egress has to be in the QUESTION, not in the hint above it.
 */
export async function offerEmbedder(
  io: Io,
  u: Ui,
  configPath: string,
  alreadyOn: boolean,
): Promise<{ embedder: EmbedderOutcome; embedderFix?: string }> {
  if (alreadyOn) return { embedder: "already-on" };
  u.blank();
  u.hint("Embedding sends memory text to Voyage. It stays off until you say otherwise.");
  const yes = await confirm(io, "Turn on recall by meaning now?", { default: false });
  if (!yes) {
    u.ok(`${EMBED_KEY_ENV} is saved and recall by meaning stays off.`);
    return { embedder: "declined" };
  }
  const edit = enableEmbedder(configPath);
  if (edit.ok) {
    // No full stop after a PATH: a sentence's own punctuation reads as part of
    // the thing it names, and this line is often copied.
    u.ok(`recall by meaning is on in ${configPath}`);
    return { embedder: "enabled" };
  }
  const embedderFix = embedderFixLine(configPath);
  u.warn(`could not turn recall by meaning on: ${edit.reason}. The key is saved.`);
  u.hint(embedderFix);
  return { embedder: "failed", embedderFix };
}

/**
 * `doctor`'s own sentence for a knob that is off, so the two consoles cannot
 * say different things about one setting.
 *
 * **IT IS A COMMAND NOW, NOT A FILE EDIT** (new-user finding #19, 2026-09-22):
 * it used to name the JSON to add and the file to add it to, which is the one
 * thing the owner ruled out — "keys and switches should be commands, never JSON
 * edits". `credentials set VOYAGE_API_KEY` saves the key and then offers the
 * switch, so this sentence is the whole of what a person has to do.
 *
 * `configPath` is still taken and deliberately unused: this is the sentence for
 * a knob in THAT file, the caller has it to hand, and a signature that stopped
 * naming it would have to be threaded back through if the wording ever needs
 * the path again.
 */
export function embedderFixLine(_configPath: string): string {
  return `Turn on: counterparts credentials set ${EMBED_KEY_ENV}`;
}

/**
 * One key: ASK FIRST, then link, then read without echo, sanity-check, write.
 *
 * The y/N comes before anything else (item 10). Enter is no, and a no says
 * nothing further — a person who has just declined an optional thing does not
 * need a receipt for declining it, and the screen the owner signed off on has
 * none. Everything after the yes is two indented lines and an outcome word.
 */
async function askForKey(
  io: Io,
  env: Record<string, string | undefined>,
  ctx: KeyPromptContext,
  name: string,
): Promise<KeyOutcome> {
  const u = ctx.ui;
  const label = name === API_KEY_ENV ? "Anthropic" : "Voyage";
  const held = ctx.held.includes(name);

  // A KEY THAT IS ALREADY SAVED IS A DIFFERENT QUESTION, and it is still asked
  // y/N first, with the default on KEEPING it: the answer that changes nothing
  // is the one Enter gives. A yes is a REPLACE, never a delete — an empty paste
  // below leaves the key that is there, and nothing in this console removes a
  // credential.
  const question = held
    ? `${label === "Anthropic" ? "An" : "A"} ${label} key is already saved. Replace it?`
    : (KEY_QUESTIONS[name] ?? `Add a ${label} key?`);
  const go = await confirm(io, question, { default: false });
  if (!go) return held ? "kept" : "skipped";

  // TWO SPACES, NOT THE SIX-COLUMN GUTTER `ui.hint` uses. These two lines are a
  // PAIR — the link and the prompt that follows it — and the prompt's indent is
  // a string this module owns, so the aside above it is written to match rather
  // than sitting four columns further out than the thing it introduces. (The
  // screen the owner signed off on indents both by two.)
  io.out(u.paint.dim(`  Get one at ${KEY_LINKS[name] ?? ""}`));
  const value = await askHidden(io, "  Paste it here (hidden): ");
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    u.ok(held ? `${name} is unchanged.` : "skipped");
    return held ? "kept" : "skipped";
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
  // "saved", not the path: the path is `install`'s own last line, and the
  // screen the owner signed off on reads `ok  saved`. The FILE is still named
  // wherever a person needs to find it — `credentials` lists it, and `doctor`
  // names it in every credential line.
  u.ok("saved");
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
  try {
    replaceAtomically(configPath, `${JSON.stringify(body, null, 2)}\n`, mode);
  } catch (err) {
    return { ok: false, reason: String((err as Error).message ?? err) };
  }
  return { ok: true };
}

/**
 * THE TEMP NAME BOTH WRITERS USE: `<path>.<pid>.tmp` (review n4).
 *
 * It was `<path>.tmp` for both `writeCredential` and `enableEmbedder`, so two
 * processes writing the same file at once wrote through ONE temp file, and a
 * rename that failed left that 0600 temp behind for good. The process id makes
 * the name each process's own — within a process these writes are synchronous,
 * so they cannot overlap — and it is the one suffix `uninstall.ts#ownedKind`
 * already counts as a sidecar of ours (`/^\d+\.tmp$/`), so a leftover can
 * never make `~/.counterparts` look like it holds something foreign.
 */
export function tempSibling(path: string): string {
  return `${path}.${String(process.pid)}.tmp`;
}

/**
 * WHERE A WRITE TO `path` ACTUALLY LANDS: the file itself, or — when `path` is
 * a symbolic link — the file the link points at (review of #188, M4).
 *
 * A rename over a LINK replaces the link: `credentials.env -> ~/secrets/creds.env`
 * became a plain 0600 file holding the key, the link was gone, and the file the
 * person keeps their secrets in never saw the key. `wire.ts#sightSettings`
 * already writes through a link for the same reason, and so does this now:
 * the temp sibling is minted beside the TARGET (a rename is atomic only within
 * one directory's filesystem) and renamed over the target, and the link stays
 * exactly as it was.
 *
 * Unlike `wire.ts`, a target outside the home is NOT refused: nobody else's
 * file is at stake here — the person linked their own credentials file to where
 * they keep it, which is the whole point of the link. A DANGLING link is
 * refused, as it is there: it is an arrangement part-way through being set up,
 * and writing a file where the link was waiting is how that setup silently loses.
 */
export function writeTarget(path: string): string {
  let stat;
  try {
    stat = lstatSync(path);
  } catch {
    return path; // not there yet: this write is how it comes to exist
  }
  if (!stat.isSymbolicLink()) return path;
  try {
    return realpathSync(path);
  } catch {
    let pointsAt = "(unreadable)";
    try {
      pointsAt = readlinkSync(path);
    } catch {
      /* the sentence below still says what matters */
    }
    throw new Error(
      `${path} is a symbolic link to ${pointsAt}, and nothing is there. Nothing was written: ` +
        "put the file the link points at in place first (an empty one will do), or remove the link.",
    );
  }
}

/**
 * Write `bytes` to a sibling at `mode`, then rename it over `path` — or over
 * the file `path` links to (`writeTarget`). A failure anywhere removes the
 * sibling before it is reported, so a secret is never left in a stray file
 * beside the one that should have held it.
 */
function replaceAtomically(path: string, bytes: string, mode: number): void {
  const target = writeTarget(path);
  const tmp = tempSibling(target);
  try {
    writeFileSync(tmp, bytes, { mode });
    chmodSync(tmp, mode);
    renameSync(tmp, target);
  } catch (err) {
    try {
      rmSync(tmp, { force: true });
    } catch {
      /* a temp file we could not remove is litter, not a second failure */
    }
    throw err;
  }
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
        // four or more spaces — the template's own continuation shape), and the
        // live line goes AFTER the whole block.
        //
        // **THE PLACEHOLDER LINE ITSELF STAYS** (adversarial review n4). It
        // used to be deleted, which left its continuation lines dangling under
        // the OTHER name's block, where they read as part of that explanation:
        // after `credentials set VOYAGE_API_KEY`, the two lines about
        // `"embedder": { "enabled": true }` sat directly beneath the Anthropic
        // paragraph and appeared to be about the Anthropic key. A comment costs
        // nothing — the loader reads `#` as a comment — and the file keeps
        // saying what each name is for, which is the whole reason the template
        // has paragraphs at all.
        let end = i;
        while (/^#\s{4,}\S/.test(out[end + 1] ?? "")) end += 1;
        out.splice(end + 1, 0, line);
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
  // truncated, and the secret is never on disk at anything but 0600. Through a
  // link when `path` is one; `chmod` follows the link to the same file.
  replaceAtomically(path, out.join("\n"), 0o600);
  chmodSync(writeTarget(path), 0o600);
}
