/**
 * `export` — the only way memory leaves this machine, and it leaves by hand.
 *
 * The property is **no silent egress** (contract §4, owner rescope 2): the core
 * has no egress path at all, and this command is an explicit owner action. That
 * makes export the one place the constitution's line 6 — "data leaves the
 * machine only by the owner's explicit choice, encrypted, owner-keyed" — is
 * either honored or quietly broken.
 *
 * **So there is no default.** `--passphrase` encrypts; `--plaintext` is the
 * loud, deliberate opt-out for the ordinary case of copying a store to another
 * directory on the same disk. Neither flag is a REFUSAL, not a guess. An export
 * that silently wrote plaintext because nobody said otherwise is exactly the
 * shape of accident line 6 exists to prevent.
 *
 * Contract §7 OQ1 — "does export encrypt to a key the owner already has, or does
 * it mint one?" — is answered PROVISIONALLY here as: the owner supplies a
 * passphrase, and nothing is minted. Minting is friendlier and is also how an
 * owner ends up with a backup they cannot open. Recorded in NOTES.md as an open
 * owner call, not as a settled one.
 *
 * Crypto is `node:crypto` only: scrypt for the KDF, AES-256-GCM for the payload.
 * No dependency, and the format is documented in the plaintext README written
 * beside the blob — an encrypted archive whose format is undocumented is a
 * different way of losing the data.
 */
import { randomBytes, createCipheriv, createDecipheriv, scryptSync } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { gunzipSync, gzipSync } from "node:zlib";
import { join, relative } from "node:path";

import {
  DATABASE_FILE,
  confidentialByMeta,
  paths,
  renderMarkdown,
  rowTombstoned,
} from "../../core/store/index.js";
import type { MemoryRow, ProseDoc, Store } from "../../core/store/index.js";
import { isSelfPageRow } from "../../core/self/page.js";
import { journalRelativePath } from "../../core/self/journal-file.js";
import { assertSafeTarget, vacuumInto } from "./snapshot.js";

/** The KDF's cost parameters travel WITH the blob: a hardcoded N is a format
 *  that cannot be strengthened without orphaning every existing export. */
export const KDF = { N: 16384, r: 8, p: 1, keyBytes: 32, saltBytes: 16 } as const;
export const CIPHER = "aes-256-gcm";
export const EXPORT_FORMAT = "counterparts-export-1";
export const BLOB_NAME = "counterparts-export.cpx";

export type ExportMode = "plaintext" | "encrypted";

/**
 * WHAT KIND OF COPY. `database` is the whole store as one SQLite file — exact,
 * complete, and openable by anything that speaks SQLite. `markdown` is the
 * readable tree: one `.md` per memory, the journal as it stands, the self page
 * as its own file. They are different promises and neither replaces the other,
 * which is why the report names which one ran.
 */
export type ExportKind = "database" | "markdown";

export interface ExportOptions {
  target: string;
  /** Present ⇒ encrypted. Absent AND `plaintext` false ⇒ refusal. */
  passphrase?: string;
  /** The loud opt-out. */
  plaintext?: boolean;
  /** `--markdown`: the readable tree instead of the database file. */
  markdown?: boolean;
  /** `--include-confidential`: ruling 4's opt-in. Markdown only. */
  includeConfidential?: boolean;
  /** `--with-versions` on the console: every archived wording as its own file.
   *  Markdown only. */
  versions?: boolean;
  /** `--into-non-empty`: write into a directory that already holds something. */
  intoNonEmpty?: boolean;
  /** `--overwrite`: replace files this export's own paths collide with. Without
   *  it a collision is a REFUSAL — the flag that says "I know this directory has
   *  things in it" is not the same as "replace them without telling me". */
  overwrite?: boolean;
}

export interface ExportReport {
  readonly ok: boolean;
  readonly mode: ExportMode | "refused";
  readonly kind: ExportKind;
  readonly target: string;
  readonly files: number;
  readonly bytes: number;
  readonly reason: string;
  /** Live memory-bearing rows written. Zero for a database export, which
   *  carries them all without counting them. */
  readonly rows: number;
  /** Rows left out because they are confidential and nobody said otherwise
   *  (ruling 4, 2026-09-18). ALWAYS reported, including at zero. */
  readonly omittedConfidential: number;
  /** Ids whose markdown could not be rendered — named, never silently absent. */
  readonly notRendered: readonly string[];
}

