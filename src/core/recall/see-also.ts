/**
 * SEE-ALSO FROM NAMED IDS (2026-10-29, PP1; an experiment, switch
 * `SEE_ALSO_NAMED_IDS`).
 *
 * A memory whose text names another memory's id (`mem_…`) brings that memory
 * along when the turn shows it: one footnote line, labelled `See also:`, after
 * everything the gate admitted. The 10-25 ping/pong miss is the case: the
 * note about the miss names the rule, cue learning wires a turn's words only
 * to what the turn showed, so every "pong" answered from the note trained
 * `ping → note` and the rule never came back on its own. Brought along and
 * used, the rule gets the turn's cue credit like any footnote (the gate
 * record is an ordinary footnote's, `trains` true), so the next bare "ping"
 * reaches it by its own learned pair.
 *
 * Read from the texts of what the turn SHOWS — the loud line and the cued
 * footnotes, never a quiet pointer or another see-also (no chains) — in the
 * order the gate ranked them. Each named id is resolved to the memory that
 * holds now (`headOf`), then held to what the turn could have shown at all
 * (`recallableRow`: not removed, archived, superseded, the self page, a
 * handoff, a card or a belief; not below reach) and to what it would not
 * show again (already shown this turn or this session, written by this
 * session, another project's under `RECALL_BY_PROJECT`, habituated, or a
 * candidate the gate inhibited). One per shown memory, `SEE_ALSO_MAX` a
 * turn. Reads only; the caller records.
 */
import { strength } from "../physics/index.js";
import type { ProseDoc, Store } from "../store/index.js";
import { rowToPhysics } from "../store/index.js";
import type { Kind } from "../types.js";
import { gatedSal, recallableRow } from "./activate.js";
import type { Candidate } from "./activate.js";
import type { CandidateVerdict, Verdict } from "./gate.js";
import { headOf } from "./standing.js";
import type { RecallTunables } from "./tunables.js";

/** A memory id anywhere in a text, as the store mints them. */
const NAMED_ID = /\bmem_[0-9a-f]{12,16}\b/g;

/** How many named ids one shown memory's text is read for: bounded reads on a
 *  text that names many. The first that may ride along is the one. */
export const SEE_ALSO_NAMES_READ = 4;

/** Verdicts that mean the turn would not show the memory whatever named it. */
const HELD: ReadonlySet<Verdict> = new Set<Verdict>(["inhibited", "echo-skipped", "project-skipped", "dedup-suppressed"]);

/** The ids a text names, first mention first, each once. */
export function namedIds(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(NAMED_ID)) if (!out.includes(m[0])) out.push(m[0]);
  return out;
}

export interface SeeAlsoInput {
  readonly store: Store;
  readonly day: number;
  /** What the turn shows, ids in render order (loud, then footnotes). */
  readonly shown: readonly string[];
  /** Of `shown`, the ones whose text is read: loud and cued footnotes. */
  readonly namers: readonly string[];
  /** Every candidate of the turn, by id (its doc, its verdict). */
  readonly candidates: ReadonlyMap<string, Candidate>;
  readonly verdicts: readonly CandidateVerdict[];
  /** This session's earlier showings. */
  readonly seen: Readonly<Record<string, unknown>>;
  readonly echo?: ReadonlySet<string>;
  /** Another project's work, when `RECALL_BY_PROJECT` holds it back. */
  readonly elsewhere?: (id: string) => boolean;
  readonly habituated?: ReadonlyMap<string, number>;
  readonly background: number;
  readonly t: RecallTunables;
}

export interface SeeAlso {
  readonly id: string;
  /** The shown memory whose text named it. */
  readonly by: string;
  readonly doc: ProseDoc;
  /** Its verdict as shown: footnoted, via `see-also`. */
  readonly verdict: CandidateVerdict;
}

/** The memories this turn's shown ones bring along. Never throws: a failure brings none. */
export function seeAlso(input: SeeAlsoInput): SeeAlso[] {
  const { store, t } = input;
  if (!t.SEE_ALSO_NAMED_IDS || !(t.SEE_ALSO_MAX >= 1)) return [];
  const max = Math.floor(t.SEE_ALSO_MAX);
  const out: SeeAlso[] = [];
  try {
    const taken = new Set<string>(input.shown);
    const verdictOf = new Map(input.verdicts.map((v) => [v.id, v]));
    let denied: Set<string> | null = null;
    for (const by of input.namers) {
      if (out.length >= max) break;
      const doc = input.candidates.get(by)?.doc;
      if (doc === undefined) continue;
      const names = namedIds(`${doc.title ?? ""}\n${doc.body}`).filter((id) => id !== by).slice(0, SEE_ALSO_NAMES_READ);
      for (const named of names) {
        const id = headOf(store, named) ?? named;
        if (taken.has(id) || id === by) continue;
        if (input.seen[id] !== undefined || input.echo?.has(id) === true || input.habituated?.has(id) === true) continue;
        if (input.elsewhere?.(id) === true) continue;
        const prior = verdictOf.get(id);
        if (prior !== undefined && HELD.has(prior.verdict)) continue;
        denied ??= new Set(store.deniedIds());
        const row = recallableRow(store, id, { denied, ambient: true, day: input.day });
        if (row === undefined || row === "below-reach") continue;
        const cand = input.candidates.get(id);
        const physics = cand?.physics ?? rowToPhysics(row);
        const verdict: CandidateVerdict =
          prior !== undefined
            ? { ...prior, verdict: "footnoted", trains: true, via: "see-also", seeAlso: { by } }
            : {
                id,
                kind: row.kind as Kind,
                verdict: "footnoted",
                activation: 0,
                cue: 0,
                temporal: 0,
                semantic: 0,
                arrival: 0,
                hops: 0,
                cueFraction: 0,
                sal: gatedSal(physics, false),
                strength: strength(physics, input.day),
                // An id is an address, not an ambiguous handle: a use of what
                // it brought is a use like any other, and it trains.
                trains: true,
                bar: input.background,
                via: "see-also",
                seeAlso: { by },
              };
        out.push({ id, by, doc: cand?.doc ?? store.readProse(id), verdict });
        taken.add(id);
        break;
      }
    }
    return out;
  } catch {
    return [];
  }
}
