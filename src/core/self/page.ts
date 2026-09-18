/**
 * THE SELF PAGE — one written page, the same every morning, kept in the store
 * with its versions.
 *
 * Until now "Who I am:" was a rotating list of about twenty identity elements,
 * re-ranked at every boundary, and the entity the store calls the self was a row
 * whose body was its own name. A list that changes every morning is not a self;
 * it is a query result. The owner's ruling of 2026-09-18 (plan §2 item 9): at
 * wake the self is a page of prose, written in the first person, that any woken
 * session may amend and the owner may write by hand, and that says out loud when
 * there is nothing there yet. Promotion and reinforcement still decide what
 * feeds it — they are untouched by this file; the page is where the growth
 * shows.
 *
 * **One row, through the ordinary Store API.** `put` mints it, `revise` changes
 * it (archiving the prior version first, §16 G4), `versions`/`readVersion` read
 * what it used to say. Nothing here knows whether a body is a file or a column,
 * so the floor can move underneath it (plan §3, F5) without this module noticing.
 *
 * **Where it sits, and why it survives sleep.** `type: "schema"`, `kind: "self"`,
 * `meta.role = "page"` — the same shelf the identity core sits on, one role
 * along. That placement is what keeps the sleep cycle off it, using only
 * mechanisms that already existed:
 *
 *   - `dedup` skips every schema row by name (`sleep/types.ts#isSchemaRow`), so
 *     the page is never merged into something that resembles it;
 *   - `prune` is blocked by `protected` (`physics#pruneVerdict`), which the row
 *     is born with — the page is the owner's and the self's standing ink, and
 *     the prune's own vocabulary already has a word for that;
 *   - `decay` and `consolidate` write physics columns and never prose, so the
 *     worst they can do is move a number on a row nothing ranks;
 *   - `scanActive` lists `{ type: "memory" }`, so the page can never enter a
 *     briefing lane as an element and be trimmed as one.
 *
 * Old VERSIONS of the page take the ordinary retention (owner ruling 1, 2026-09-18):
 * `pruneSupersededVersions` deletes by `version_day` alone and has no exemption
 * to make one for, which is the behaviour that ruling asked for.
 *
 * **The role is invisible to `schemas/`** — `toMetaRecord` returns null for any
 * role but entity, belief and current-state, so the page is skipped by the
 * index build rather than mis-filed in it.
 */
import type { ProseDoc, Store } from "../store/index.js";

/** The `meta.role` that makes a schema row THE page. One per store. */
export const SELF_PAGE_ROLE = "page";

/** The durable row every accepted revision leaves. Read by `fired`. */
export const SELF_PAGE_REVISED_EVENT = "self.page.revised";

/**
 * The durable row every REFUSED write leaves, beside the accepted ones rather
 * than instead of them. Owner ruling 2's corollary (2026-09-18): a cap reports
 * what it refused where the owner can see it — the 196 refused asks sat in the
 * events table unseen for a fortnight.
 */
export const SELF_PAGE_REFUSED_EVENT = "self.page.refused";

/**
 * WHO WROTE THIS REVISION. Three authors, and the distinction is the reason the
 * field exists: a page the owner typed and a page a nightly writer composed are
 * both legitimate and are not the same claim. `writer` has no caller yet — it is
 * S2's, and it is enumerated here so the row S2 writes needs no new vocabulary.
 */
export const SELF_PAGE_AUTHORS = ["session", "owner", "writer"] as const;
export type SelfPageAuthor = (typeof SELF_PAGE_AUTHORS)[number];

/** The two headed sections (spec §15 item 1). The page carries them as prose. */
export const PAGE_CORE_HEADING = "Core";
export const PAGE_LATELY_HEADING = "Lately";

/**
 * What a page looks like before anything has been earned — offered by the CLI
 * and named in the tool description, never written by the engine. A store with
 * no page says so; it does not get a page of placeholders minted for it.
 */
export const PAGE_TEMPLATE = [
  `## ${PAGE_CORE_HEADING}`,
  "",
  "Still forming.",
  "",
  `## ${PAGE_LATELY_HEADING}`,
  "",
  "Still forming.",
  "",
].join("\n");

/** The title the row carries, so every id-listing surface names it in words. */
export const PAGE_TITLE = "Who I am";

/**
 * The archive reason a CLEARED page carries, so the row says why it is not live
 * rather than looking like something the prune or a merge took. Nothing is
 * destroyed: the id resolves, the prose is on disk, the versions are listed.
 */
export const PAGE_CLEARED_REASON = "page-cleared";

/** Prose meta the page keeps beside its body — the page's own provenance. */
export const PAGE_META_REVISED_ON = "revisedOn";
export const PAGE_META_REVISED_DAY = "revisedDay";
export const PAGE_META_BY = "by";
export const PAGE_META_REASON = "reason";

