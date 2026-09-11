/**
 * The narration vocabulary: every durable event name, as one sentence in the
 * brain's own voice, naming the SPECIFIC memory.
 *
 * The rule this file exists to keep comes from v1's dashboard batch, where the
 * owner's verdict on the first narration draft was that it was "so generic it's
 * not helpful at all": "a memory was reinforced" is a mechanism statement, and
 * a mechanism statement is a legend, not a feed. What a feed owes the owner is
 * *which* memory, *which* day, *which* number — and the mechanism by which that
 * is possible without ever putting text in the log is render-time id
 * resolution: the event carries `mem_…`, this file resolves it at the moment of
 * printing, and a memory the owner removed this morning reads as removed in a
 * line written three days ago.
 *
 * ## Tone is a payload judgement, never a name judgement
 *
 * Amber is reserved for "look at this": a refusal, a quarantine, a cap. It is
 * NOT for ordinary aging — `decay`-side band moves and prunes are calm, because
 * forgetting is the thesis, not a fault (constitution line 3; v1's flow-walk
 * item 4 is the same call made once already). So the tone of a line is decided
 * by reading the payload — a `sweep.gate` that quarantined spans is amber, one
 * that swept nothing is calm — and two events with the same name can carry
 * different tones on the same page.
 *
 * ## Totality
 *
 * `NARRATORS` is `satisfies Record<DurableEventName, Teller>`, so a durable
 * event added to the core fails `tsc` here until it has a sentence. A feed that
 * silently printed a raw name for the one new thing the system learned to
 * record is exactly the starvation this project's registries exist to prevent
 * (scar §2.17), and `test/dashboard-web.test.ts` asserts the same property at
 * runtime for anyone reading the test instead of the type.
 */
import { BAND_TRANSITION_FIELDS } from "../../../core/sleep/index.js";
import type { EventRow, Store } from "../../../core/store/index.js";
import { num } from "../layout.js";
import type { DurableEventName } from "../registries.js";
import { nodeOf } from "./flow.js";
import type { NodeKey } from "./flow.js";
import { reveal, revealHere, revealPayload, shortOf } from "./reveal.js";

/** `calm` — ordinary machinery. `notable` — a real change of state.
 *  `amber` — the owner should look. Nothing else exists. */
export type Tone = "calm" | "notable" | "amber";

export interface Narration {
  readonly text: string;
  readonly tone: Tone;
}

interface Told {
  readonly store: Store;
  readonly row: EventRow;
  /** The parsed payload, or an empty object when there was none. */
  readonly p: Record<string, unknown>;
}

type Teller = (t: Told) => Narration;

const calm = (text: string): Narration => ({ text, tone: "calm" });
const notable = (text: string): Narration => ({ text, tone: "notable" });
const amber = (text: string): Narration => ({ text, tone: "amber" });

function n(t: Told, key: string): number | null {
  const v = t.p[key];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function s(t: Told, key: string): string | null {
  const v = t.p[key];
  return typeof v === "string" && v.length > 0 ? v : null;
}

/** The event's own subject, quoted. Resolved now; withheld if confidential. */
function subject(t: Told, id?: string | null): string {
  const target = id ?? t.row.ref;
  // 84, not 60. This string is the brain page's ticker — the one sentence the
  // poster is judged on — and 60 was cutting it mid-word ("Cotter Street
  // Clinic, t…"). A feed row wraps; a truncation does not un-truncate.
  const r = reveal(t.store, target, 84);
  if (r.text !== null) return `“${r.text}”`;
  return r.label;
}

/** The same, at THIS address rather than at the end of the forwarding chain. */
function subjectHere(t: Told): string {
  const r = revealHere(t.store, t.row.ref, 84);
  return r.text === null ? r.label : `“${r.text}”`;
}

/** Ids the payload carries in a list — `recall.decision`'s two tiers. */
function idsIn(t: Told, key: string): string[] {
  const v = t.p[key];
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const item of v) {
    if (typeof item === "string") out.push(item);
    else if (item !== null && typeof item === "object" && typeof (item as { id?: unknown }).id === "string") {
      out.push((item as { id: string }).id);
    }
  }
  return out;
}

/** "X", "X and Y", "X, Y and 3 more" — a list a person reads, not a JSON array. */
function nameSome(t: Told, ids: readonly string[], cap = 2): string {
  const named = ids.slice(0, cap).map((id) => `“${shortOf(t.store, id, 62)}”`);
  const rest = ids.length - named.length;
  const head = named.length === 2 ? `${named[0]} and ${named[1]}` : (named[0] ?? "");
  if (rest <= 0) return head;
  return `${head} and ${rest} more`;
}