/** path (relative, portable) -> file bytes. */
type Bundle = Map<string, Buffer>;

/**
 * THE BUNDLE IS THE DATABASE.
 *
 * It used to be the database plus a walk of `prose/**.md`, because that is where
 * the memories were. Since the floor (schema v6) the bodies, their archived
 * versions and their metadata are rows, so the one file IS the export and the
 * walk had nothing left to find. That makes the §2.11 rule the whole of this
 * function rather than a footnote on it: the copy goes through `VACUUM INTO`,
 * which is SQLite's own consistent-snapshot path, and never a file copy of a
 * live database — doubly so now that a torn copy would lose the words and not
 * just the bookkeeping.
 *
 * `--markdown`, `journal/` and `spans/` are F7's; this phase owns the deletion
 * of the prose walk and the move of the scratch file, nothing more.
 */
function collect(store: Store, tmpDb: string): Bundle {
  const bundle: Bundle = new Map();
  const copied = vacuumInto(paths.operational(store.dir), tmpDb);
  if (copied.ok) bundle.set(DATABASE_FILE, readFileSync(tmpDb));
  return bundle;
}

/** What a markdown walk found, beside the files it produced. */
interface MarkdownCensus {
  readonly rows: number;
  readonly omittedConfidential: number;
  readonly notRendered: string[];
  readonly journal: number;
  readonly versions: number;
  /** True when the store HOLDS a self page, whether or not it was exported. */
  readonly page: boolean;
  /** …and true when it was left out for being confidential. The manifest must
   *  not print "this store has no written self page" over a store that has
   *  one (review f6f7 MINOR-1). */
  readonly pageOmitted: boolean;
  /** Earlier wordings left out as confidential — counted APART from rows,
   *  because they are a different unit and mixing them made both wrong
   *  (MINOR-2). */
  readonly omittedVersions: number;
  /** Live rows that are ARCHIVED — faded, superseded or merged. Exported, and
   *  counted so the manifest can say so. */
  readonly archived: number;
}

/**
 * THE READABLE TREE (F7, owner ruling 4 of 2026-09-18).
 *
 * The database export above is exact and complete and can be opened by anything
 * that speaks SQLite. This is the other promise — constitution line 6's "prose
 * the owner can view" — and it is built from the ROWS, never from a walk of
 * `<store>/journal/`:
 *
 *   - the journal copy on disk is derived, and a stale one (a file whose episode
 *     was removed while the copy could not be written) would be exported as
 *     though it were live. Reading the rows cannot do that.
 *   - it is the SAME renderer and the SAME path function the copy uses, so the
 *     bytes are identical either way. "Included as is" is kept by using the copy's
 *     own code, not by copying its files.
 *
 * Grouped **by kind** — `memories/fact/`, `memories/person/`, … — because kind is
 * the axis the owner already sees in `status` and in the dashboard, it is a
 * closed set of six, and it does not change when a memory is revised. By month
 * was the alternative and it splits one belief's life across directories.
 *
 * **Filenames are ids.** Never titles: a title can be as sensitive as a body,
 * and a directory listing is the one part of an export that gets read over
 * somebody's shoulder.
 *
 * Confidential rows are OMITTED unless asked for, and **counted either way** —
 * in the terminal report and in the manifest at the top of the tree. A removed
 * (tombstoned) row is never exported at all; it has no words left to export and
 * its id is on the deny-list.
 *
 * **ARCHIVED rows ARE exported**, and the manifest says how many. A memory that
 * faded, was superseded or was merged is still the owner's own words, and an
 * export that quietly dropped them would be a copy he could not tell was
 * partial — the failure mode the confidential count exists to prevent, one class
 * over. They are NOT marked file by file: the frontmatter is
 * `renderMarkdown`'s, which carries the payload the row holds and not its
 * physics, and that renderer is shared with the journal copy. A count in the
 * manifest is the honest version of what this export knows.
 */