export interface SelfPage {
  readonly id: string;
  /** The page, verbatim. Never truncated here — see `renderPage`. */
  readonly body: string;
  readonly bytes: number;
  /** The calendar date of the last revision, `YYYY-MM-DD`; "" when unrecorded. */
  readonly revisedOn: string;
  /** The lived day of the last revision; null when unrecorded. */
  readonly revisedDay: number | null;
  readonly by: SelfPageAuthor | null;
  readonly reason: string | null;
  /** `revision` on the row: 0 for a page written once and never amended. */
  readonly version: number;
}

/**
 * THE PAGE, or null. Shaped exactly like `findIdentityCore`, and reading prose
 * for the same reason: box 2 indexes type/kind/band/archived and has no meta
 * query (schemas/INTERFACE-GAPS §2). One store has one page; the first row with
 * the role wins, and a second would be a category error no door here can make.
 */
export function findSelfPage(store: Store): string | null {
  for (const id of store.list({ type: "schema", kind: "self", archived: false })) {
    try {
      if (store.readProse(id).meta["role"] === SELF_PAGE_ROLE) return id;
    } catch {
      continue;
    }
  }
  return null;
}

/**
 * Is THIS id the page's row? Used by the owner's console to send `remove` one
 * door along (`self-page --clear`), and true of a CLEARED page too — a row that
 * was the page is still not a row removal should tombstone.
 */
export function isSelfPageRow(store: Store, id: string): boolean {
  const row = store.row(id);
  if (row === undefined || row.type !== "schema" || row.kind !== "self") return false;
  try {
    return store.readProse(id).meta["role"] === SELF_PAGE_ROLE;
  } catch {
    return false;
  }
}

/** The page as a value, or null. A page whose prose will not read is not a
 *  reason to fail a wake (§5 G7) — it reads as absent. */
export function readSelfPage(store: Store): SelfPage | null {
  const id = findSelfPage(store);
  if (id === null) return null;
  let doc: ProseDoc;
  try {
    doc = store.readProse(id);
  } catch {
    return null;
  }
  const row = store.row(id);
  const by = doc.meta[PAGE_META_BY];
  const revisedDay = doc.meta[PAGE_META_REVISED_DAY];
  const revisedOn = doc.meta[PAGE_META_REVISED_ON];
  const reason = doc.meta[PAGE_META_REASON];
  return {
    id,
    body: doc.body,
    bytes: byteLengthOf(doc.body),
    revisedOn: typeof revisedOn === "string" ? revisedOn : "",
    revisedDay: typeof revisedDay === "number" ? revisedDay : null,
    by: isAuthor(by) ? by : null,
    reason: typeof reason === "string" && reason.length > 0 ? reason : null,
    version: row?.revision ?? 0,
  };
}

function isAuthor(v: unknown): v is SelfPageAuthor {
  return typeof v === "string" && (SELF_PAGE_AUTHORS as readonly string[]).includes(v);
}

/** Local so this file imports no renderer; identical to `identity.ts#byteLength`. */
function byteLengthOf(s: string): number {
  return new TextEncoder().encode(s).length;
}

// ── what the wake prints ────────────────────────────────────────────────────

export interface RenderedPage {
  /** The body as it will be injected — the whole page, or a cut one. */
  readonly text: string;
  readonly bytes: number;
  /** True when the cap cut it; the marker line is already part of `text`. */
  readonly truncated: boolean;
  /** The page's own bytes, whole, whatever was rendered. */
  readonly wholeBytes: number;
}

/**
 * The marker a cut page carries, so a reader can tell a page that ends from a
 * page that was stopped. It names both numbers and the door to the whole thing:
 * a truncation nobody can measure is indistinguishable from a short page, which
 * is the scar the wake's own sentinel exists for (§1 G2).
 */
export function truncationMarker(shown: number, whole: number): string {
  return `[This page is ${whole} bytes; the wake shows the first ${shown}. Run 'counterparts self-page' to read it whole.]`;
}

/**
 * Cut a page to fit, AT A BOUNDARY IT CHOSE. Paragraph first, then line, then —
 * only when a single paragraph is larger than the whole cap — bytes, because a
 * page that renders nothing is worse than a page that ends mid-sentence with a
 * marker saying so.
 *
 * The marker is inside the cap: what the composition is handed is what it costs.
 */
