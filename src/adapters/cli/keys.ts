/**
 * `adapters/cli/keys.ts` — the one file a key is written through, and the one
 * upgrade a key still offers.
 *
 * New-user finding #3 (2026-09-21) was "nothing asks for the keys at all", and
 * for a round the install asked for both, one at a time. **Since 2026-09-23 it
 * asks for neither** (roadmap C): recall by meaning runs on a local table that
 * ships with the package, and a session that ended before it was written up is
 * written up by the next session in that project. Both keys are UPGRADES, and
 * `counterparts credentials set <NAME>` (`commands.ts#credentialsCommand`) is
 * the door for each.
 *
 * What each key does now:
 *
 *   - **`ANTHROPIC_API_KEY`** can let the worker write up an ended session at
 *     once instead of waiting for the next one — which sends that conversation
 *     to Anthropic. So saving the key turns nothing on; `offerCrashWriteUp`
 *     asks, `[y/N]`, and only a yes moves the switch.
 *   - **`VOYAGE_API_KEY`** is FROZEN with the paid embedder it feeds (ROADMAP
 *     §"Amendments", 2026-09-23): kept for a configuration that already names
 *     Voyage, never offered, never switched on. `voyageKeyLine` is the one
 *     sentence a person who saves it is told.
 *
 * ── The rules, and which of them are not mine to relax ──────────────────────
 *
 *   1. **A value is written, and goes nowhere else.** Not to `io.out`, not to
 *      `io.err`, not into a warning, not into a result object, not into an
 *      event. Everything that leaves this module is a NAME, a PATH or an
 *      outcome word — the same bound `claude-code/credentials.ts` holds on the
 *      reading side.
 *   2. **A key is not consent.** An egress moves on an explicit yes and on
 *      nothing else, and the yes is `[y/N]`: Enter is no (adversarial review
 *      M3, 2026-09-22).
 *   3. **A configuration is edited atomically, and never created here**
 *      (`setConfigKeys`): sibling, then rename, every other key kept in its
 *      order, through a symlink to its target.
 *
 * ── Why a separate file ─────────────────────────────────────────────────────
 *
 * `commands.ts` is eight thousand lines and several builders edit it at once.
 * More durably: this module imports only a TYPE from `commands.ts`, the way
 * `ui.ts` does, so `commands.ts` can import from here without minting an ESM
 * cycle.
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

import { API_KEY_ENV, EMBED_KEY_ENV, embedderKind } from "../claude-code/config.js";
import type { AdapterConfig, EmbedderSource } from "../claude-code/config.js";
import type { Io } from "./commands.js";
import { confirm } from "./ui.js";
import type { Ui } from "./ui.js";
// The layout sniffing `connect` uses on a settings file (#188, review n1), so a
// configuration edited here keeps the indent and line endings it had.
import { settingsBytes, sniffSettingsFormat } from "./wire.js";

// ── the Anthropic key's one upgrade ─────────────────────────────────────────

/**
 * THE SWITCH `credentials set ANTHROPIC_API_KEY` OFFERS: the configuration key
 * and the value that turns the API write-up on.
 *
 * Owned by the crash write-up (roadmap C2, PR #192), which reads it strictly
 * in `claude-code/config.ts` — `"api"` is the one value, and ABSENT means the
 * default, the next session in that project; written here, by the one command
 * that offers it. This pair is the only place this module spells it.
 */
export const CRASH_WRITE_UP_KEY = "crashWriteUp";
export const CRASH_WRITE_UP_API = "api";

/** What happened to the crash write-up switch. */
export type CrashWriteUpOutcome =
  /** Switched on now, in the configuration, at the person's word. */
  | "enabled"
  /** It already said `"api"`. Nothing was written. */
  | "already-on"
  /** Asked, and the answer was no. The configuration is untouched. */
  | "declined"
  /** Asked, answered yes, and the configuration could not be edited. The KEY
   *  is written; the switch is not. */
  | "failed";