function collectMarkdown(store: Store, opts: ExportOptions): { bundle: Bundle; census: MarkdownCensus } {
  const bundle: Bundle = new Map();
  const census: MarkdownCensus = {
    rows: 0,
    omittedConfidential: 0,
    notRendered: [],
    journal: 0,
    versions: 0,
    page: false,
    pageOmitted: false,
    omittedVersions: 0,
    archived: 0,
  };
  const counts = census as {
    rows: number;
    omittedConfidential: number;
    notRendered: string[];
    journal: number;
    versions: number;
    page: boolean;
    pageOmitted: boolean;
    omittedVersions: number;
    archived: number;
  };
  const denied = new Set(store.deniedIds());

  const put = (path: string, text: string): void => {
    bundle.set(path, Buffer.from(text, "utf8"));
  };

  const render = (id: string, doc: ProseDoc): string | null => {
    try {
      return renderMarkdown(doc);
    } catch {
      // The id, never the reason's detail: a render refusal can name a title.
      counts.notRendered.push(id);
      return null;
    }
  };

  for (const id of store.list()) {
    if (denied.has(id)) continue;
    const row = store.row(id);
    if (row === undefined || rowTombstoned(row)) continue;
    // WHETHER THE STORE HAS A PAGE is asked BEFORE the confidentiality gate: it
    // is a fact about the store, not about this export, and answering it after
    // the `continue` made the manifest assert there was no page over a store
    // that had a confidential one (MINOR-1).
    const isPage = row.type === "schema" && isSelfPageRow(store, id);
    if (isPage) counts.page = true;
    if (row.confidential === 1 && opts.includeConfidential !== true) {
      counts.omittedConfidential += 1;
      if (isPage) counts.pageOmitted = true;
      continue;
    }
    let doc: ProseDoc;
    try {
      doc = store.readProse(id);
    } catch {
      counts.notRendered.push(id);
      continue;
    }
    const text = render(id, doc);
    if (text === null) continue;
    put(pathFor(store, row, doc), text);
    counts.rows += 1;
    if (row.type === "episode") counts.journal += 1;
    if (row.archived === 1) counts.archived += 1;

    if (opts.versions !== true) continue;
    for (const version of store.versions(id)) {
      let prior: ProseDoc;
      try {
        prior = store.readVersion(id, version.seq);
      } catch {
        counts.notRendered.push(`${id}@${String(version.seq)}`);
        continue;
      }
      // A version of a confidential row is confidential; the `versions` table
      // has no column of its own, so the LIVE row's class governs (the loop
      // above has already skipped the whole row) and the version's own meta is
      // asked too, through `confidentialByMeta` — the ONE truth table, never a
      // second reading of the class in the egress door. A gate re-implemented
      // at a call site is a gate that will one day fail open (store/index.ts).
      if (opts.includeConfidential !== true && confidentialByMeta(prior.meta)) {
        counts.omittedVersions += 1;
        continue;
      }
      const priorText = render(`${id}@${String(version.seq)}`, prior);
      if (priorText === null) continue;
      put(`versions/${id}/${String(version.seq).padStart(4, "0")}.md`, priorText);
      counts.versions += 1;
    }
  }

  put("README.md", markdownReadme(census, opts));
  return { bundle, census };
}

/** Where one row's markdown goes in the tree. Ids only; never a title. */
function pathFor(store: Store, row: MemoryRow, doc: ProseDoc): string {
  if (row.type === "episode") return journalRelativePath(doc);
  if (row.type === "schema") {
    // THE SELF PAGE IS ITS OWN FILE, at the top, because it is the one document
    // in the store the owner is most likely to want on its own.
    return isSelfPageRow(store, row.id) ? "self-page.md" : `schemas/${row.id}.md`;
  }
  return `memories/${row.kind}/${row.id}.md`;
}

/**
 * Remove any `.export-scratch-*` an interrupted export of an OLDER BUILD left in
 * this target.
 *
 * Belt and braces for exactly one window: a build between the floor landing and
 * this fix wrote its scratch here, and a kill during the vacuum left a
 * plaintext copy of the store behind under a timestamped name that the next
 * export would never collide with. Nothing writes that name any more; this is
 * how the ones already on disk go. It never throws — an export must not fail
 * because a stale file would not delete.
 */