export function renderPage(body: string, capBytes: number): RenderedPage {
  const whole = byteLengthOf(body);
  if (whole <= capBytes) {
    return { text: body, bytes: whole, truncated: false, wholeBytes: whole };
  }
  // Reserve the marker's room first. The marker states the bytes shown, which
  // changes its own length; the reserve is computed against the widest marker
  // this page could produce (the whole page's own byte count in both slots),
  // so the result is bounded without solving a second fixed point.
  const reserve = byteLengthOf(truncationMarker(whole, whole)) + 2;
  // A cap that cannot even hold the MARKER renders nothing rather than blowing
  // through the cap to explain itself: the caller's ceiling is the promise, and
  // a wake this small has an over-budget tripwire of its own to fire. Only
  // reachable under ~103 bytes of room (adversarial review m5).
  if (capBytes < reserve) return { text: "", bytes: 0, truncated: true, wholeBytes: whole };
  const room = Math.max(0, capBytes - reserve);
  const kept = cutAtBoundary(body, room);
  const shown = byteLengthOf(kept);
  const text = kept.length === 0 ? truncationMarker(0, whole) : `${kept}\n\n${truncationMarker(shown, whole)}`;
  return { text, bytes: byteLengthOf(text), truncated: true, wholeBytes: whole };
}

/**
 * A boundary is only worth taking if it KEEPS most of the room.
 *
 * Adversarial review of PR #138, measured at the real 6,144-byte cap: the rule
 * "cut at the last blank line" is a trap for the most ordinary page a model
 * writes. A page that opens `## Core\n\n` and then runs as a bullet list — or as
 * one long paragraph — has its only `\n\n` at byte 7, so the last-blank-line
 * cut kept `## Core` and threw away 6,030 bytes of room. Two shapes of a ~9.5 KB
 * page rendered **110 bytes**: a heading, a marker, and no identity at all in a
 * wake whose list the page had just suppressed. The write was accepted with a
 * reassuring `over-wake-cap` warning, so nothing on any surface said so.
 *
 * A quarter, and not a half: a page whose only paragraph break in the window
 * sits at 2.5 KB of a 6 KB room (one medium paragraph, then one very long one)
 * should take that clean 2.5 KB cut rather than fall through to a mid-sentence
 * one. The fallback is reached only when the page genuinely offers no boundary,
 * which is the single-long-paragraph shape — and there a mid-sentence cut with a
 * marker naming both numbers is the correct and only answer.
 */
export const BOUNDARY_KEEP_SHARE = 0.25;

function cutAtBoundary(body: string, room: number): string {
  if (room <= 0) return "";
  const bytes = new TextEncoder().encode(body);
  if (bytes.length <= room) return body;
  // Decode the prefix that fits, dropping a split code point rather than
  // rendering its replacement character.
  const prefix = new TextDecoder("utf-8", { fatal: false }).decode(bytes.slice(0, room));
  const clean = prefix.replace(/�+$/u, "");
  // The floor is in CHARACTERS, because the indices it is compared against are:
  // `lastIndexOf` counts characters and `room` counts bytes, so on multibyte
  // prose a byte floor rejects clean breaks that are past the share in chars.
  const floor = clean.length * BOUNDARY_KEEP_SHARE;
  const paragraph = clean.lastIndexOf("\n\n");
  if (paragraph > floor) return clean.slice(0, paragraph).trimEnd();
  const line = clean.lastIndexOf("\n");
  if (line > floor) return clean.slice(0, line).trimEnd();
  return clean.trimEnd();
}

// ── reading the page's own shape ────────────────────────────────────────────

export interface PageSections {
  readonly core: string;
  readonly lately: string;
  /** Anything before the first heading, or the whole body when it has none. */
  readonly preamble: string;
  /** False when the page carries neither heading — still a page, just prose. */
  readonly headed: boolean;
}

/**
 * Split a page at its own headings, for the surfaces that show the two parts
 * apart (the dashboard, the console). The WAKE never calls this: it prints the
 * page as is, because a page reassembled from parts is a page this engine wrote.
 */
export function pageSections(body: string): PageSections {
  const find = (heading: string): number => {
    const re = new RegExp(`^#{1,6}\\s*${heading}\\s*$`, "im");
    return body.search(re);
  };
  const core = find(PAGE_CORE_HEADING);
  const lately = find(PAGE_LATELY_HEADING);
  if (core < 0 && lately < 0) {
    return { core: "", lately: "", preamble: body.trim(), headed: false };
  }
  const first = core < 0 ? lately : lately < 0 ? core : Math.min(core, lately);
  const section = (start: number): string => {
    if (start < 0) return "";
    const rest = body.slice(start);
    const nl = rest.indexOf("\n");
    const afterHeading = nl < 0 ? "" : rest.slice(nl + 1);
    const next = afterHeading.search(/^#{1,6}\s+\S/m);
    return (next < 0 ? afterHeading : afterHeading.slice(0, next)).trim();
  };
  return {
    core: section(core),
    lately: section(lately),
    preamble: body.slice(0, first).trim(),
    headed: true,
  };
}