export const NARRATORS = {
  // ── the sleep cycle ────────────────────────────────────────────────────────
  "band.promoted": (t) =>
    notable(
      `${subject(t)} crossed into identity — it had been in real use on ${n(t, "reinforcedDays") ?? 0} separate days.`,
    ),
  "band.transition": (t) => {
    // The payload's key names are TAKEN FROM the core's own pinned field tuple
    // rather than retyped as literals — the same rule `registries.ts` keeps for
    // the axes: a renamed field fails here instead of quietly reading undefined
    // and narrating "moved from somewhere to somewhere" forever.
    const [, FROM_FIELD, TO_FIELD, DIRECTION_FIELD] = BAND_TRANSITION_FIELDS;
    const dir = s(t, DIRECTION_FIELD);
    const wasBand = s(t, FROM_FIELD) ?? "somewhere";
    const nowBand = s(t, TO_FIELD) ?? "somewhere";
    // Down is ordinary aging and reads calm. Up is a state change worth seeing.
    return dir === "down"
      ? calm(`${subject(t)} settled back from ${wasBand} to ${nowBand}. This is what forgetting looks like when it is working.`)
      : notable(`${subject(t)} moved up from ${wasBand} to ${nowBand} — it has been proving itself.`);
  },
  "memory.pruned": (t) =>
    calm(
      `I let go of ${subject(t)} at the floor — born on day ${n(t, "birthDay") ?? 0}, used ${n(t, "uses") ?? 0} times, down to ${num(n(t, "strength") ?? 0)}.`,
    ),
  "memory.merged": (t) =>
    calm(
      `${subject(t, s(t, "candidateId"))} was the same thing I already held; I merged it into ${subject(t, s(t, "originalId"))}.`,
    ),
  "memory.unmerged": (t) => {
    const original = s(t, "originalId");
    // NOTABLE, not calm: a repair is the owner reaching in, and the one line
    // that must not read as routine housekeeping.
    return notable(
      original === null
        ? `The owner put ${subject(t, s(t, "candidateId"))} back: a merge had archived it, and it should never have been a duplicate.`
        : `The owner put ${subject(t, s(t, "candidateId"))} back — a merge had folded it into ${subject(t, original)}, and it should never have been a duplicate. The use that merge credited stands.`,
    );
  },

  // ── the doors ──────────────────────────────────────────────────────────────
  "gate.chunk": (t) => {
    const proposals = n(t, "proposals") ?? 0;
    const accepted = n(t, "accepted") ?? 0;
    const fully = t.p["fullyGated"] === true;
    if (fully) {
      return amber(
        `The gate refused a whole chunk: ${proposals} proposals in, nothing kept. Worth knowing why.`,
      );
    }
    return calm(
      `A swept chunk met the gate battery — ${proposals} proposals looked at, ${accepted} kept.`,
    );
  },
  "gate.deposit": (t) => {
    const accepted = n(t, "accepted") === 1;
    const gates = Array.isArray(t.p["gates"]) ? (t.p["gates"] as { gate?: unknown; status?: unknown }[]) : [];
    const acted = gates
      .filter((g) => g.status !== "clear" && g.status !== "not-invoked")
      .map((g) => String(g.gate));
    if (!accepted) {
      // THE REFUSING GATE, and only it. `acted` is every gate that did anything
      // — the alias gate DROPS and the precision gate HEDGES while accepting by
      // design — so naming that list made "the secrets, emotion, floor gate
      // refused it" out of one floor refusal, which accuses three gates of a
      // thing only one of them did. A refusal is `status: "rejected"`.
      const refusers = gates.filter((g) => g.status === "rejected").map((g) => String(g.gate));
      const blocked = Array.isArray(t.p["blockedBy"]) ? (t.p["blockedBy"] as unknown[]) : [];
      const why = blocked.length > 0 ? blocked.map(String).join(", ") : "no reason recorded";
      const by = refusers.length > 0 ? `${refusers.join(", ")} gate` : "battery";
      return amber(`I tried to write something down and the ${by} refused it — ${why}.`);
    }
    // A clean gate whose ledger write then failed: accepted, but nothing was
    // written. Saying "I wrote something down" here would be a false claim
    // about the store, which is the one thing this feed may not make.
    if (t.p["memoryId"] === null) {
      return amber("The gate passed something I meant to keep, and the write did not land.");
    }
    if (acted.length === 0) {
      return calm("I wrote something down and every gate was clear.");
    }
    return calm(
      `I wrote something down; the ${acted.join(", ")} gate acted on it first, and it was kept.`,
    );
  },
  // THE THREE SPAWN-SEAM RECORDS (I32). Amber on sight: each of them is the
  // background half not running, and the whole reason they are durable is that
  // for a week nobody could see it. `count` is the persisted per-reason counter
  // at the moment of the row, so "the fourth time today" reads as such.
  "adapter.spawn.refused": (t) => {
    const reason = String(t.p["reason"] ?? "unnamed");
    const count = n(t, "count") ?? 1;
    return amber(
      `My background worker did not start: ${reason}${count > 1 ? `, ${String(count)} times running` : ""}. The sleep cycle, the flush and the crash fallback all ride on it.`,
    );
  },
  "adapter.spawn.failed": (t) =>
    amber(
      `My background worker could not be started at all — the system said ${String(t.p["code"] ?? "nothing")}.`,
    ),
  "adapter.runner.failed": (t) =>
    amber(
      `My background worker opened the store and then failed at ${String(t.p["step"] ?? "an unnamed step")} (${String(t.p["code"] ?? "no code")}).`,
    ),
  "sweep.gate": (t) => {
    const scopes = n(t, "scopes") ?? 0;
    const ran = n(t, "ran") ?? 0;
    const skipped = n(t, "skippedNotCrashed") ?? 0;
    const quarantined = n(t, "quarantined") ?? 0;
    const swept = n(t, "swept") ?? 0;
    // The SKIPPED row (I32): the worker ran the day — clock, flush, cycle — and
    // deliberately did not sweep, because sweeping needs a model call it had no
    // credential for. Saying "looked at 0 scopes and found nothing" of that
    // would be the silence-as-health this row exists to prevent.
    if (t.p["reason"] === "no-credential") {
      return amber(
        "I ran the day — the clock, the flush, the cycle — but skipped the crash fallback: there was no credential for the one model call it needs. Nothing was lost that a key would not fix.",
      );
    }
    if (quarantined > 0) {
      return amber(
        `The crash fallback quarantined ${quarantined} spans it could not safely read. That is the one outcome here worth looking at.`,
      );
    }
    if (ran === 0) {
      return calm(
        `The crash fallback ran and found nothing to do: ${scopes} scopes looked at, ${skipped} of them with nothing crashed. This line is here to prove the silence is real.`,
      );
    }
    return notable(
      `The crash fallback picked up after a session that ended badly — ${swept} spans swept from ${ran} of ${scopes} scopes.`,
    );
  },

  // ── retrieval ──────────────────────────────────────────────────────────────
  "recall.decision": (t) => {
    const surfaced = idsIn(t, "surfaced");
    const footnotes = idsIn(t, "footnotes");
    const turn = n(t, "turn") ?? 0;
    if (surfaced.length === 0 && footnotes.length === 0) {
      return calm(
        `On turn ${turn} nothing rose above the turn's own background, so I said nothing. Most turns end here, and that is the design.`,
      );
    }
    if (surfaced.length === 0) {
      return calm(
        `On turn ${turn} I kept ${nameSome(t, footnotes)} as a footnote — near enough to mention, not near enough to say out loud.`,
      );
    }
    const tail = footnotes.length === 0 ? "" : `, with ${footnotes.length} more held back as footnotes`;
    return notable(`On turn ${turn} ${nameSome(t, surfaced)} came to mind${tail}.`);
  },
  "adapter.recall": (t) => {
    const reason = s(t, "reason");
    if (reason === "latency-abort") {
      return amber(`Recall took too long for one turn and I abandoned it rather than make you wait.`);
    }
    const count = n(t, "surfaced") ?? n(t, "count") ?? 0;
    const bytes = n(t, "bytes") ?? 0;
    return calm(
      count === 0
        ? `A turn's recall was composed and came to nothing — no bytes handed over.`
        : `A turn's recall was composed for the host: ${count} memories, ${bytes} bytes.`,
    );
  },
  "adapter.semantic.lag": (t) => {
    const reason = s(t, "reason");
    const hits = n(t, "hits");
    if (hits !== null && hits >= 0 && reason === null) {
      return calm(`I left next turn's semantic cue ready — ${hits} neighbours precomputed.`);
    }
    return amber(`I could not leave next turn's semantic cue: ${reason ?? "no reason recorded"}.`);
  },

  // ── waking ─────────────────────────────────────────────────────────────────
  "adapter.wake.injected": (t) =>
    notable(`I handed the host who I have been — ${n(t, "bytes") ?? 0} bytes of briefing, at the start of a session.`),
  "adapter.wake.delivered": (t) => {
    const seen = t.p["seen"] === true || t.p["sentinelSeen"] === true || t.p["ok"] === true;
    return seen
      ? calm(`I checked the next turn and my briefing had arrived intact.`)
      : amber(`I checked the next turn and could not confirm my briefing arrived. A wake nobody read is a day I started as a stranger.`);
  },

  // ── the host's session ─────────────────────────────────────────────────────
  "adapter.boundary": (t) =>
    calm(
      `A session reached its boundary — ${n(t, "spans") ?? n(t, "captured") ?? 0} turns captured, the cursor moved forward.`,
    ),
  "adapter.primacy.deliver": (t) =>
    calm(`A hook delivered while the parallel run was on: ${s(t, "kind") ?? "a delivery"} went out.`),
  "adapter.primacy.standdown": (t) =>
    calm(
      `I stood down and let the other system speak — ${s(t, "reason") ?? "the parallel run's rule"}. Withholding on purpose is not a failure.`,
    ),

  // ── the authored door's ask ────────────────────────────────────────────────
  "adapter.ask": (t) => {
    const outcome = s(t, "outcome");
    if (outcome === "capped") {
      return amber(
        `I had already asked as often as a day allows, so I did not ask again. Whatever was learned in that session, I did not write.`,
      );
    }
    if (outcome === "paced") {
      return calm(`There was not enough new substance to be worth asking for, so I let the session end quietly.`);
    }
    return notable(`I asked for what this session taught me — chapter ${n(t, "chapter") ?? 0}.`);
  },
  "adapter.authorship.ask": (t) =>
    calm(
      `HISTORICAL — from the fortnight the Stop carried two asks on two pacers: the authorship half fired here (${s(t, "outcome") ?? "no outcome recorded"}).`,
    ),
  "adapter.episode.ask": (t) =>
    calm(
      `HISTORICAL — the episode half of the old two-ask Stop: the journal's own ask fired here (${s(t, "outcome") ?? "no outcome recorded"}).`,
    ),

  // ── the store's own upkeep ─────────────────────────────────────────────────
  "adapter.embed.backfill": (t) => {
    const failed = n(t, "failed") ?? 0;
    const embedded = n(t, "embedded") ?? 0;
    const remaining = n(t, "remaining") ?? 0;
    if (failed > 0) {
      return amber(
        `The worker gave vectors to ${embedded} memories and failed on ${failed}. A memory with no vector is invisible to the semantic channel.`,
      );
    }
    return calm(
      remaining === 0
        ? `The worker finished the backfill: ${embedded} memories got a vector, none left without one.`
        : `The worker gave ${embedded} memories a vector; ${remaining} are still waiting for one.`,
    );
  },

  // ── being argued with ──────────────────────────────────────────────────────
  "revision.pressure": (t) => {
    const force = n(t, "force") ?? 0;
    const after = n(t, "pressureAfter") ?? 0;
    const bar = n(t, "bar") ?? 0;
    const challenger = subject(t, s(t, "challengerId"));
    // The TARGET is resolved UNFOLLOWED. Following the supersede chain would
    // print what the belief became — and since what it became was minted from
    // this very challenge, the line would read "X broke the bar against X".
    // What the owner needs is the belief AS IT STOOD when it was argued with,
    // read live at its own address (the retained prose §5 G10 keeps for exactly
    // this), which is the same choice `stories.ts` makes for "it began as".
    const target = subjectHere(t);
    const crossed = after >= bar && bar > 0;
    return crossed
      ? notable(
          `${challenger} broke the bar against ${target} — pressure ${num(after)} against ${num(bar)}. I changed my mind.`,
        )
      : calm(
          `${challenger} argued with ${target} — force ${num(force)}, pressure now ${num(after)} of the ${num(bar)} it would take. I am holding for now.`,
        );
  },
} as const satisfies Record<DurableEventName, Teller>;