function sweepStaleScratch(target: string): void {
  try {
    for (const name of readdirSync(target)) {
      if (!name.startsWith(".export-scratch-")) continue;
      rmSync(join(target, name), { recursive: true, force: true });
    }
  } catch {
    /* an unreadable target fails for its own reasons, further down */
  }
}

/** What the report says when this export cleaned up after an interrupted one. */
function sweptNote(swept: readonly string[]): string {
  if (swept.length === 0) return "";
  return (
    ` Also removed ${String(swept.length)} abandoned scratch ` +
    `director${swept.length === 1 ? "y" : "ies"} an interrupted export had left in the temp dir ` +
    "(each held an unencrypted copy of the store)."
  );
}

/** The prefix this module's scratch directories wear, in the OS temp dir. */
export const EXPORT_SCRATCH_PREFIX = "counterparts-export-";

/**
 * How old an abandoned scratch directory must be before a later export removes
 * it. **The bound is the whole point**: without it this sweep would delete a
 * CONCURRENT export's directory mid-vacuum, which is a collision the target
 * sweep above cannot have (it matches a name nothing writes any more).
 *
 * Same reasoning and the same number as `adapters/snapshots.ts#PARTIAL_STALE_MS`:
 * comfortably longer than any single export could plausibly still be running.
 */
export const EXPORT_SCRATCH_STALE_MS = 60 * 60_000;

/**
 * Remove abandoned `counterparts-export-*` directories from the OS temp dir.
 *
 * An interrupted `--passphrase` export leaves a PLAINTEXT SQLite copy of the
 * whole store in one (0700, so only this user can read it) and nothing swept
 * it: on macOS `/var/folders` is reaped after roughly three days of non-access,
 * otherwise it sits there (review f5c, NEW-MINOR-6). Moving it out of the
 * target was the big win; this is the rest of it.
 *
 * Exact prefix, `mtime` older than the bound, and only entries this user owns —
 * the temp dir is shared on some systems, and a sweep that took somebody else's
 * directory would be a worse bug than the one it fixes. Never throws.
 */
export function sweepStaleExportScratch(now = Date.now()): string[] {
  const swept: string[] = [];
  const root = tmpdir();
  let names: string[];
  try {
    names = readdirSync(root);
  } catch {
    return swept;
  }
  for (const name of names) {
    if (!name.startsWith(EXPORT_SCRATCH_PREFIX)) continue;
    const full = join(root, name);
    try {
      const st = statSync(full);
      if (!st.isDirectory()) continue;
      if (st.uid !== process.getuid?.()) continue;
      if (now - st.mtimeMs < EXPORT_SCRATCH_STALE_MS) continue;
      rmSync(full, { recursive: true, force: true });
      swept.push(name);
    } catch {
      /* a directory that will not stat or will not go is not this export's problem */
    }
  }
  return swept;
}