/**
 * "Write up ended sessions with the API from now on?" — asked once, after
 * `credentials set ANTHROPIC_API_KEY` has saved the key at a terminal.
 *
 * The egress is IN the lines above the question, and the default is no: a
 * person who just pasted a key has not thereby agreed to send a conversation
 * anywhere (rule 2). `Ctrl-C` propagates — the caller says the key is saved
 * and nothing else changed.
 */
export async function offerCrashWriteUp(
  io: Io,
  u: Ui,
  configPath: string,
): Promise<CrashWriteUpOutcome> {
  if (configValue(configPath, CRASH_WRITE_UP_KEY) === CRASH_WRITE_UP_API) {
    u.hint("Ended sessions are already written up with the API.");
    return "already-on";
  }
  u.blank();
  u.hint("Without the key, a session that ended before it was written up waits for the");
  u.hint("next session in that project. With it, the worker writes it up at once — and");
  u.hint("sends that conversation to Anthropic.");
  const yes = await confirm(io, "Write up ended sessions with the API from now on?", { default: false });
  if (!yes) {
    u.ok(`${API_KEY_ENV} is saved; ended sessions still wait for the next session in their project.`);
    return "declined";
  }
  const edit = setConfigKeys(configPath, { [CRASH_WRITE_UP_KEY]: CRASH_WRITE_UP_API });
  if (edit.ok) {
    // No full stop after a PATH: a sentence's own punctuation reads as part of
    // the thing it names, and this line is often copied.
    u.ok(`ended sessions are written up with the API now — set in ${configPath}`);
    return "enabled";
  }
  u.warn(`could not switch it on: ${edit.reason}. The key is saved.`);
  u.hint(`Once that file reads, run this again: counterparts credentials set ${API_KEY_ENV}`);
  return "failed";
}

// ── the Voyage key, frozen ──────────────────────────────────────────────────

/**
 * THE ONE LINE A PERSON WHO SAVES `VOYAGE_API_KEY` IS TOLD.
 *
 * Until 2026-09-23 this command offered to switch the paid embedder on after
 * saving the key. Voyage is frozen now — kept for configurations that already
 * name it, never offered — so the line says which of the two this is:
 *
 *   - the configuration names Voyage (on, and `kind` is `"voyage"` or absent,
 *     which is how a 0.2.0 file says it): the key is used, and Voyage is
 *     deprecated;
 *   - no block, and the file already held a Voyage key (`source` is
 *     `absent-voyage-key`): recall by meaning is OFF, and the line says so;
 *   - anything else: nothing turns on with it, and the local table is what
 *     recall by meaning runs on.
 */
export function voyageKeyLine(config: AdapterConfig, source?: EmbedderSource): string {
  // THE ONE CASE THE DEFAULT IS OFF (review of #195, MINOR 4): no block, and
  // the credentials file ALREADY held a Voyage key before this save. The pin
  // does not fire (nothing changes), so recall by meaning stays off — said so,
  // with the command that turns the table on.
  if (source === "absent-voyage-key") {
    return `Recall by meaning is OFF here: this configuration names no embedder and a Voyage key is saved, so the local table is not assumed. Turn it on: counterparts install --force --embedder`;
  }
  const named = config.embedder?.enabled === true && embedderKind(config) === "voyage";
  return named
    ? `This configuration names Voyage, so recall by meaning uses ${EMBED_KEY_ENV}. Voyage is deprecated; new installs use a local table instead.`
    : `Nothing turns on with ${EMBED_KEY_ENV}: recall by meaning runs on a local table by default, and Voyage stays only where a configuration already names it.`;
}