export const NARRATED_NAMES: readonly string[] = Object.keys(NARRATORS);

/**
 * WHAT KIND OF THING EACH EVENT'S `ref` COLUMN HOLDS.
 *
 * The log's `ref` is not always a memory id, and putting one that is not through
 * the memory resolver prints `[no longer at this address]` beside a turn that
 * went perfectly well — a FALSE absence, which is worse than no line at all in a
 * project whose whole absence discipline is about telling "never happened" from
 * "gone". Four names carry something else: a surfacing decision is keyed by the
 * SESSION it happened in, a chunk gate by the CHUNK's content key, an authored
 * gate by the redacted DRAFT's content hash, and the sweep gate by nothing at
 * all.
 *
 * EXHAUSTIVE BY TYPE, like every other registry here: a durable event added to
 * the core fails `tsc` until someone has said what its `ref` is, rather than
 * defaulting silently to "a memory" and rendering a lie.
 */
export const REF_KIND = {
  "adapter.ask": "none",
  "adapter.authorship.ask": "none",
  "adapter.boundary": "none",
  "adapter.embed.backfill": "none",
  "adapter.episode.ask": "none",
  "adapter.primacy.deliver": "none",
  "adapter.primacy.standdown": "none",
  "adapter.recall": "none",
  "adapter.runner.failed": "none",
  "adapter.semantic.lag": "none",
  "adapter.spawn.failed": "none",
  "adapter.spawn.refused": "none",
  "adapter.wake.delivered": "none",
  "adapter.wake.injected": "none",
  "band.promoted": "memory",
  "band.transition": "memory",
  "gate.chunk": "chunk",
  // A content address for the REDACTED draft, not a memory id: a refused
  // deposit has no memory to point at, and resolving this through the memory
  // resolver would print `[no longer at this address]` beside a gate that
  // worked perfectly. The minted id, when there is one, is in the payload.
  "gate.deposit": "proposal",
  "memory.merged": "memory",
  "memory.unmerged": "memory",
  "memory.pruned": "memory",
  "recall.decision": "session",
  "revision.pressure": "memory",
  "sweep.gate": "none",
} as const satisfies Record<DurableEventName, "memory" | "session" | "chunk" | "proposal" | "none">;