export function exportStore(store: Store, opts: ExportOptions): ExportReport {
  const kind: ExportKind = opts.markdown === true ? "markdown" : "database";
  const refused = (reason: string): ExportReport => ({
    ok: false,
    mode: "refused",
    kind,
    target: opts.target,
    files: 0,
    bytes: 0,
    reason,
    rows: 0,
    omittedConfidential: 0,
    notRendered: [],
  });

  const encrypting = typeof opts.passphrase === "string" && opts.passphrase.length > 0;
  if (!encrypting && opts.plaintext !== true) {
    return refused(
      "export refuses to choose for you: pass --passphrase <secret> to encrypt, or --plaintext to say out loud that this copy is unencrypted.",
    );
  }
  if (kind === "database" && (opts.includeConfidential === true || opts.versions === true)) {
    // NOT A HALF-KEPT PROMISE. `--include-confidential` and `--versions` decide
    // what goes into the readable tree; a database export carries every row
    // there is, so honouring either flag there would be a lie in one direction
    // and honouring neither, silently, a lie in the other.
    return refused(
      "--include-confidential and --with-versions are about the readable tree: pass --markdown with them, or drop them (a database export carries every row, confidential ones and every archived wording included).",
    );
  }

  let target: string;
  try {
    target = assertSafeTarget(store.dir, opts.target);
    mkdirSync(target, { recursive: true });
    // …and the ones an interrupted export of an older build left HERE, swept
    // BEFORE the emptiness question below: `.export-scratch-*` is a name nothing
    // writes any more, and a target holding only that is a target that is empty
    // as far as the owner is concerned.
    sweepStaleScratch(target);
    const existing = readdirSync(target);
    if (existing.length > 0 && opts.intoNonEmpty !== true) {
      return refused(
        `refusing to write into a directory that is not empty: ${target} already holds ${String(existing.length)} ` +
          `entr${existing.length === 1 ? "y" : "ies"}. An export is a whole copy, and writing one over another leaves a ` +
          "mixture of two that nothing can tell apart. Name an empty directory, or pass --into-non-empty.",
      );
    }
  } catch (err) {
    return refused(String((err as Error).message ?? err));
  }

  // THE SCRATCH GOES IN THE OS TEMP DIR — not in the store, and NOT IN THE
  // TARGET.
  //
  // It lived in `<store>/tmp/` until the floor deleted that directory with the
  // staging it existed for, and a scratch file in the store would now fail the
  // next `assertLayout()` as an unclassified top-level path (§5 G11). The first
  // fix moved it into the target, which `assertSafeTarget` proves is outside
  // the store — and that was the wrong outside. The scratch is a PLAINTEXT
  // SQLite copy of the whole store, and the target of a `--passphrase` export
  // is by definition the place the copy is going: an external disk, a synced
  // folder, the directory the owner is about to hand somebody. Review B killed
  // an exporter mid-`VACUUM INTO` and found a 4 MB unencrypted copy of the
  // memories left behind under a timestamped name that nothing would ever
  // overwrite or sweep (MAJOR-4). `--passphrase` exists precisely to say "this
  // copy leaves the machine".
  //
  // `mkdtempSync` gives it a private directory (0700 by construction) that the
  // OS reaps, so an interrupted export leaks at worst into a temp dir rather
  // than into the artefact. The whole directory goes in the `finally`.
  //
  // …and the ones an interrupted export of our own left in the OS temp dir.
  // Said out loud rather than done in silence: it is the owner's plaintext.
  const sweptScratch = sweepStaleExportScratch();
  let bundle: Bundle;
  let census: MarkdownCensus | null = null;
  if (kind === "markdown") {
    // NO SCRATCH AT ALL. The readable tree is rendered from rows into memory,
    // so a `--markdown --passphrase` export never puts one plaintext byte
    // anywhere: not in the target, not in the temp dir. The pair is supported
    // properly rather than refused — the whole bundle is built, then encrypted,
    // then one blob is written, which is the same path the database export's
    // encrypted arm already takes.
    const built = collectMarkdown(store, opts);
    bundle = built.bundle;
    census = built.census;
  } else {
    const scratchDir = mkdtempSync(join(tmpdir(), EXPORT_SCRATCH_PREFIX));
    const tmpDb = join(scratchDir, "scratch.sqlite");
    try {
      bundle = collect(store, tmpDb);
    } finally {
      rmSync(scratchDir, { recursive: true, force: true });
    }
  }

  let bytes = 0;
  for (const buf of bundle.values()) bytes += buf.length;
  const counted = {
    rows: census?.rows ?? 0,
    omittedConfidential: census?.omittedConfidential ?? 0,
    omittedVersions: census?.omittedVersions ?? 0,
    notRendered: census?.notRendered ?? [],
  };

  if (!encrypting) {
    // A COLLISION IS A REFUSAL, unless the owner said to replace.
    //
    // `--into-non-empty` means "I know this directory has things in it"; it
    // does not mean "replace them without telling me". The review watched an
    // export overwrite a README.md that said "SOMEBODY ELSE'S README —
    // irreplaceable" and report nothing (MINOR-3). Nothing is written until
    // every path has been checked, so a refused export leaves the directory
    // exactly as it found it.
    const collisions = [...bundle.keys()].filter((path) => existsSync(join(target, path))).sort();
    if (collisions.length > 0 && opts.overwrite !== true) {
      return refused(
        `refusing to replace ${String(collisions.length)} file${collisions.length === 1 ? "" : "s"} that ${collisions.length === 1 ? "is" : "are"} already in ${target}: ` +
          `${collisions.slice(0, 5).join(", ")}${collisions.length > 5 ? `, and ${String(collisions.length - 5)} more` : ""}. ` +
          "Name an empty directory, or pass --overwrite to replace exactly those.",
      );
    }
    for (const [path, buf] of bundle) {
      const out = join(target, path);
      mkdirSync(join(out, ".."), { recursive: true });
      writeFileSync(out, buf);
    }
    // The markdown tree writes its OWN manifest, as one of its files, so the
    // count and the omission are inside the artefact as well as on the
    // terminal (ruling 4: "and says how many it omitted").
    if (kind === "database") {
      writeFileSync(join(target, "README.md"), plaintextReadme(bundle.size, bytes), "utf8");
    }
    return {
      ok: true,
      mode: "plaintext",
      kind,
      target,
      files: bundle.size,
      bytes,
      reason:
        (kind === "markdown"
          ? "Unencrypted, at the owner's explicit request. Every file is plain markdown."
          : "Unencrypted, at the owner's explicit request. The database is readable by any SQLite.") +
        confidentialNote(counted.omittedConfidential, counted.omittedVersions, opts) +
        notRenderedNote(counted.notRendered) +
        replacedNote(collisions) +
        sweptNote(sweptScratch),
      ...counted,
    };
  }

  const blob = encryptBundle(bundle, opts.passphrase as string);
  writeFileSync(join(target, BLOB_NAME), blob);
  writeFileSync(join(target, "README.md"), encryptedReadme(bundle.size, bytes, kind), "utf8");
  return {
    ok: true,
    mode: "encrypted",
    kind,
    target,
    files: bundle.size,
    bytes,
    reason:
      `Encrypted with ${CIPHER} under a key derived from your passphrase. Lose the passphrase and this archive is gone.` +
      confidentialNote(counted.omittedConfidential, counted.omittedVersions, opts) +
      notRenderedNote(counted.notRendered) +
      sweptNote(sweptScratch),
    ...counted,
  };
}