/**
 * KEEP THE LOCAL TABLE ON WHEN A VOYAGE KEY ARRIVES (roadmap C3).
 *
 * An absent `embedder` block reads as the local table, ON — unless the
 * credentials file holds a Voyage key (`config.ts#resolveEmbedder`), which is
 * how a 0.2.0 setup that saved a key and never switched the paid embedder on
 * is kept as it was. The rule has one edge a person could fall off: saving a
 * Voyage key into a configuration with no block would switch recall by meaning
 * OFF, silently, on the next process. So before that can happen the block the
 * default stood for is WRITTEN — `{ enabled: true, kind: "static" }` — and the
 * caller says so. Not when the file already held a Voyage key (nothing
 * changes), not when a block is there (it is the person's), not for an
 * observer's configuration, and never creating a file.
 */
export function pinLocalTable(
  configPath: string,
  voyageKeyHeldBefore: boolean,
): "pinned" | "not-needed" | { failed: string } {
  if (voyageKeyHeldBefore) return "not-needed";
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(configPath, "utf8"));
  } catch {
    return "not-needed";
  }
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return "not-needed";
  const rec = raw as Record<string, unknown>;
  if (rec["embedder"] !== undefined || rec["observer"] === true) return "not-needed";
  const edit = setConfigKeys(configPath, { embedder: { enabled: true, kind: "static" } });
  return edit.ok ? "pinned" : { failed: edit.reason };
}

// ── the configuration edit ──────────────────────────────────────────────────

export type ConfigEdit = { ok: true } | { ok: false; reason: string };

/** One top-level value of a configuration, as its JSON says it, or undefined
 *  when the file, the JSON or the key is not there. Never throws. */
function configValue(configPath: string, key: string): unknown {
  try {
    const raw = JSON.parse(readFileSync(configPath, "utf8")) as unknown;
    return raw !== null && typeof raw === "object" && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)[key]
      : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Set top-level keys in an existing `claude-code.json`.
 *
 * Three things this has to get right, and the third is why it is not
 * `writeOnce`:
 *
 *   - **The exact value.** `loadConfig` reads its knobs strictly, so the
 *     caller passes the literal shape the reader expects and this writes it
 *     as given.
 *   - **Everything else in the file survives.** The parsed object is edited and
 *     re-serialised, so `dataDir`, `credentialsFile`, `identity`, the budget and
 *     anything an owner added by hand keep their values AND their order — JSON
 *     round-trips insertion order, and a key that is not there is appended.
 *   - **Atomic.** Sibling, then rename: `install`'s `writeOnce` writes straight
 *     over the target, and a crash between the truncate and the write leaves the
 *     file the hooks read EMPTY, which is every hook standing down silently.
 *     That is I32's shape aimed at the config instead of the credentials.
 *
 * It never CREATES the file: a config invented here would name no store.
 */
export function setConfigKeys(configPath: string, patch: Readonly<Record<string, unknown>>): ConfigEdit {
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
  const body = { ...(raw as Record<string, unknown>), ...patch };
  // THE FILE KEEPS ITS LAYOUT (review of #195, NIT 7): its indent unit, its
  // majority line ending and its final newline, read the way `connect` reads a
  // settings file (#188, `wire.ts#sniffSettingsFormat`). One difference, on
  // purpose: a configuration somebody wrote on ONE line stays on one line —
  // for a settings file a one-liner is almost always the host's `{}`, but a
  // one-line `claude-code.json` is a choice a person made.
  const format = sniffSettingsFormat(text);
  const oneLine = !/[\r\n]/.test(text.trimEnd());
  const bytes = oneLine
    ? `${JSON.stringify(body)}${/[\r\n][ \t]*$/.test(text) ? format.eol : ""}`
    : settingsBytes(body, format);
  try {
    replaceAtomically(configPath, bytes, mode);
  } catch (err) {
    return { ok: false, reason: String((err as Error).message ?? err) };
  }
  return { ok: true };
}

/**
 * THE TEMP NAME BOTH WRITERS USE: `<path>.<pid>.tmp` (review n4).
 *
 * It was `<path>.tmp` for both `writeCredential` and the configuration edit
 * (`enableEmbedder` then, `setConfigKeys` now), so two
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