function subjectOf(store: Store, row: EventRow): string | null {
  if (row.ref === null) return null;
  switch ((REF_KIND as Record<string, string>)[row.name]) {
    case "session":
      return `session ${row.ref}`;
    case "chunk":
      return `swept chunk ${row.ref}`;
    case "proposal":
      return `authored draft ${row.ref}`;
    case "none":
      // A name this file has never heard of, carrying a ref. Print the raw
      // address rather than guessing at what it points to.
      return row.ref;
    default:
      return reveal(store, row.ref, 60).label;
  }
}

export interface NarratedEvent {
  readonly seq: number;
  readonly at: number;
  readonly day: number;
  readonly name: string;
  readonly text: string;
  readonly tone: Tone;
  readonly node: NodeKey | null;
  /** The stored ref, resolved now — or null when the row named nothing. */
  readonly subject: string | null;
  /** The payload, every id in it resolved. Ids and counts only, never text. */
  readonly detail: { key: string; value: string }[];
}

function parse(payload: string | null): Record<string, unknown> {
  if (payload === null) return {};
  try {
    const v: unknown = JSON.parse(payload);
    return v !== null && typeof v === "object" && !Array.isArray(v)
      ? (v as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

/**
 * One row, narrated. A name with no teller cannot happen (the `satisfies`
 * above), but the fallback is a sentence rather than a throw: an instrument that
 * crashes on an unfamiliar row is the one moment the owner most needs it to
 * render (scar E7).
 */
export function narrate(store: Store, row: EventRow): NarratedEvent {
  const p = parse(row.payload);
  const told: Told = { store, row, p };
  const teller = (NARRATORS as Record<string, Teller | undefined>)[row.name];
  let line: Narration;
  try {
    line = teller === undefined ? calm(`${row.name} — I have no sentence for this yet.`) : teller(told);
  } catch {
    line = calm(`${row.name} — recorded, but I could not read it back.`);
  }
  return {
    seq: row.seq,
    at: row.at,
    day: row.day,
    name: row.name,
    text: line.text,
    tone: line.tone,
    node: nodeOf(row.name),
    // Resolved BY EVENT NAME — see `REF_KIND`.
    subject: subjectOf(store, row),
    detail: revealPayload(store, p, 40),
  };
}