/**
 * What the report says about confidential rows — ALWAYS, including at zero.
 *
 * Ruling 4 says the export "says how many it omitted", and a line that appears
 * only when something was left out is one whose absence means two different
 * things: nothing was confidential, or nobody checked.
 */
function confidentialNote(omitted: number, omittedVersions: number, opts: ExportOptions): string {
  if (opts.markdown !== true) return "";
  if (opts.includeConfidential === true) {
    return " Confidential rows are INCLUDED, because --include-confidential was passed.";
  }
  if (omitted === 0 && omittedVersions === 0) {
    return " No confidential rows were left out (there were none).";
  }
  const versions =
    omittedVersions === 0
      ? ""
      : ` and ${String(omittedVersions)} confidential earlier wording${omittedVersions === 1 ? "" : "s"}`;
  return (
    ` ${String(omitted)} confidential row${omitted === 1 ? "" : "s"}${versions}` +
    `${omitted === 1 && versions === "" ? " was" : " were"} left out;` +
    " pass --include-confidential to take them too."
  );
}

/** WHICH files this export replaced, when the owner said to. The flag whose
 *  whole purpose is "I know this directory has things in it" is the one place
 *  the report must say which of them went (review f6f7 MINOR-3). */
function replacedNote(collisions: readonly string[]): string {
  if (collisions.length === 0) return "";
  return (
    ` Replaced ${String(collisions.length)} existing file${collisions.length === 1 ? "" : "s"}, at your request: ` +
    `${collisions.slice(0, 5).join(", ")}${collisions.length > 5 ? `, and ${String(collisions.length - 5)} more` : ""}.`
  );
}

/** Rows that could not be rendered, by id — named, never silently absent. */
function notRenderedNote(ids: readonly string[]): string {
  if (ids.length === 0) return "";
  return ` ${String(ids.length)} row${ids.length === 1 ? "" : "s"} could not be rendered and ${ids.length === 1 ? "is" : "are"} NOT in this copy: ${ids.join(", ")}.`;
}

export function encryptBundle(bundle: Bundle, passphrase: string): Buffer {
  const salt = randomBytes(KDF.saltBytes);
  const iv = randomBytes(12);
  const key = scryptSync(passphrase, salt, KDF.keyBytes, { N: KDF.N, r: KDF.r, p: KDF.p });
  const manifest: Record<string, string> = {};
  for (const [path, buf] of bundle) manifest[path] = buf.toString("base64");
  const plain = gzipSync(Buffer.from(JSON.stringify(manifest), "utf8"));
  const cipher = createCipheriv(CIPHER, key, iv);
  const body = Buffer.concat([cipher.update(plain), cipher.final()]);
  const envelope = {
    format: EXPORT_FORMAT,
    cipher: CIPHER,
    kdf: { name: "scrypt", ...KDF },
    salt: salt.toString("base64"),
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    payload: body.toString("base64"),
  };
  return Buffer.from(JSON.stringify(envelope), "utf8");
}

/**
 * The read-back half. It exists because a backup nobody has ever opened is not
 * evidence of anything (contract §7 OQ3, and §2.17's "an untried path is
 * unproven"): `test/cli.test.ts` round-trips a real export through it.
 */
export function decryptBundle(blob: Buffer, passphrase: string): Map<string, Buffer> {
  const envelope = JSON.parse(blob.toString("utf8")) as {
    format: string;
    kdf: { N: number; r: number; p: number; keyBytes: number };
    salt: string;
    iv: string;
    tag: string;
    payload: string;
  };
  if (envelope.format !== EXPORT_FORMAT) throw new Error(`unknown export format: ${envelope.format}`);
  const salt = Buffer.from(envelope.salt, "base64");
  const key = scryptSync(passphrase, salt, envelope.kdf.keyBytes, {
    N: envelope.kdf.N,
    r: envelope.kdf.r,
    p: envelope.kdf.p,
  });
  const decipher = createDecipheriv(CIPHER, key, Buffer.from(envelope.iv, "base64"));
  decipher.setAuthTag(Buffer.from(envelope.tag, "base64"));
  const plain = gunzipSync(
    Buffer.concat([decipher.update(Buffer.from(envelope.payload, "base64")), decipher.final()]),
  );
  const manifest = JSON.parse(plain.toString("utf8")) as Record<string, string>;
  const out = new Map<string, Buffer>();
  for (const [path, b64] of Object.entries(manifest)) out.set(path, Buffer.from(b64, "base64"));
  return out;
}

function plaintextReadme(files: number, bytes: number): string {
  return [
    "# Counterparts export (UNENCRYPTED)",
    "",
    `${files} files, ${bytes} bytes, written at the owner's explicit request with --plaintext.`,
    "",
    `- \`${DATABASE_FILE}\` — the whole store: the memories themselves, their`,
    "  archived versions, and every structured field. Copied through SQLite's own",
    "  VACUUM INTO, never as a file copy of a live database.",
    "",
    "The rebuildable cache is deliberately not included: it is reconstructed from",
    "the database above.",
    "",
    "This copy is not encrypted. Treat it the way you would treat the store itself.",
    "",
  ].join("\n");
}

/**
 * THE MANIFEST, and it is a file INSIDE the tree.
 *
 * Ruling 4 asks the export to say how many confidential rows it omitted. The
 * terminal says it, and the terminal scrolls away; six months later the only
 * thing left is the directory, and a directory that does not say what is
 * missing from it reads as complete. So the count lives here too — and at zero,
 * for the same reason.
 */
function markdownReadme(census: MarkdownCensus, opts: ExportOptions): string {
  // TWO UNITS, SAID APART. A row and an earlier wording of a row are different
  // things, and one counter for both reported 3 for an open memory with three
  // confidential wordings and 1 for a confidential memory with three — four
  // things omitted either way (review f6f7 MINOR-2). The version count is only
  // meaningful when versions were being exported at all.
  const omitted =
    opts.includeConfidential === true
      ? "- Confidential memories are **included**: `--include-confidential` was passed."
      : census.omittedConfidential === 0 && census.omittedVersions === 0
        ? "- Confidential memories omitted: **0** (there were none)."
        : `- Confidential memories omitted: **${String(census.omittedConfidential)}**` +
          (opts.versions === true
            ? `, and **${String(census.omittedVersions)}** confidential earlier wording${census.omittedVersions === 1 ? "" : "s"} of memories that are otherwise here.`
            : ". (Earlier wordings were not being exported; `--with-versions` writes them, confidential ones excepted.)") +
          " They are still in your store; re-run with `--include-confidential` to take them too.";
  return [
    "# Counterparts export (markdown)",
    "",
    `${census.rows} rows, readable in any editor — memories, the journal, and the self page.`,
    "Rendered from the database; this is a COPY, and the store itself is still where the",
    "memories live.",
    "",
    "## What is here",
    "",
    "- `memories/<kind>/<id>.md` — one file per memory, grouped by kind. The file name is",
    "  the memory's id; the title, dates and everything else are in the frontmatter.",
    census.archived === 0
      ? "  None of them is archived: every memory here is a live one."
      : `  ${String(census.archived)} of them ${census.archived === 1 ? "is" : "are"} ARCHIVED — faded, superseded or merged.` +
        " They are still your words, so they are here; the files do not mark which," +
        " and `counterparts status` is where that is readable.",
    census.pageOmitted
      ? "- `self-page.md` — **omitted as confidential**. This store HAS a written self page; it was left out of this copy. `--include-confidential` takes it."
      : census.page
        ? "- `self-page.md` — the written self page, as it stands."
        : "- `self-page.md` — absent: this store has no written self page.",
    "- `schemas/<id>.md` — the structured rows that are not the page (the identity core, beliefs).",
    `- \`journal/<year>/<date>-<id>.md\` — the first-person episode journal, as is: ` +
      `${String(census.journal)} episode${census.journal === 1 ? "" : "s"}.`,
    census.versions > 0
      ? `- \`versions/<id>/<seq>.md\` — ${String(census.versions)} earlier wording${census.versions === 1 ? "" : "s"}, oldest first (\`--with-versions\`).`
      : "- `versions/` — not included. Pass `--with-versions` to export every earlier wording too.",
    "",
    "## What is NOT here",
    "",
    omitted,
    "- Removed memories. A removal is permanent; a tombstoned row has no words left to export.",
    census.notRendered.length === 0
      ? "- Nothing else. Every live row this export could reach is in it."
      : `- ${String(census.notRendered.length)} row(s) whose markdown could not be rendered: ${census.notRendered.join(", ")}.`,
    "- The structured physics — strengths, edges, the association graph, the event log.",
    "  Those are in the database, and `counterparts export --out <dir> --plaintext` (without",
    "  `--markdown`) copies the whole thing as one SQLite file.",
    "",
    "Nothing reads this tree back in. Editing a file here changes nothing in your store.",
    "",
  ].join("\n");
}

function encryptedReadme(files: number, bytes: number, kind: ExportKind): string {
  return [
    "# Counterparts export (encrypted)",
    "",
    `\`${BLOB_NAME}\` holds ${files} files (${bytes} bytes before compression) — ` +
      (kind === "markdown"
        ? "the readable markdown tree, including its own manifest."
        : "the whole store as one SQLite database."),
    "",
    "Format, so this is never an archive you cannot open:",
    "",
    `1. The blob is JSON: \`{format, cipher, kdf, salt, iv, tag, payload}\` — all base64.`,
    `2. Key = scrypt(passphrase, salt, N/r/p from the \`kdf\` field), ${KDF.keyBytes} bytes.`,
    `3. Payload = ${CIPHER}(gzip(JSON manifest of path -> base64 file bytes)).`,
    "",
    "The passphrase is yours and is not stored anywhere. There is no recovery path;",
    "that is the point of it being owner-keyed.",
    "",
  ].join("\n");
}
