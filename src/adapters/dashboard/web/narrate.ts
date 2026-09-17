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
import {
  NOISY_IF_CHRONIC_SWEEP_REASONS,
  NOISY_NOW_SWEEP_REASONS,
} from "../../../core/remember/index.js";
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

/** The gate row's per-reason map (G48), or `null` for a row written before it
 *  existed — an absence this file must never read as a pile of zeros. */
function refusalsOf(t: Told): Record<string, number> | null {
  const v = t.p["refusals"];
  if (v === null || typeof v !== "object" || Array.isArray(v)) return null;
  const out: Record<string, number> = {};
  for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
    if (typeof x === "number" && Number.isFinite(x)) out[k] = x;
  }
  return out;
}

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

/** The phases in `sleep.cycle`'s `phases` list that carry one status, by NAME.
 *  A count without names sends the owner back to the raw payload. */
function phaseNames(t: Told, status: string): string {
  const v = t.p["phases"];
  if (!Array.isArray(v)) return "unnamed";
  const names: string[] = [];
  for (const item of v) {
    if (item === null || typeof item !== "object") continue;
    const p = item as { phase?: unknown; status?: unknown };
    if (p.status === status && typeof p.phase === "string") names.push(p.phase);
  }
  return names.length === 0 ? "unnamed" : names.join(", ");
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
  // WHICH CODE WAS LIVE. Calm on master, amber otherwise: the hooks run whatever
  // the install tree has checked out, so a branch sitting in it is not a
  // development state — it is the memory layer that ran that day.
  "adapter.checkout": (t) => {
    const reason = s(t, "reason") ?? "unnamed";
    const where = `${s(t, "branch") ?? "a detached HEAD"}@${s(t, "head") ?? "?"}`;
    const dirty = n(t, "dirty") ?? 0;
    if (reason === "master") return calm(`I started at origin/master (${where}), with a clean tree.`);
    if (reason === "behind") {
      return amber(
        `I started ${String(n(t, "behindBy") ?? 0)} commits behind origin/master (${where}) — the merge had landed and this checkout had not moved.`,
      );
    }
    return amber(
      `I started on ${where}${dirty > 0 ? `, ${String(dirty)} tracked file${dirty === 1 ? "" : "s"} modified` : ""} — not origin/master. Whatever is checked out there is what ran.`,
    );
  },
  "recall.credit": (t) => {
    const credited = n(t, "credited") ?? 0;
    const expanded = n(t, "expanded") ?? 0;
    const quoted = n(t, "quoted") ?? 0;
    const reason = s(t, "reason");
    if (reason === "failed") {
      return amber(
        `A session ended and I could not decide which memories its replies had used (${s(t, "code") ?? "no code"}); nothing was credited.`,
      );
    }
    if (reason === "budget-exceeded") {
      return amber(
        `A session ended and I ran out of time deciding what its replies had used: ${credited} credited, ${n(t, "skippedForBudget") ?? 0} never compared.`,
      );
    }
    if (credited > 0) {
      return notable(
        `A session ended and ${credited} ${credited === 1 ? "memory" : "memories"} it actually used got stronger (${expanded} expanded, ${quoted} quoted).`,
      );
    }
    return calm("A session ended; its replies used nothing I had brought to mind, so nothing got stronger.");
  },
  "associate.flush": (t) => {
    const rows = n(t, "rows") ?? 0;
    const pairs = n(t, "pairs") ?? 0;
    const evicted = n(t, "evicted") ?? 0;
    const waited = n(t, "oldestMs") ?? 0;
    const reason = s(t, "reason");
    if (reason === "failed" || reason === "threw") {
      const lost = n(t, "dropped") ?? 0;
      return amber(
        `I could not write down what the sessions wired together (${s(t, "error") ?? "no code"}); ${lost} ${lost === 1 ? "link is" : "links are"} still waiting on disk for the next boundary, and the memories themselves are untouched.`,
      );
    }
    if (reason === "observer") return calm("I watched a boundary wire nothing: an instrument leaves the graph as it found it.");
    if (rows > 0) {
      const tail = evicted > 0 ? `, and ${evicted} weaker ${evicted === 1 ? "link" : "links"} made way for them` : "";
      // Over a minute means the work waited for a later boundary than the one
      // that earned it — worth saying, because it is what a busy database or a
      // worker that never ran looks like from here.
      const late = waited > 60_000 ? ` The oldest of it had been waiting ${Math.round(waited / 60_000)} minutes.` : "";
      return notable(
        `${pairs} ${pairs === 1 ? "pair" : "pairs"} of memories that were used together got more connected${tail}.${late}`,
      );
    }
    const dropped = n(t, "pendingDropped") ?? 0;
    if (dropped > 0) {
      return amber(
        `${dropped} ${dropped === 1 ? "link was" : "links were"} noticed while nothing was writing them down, and the file holding them was full.`,
      );
    }
    return calm("A boundary carried in what the sessions had wired and nothing new came of it.");
  },
  "sweep.gate": (t) => {
    const scopes = n(t, "scopes") ?? 0;
    const ran = n(t, "ran") ?? 0;
    const skipped = n(t, "skippedNotCrashed") ?? 0;
    const quarantined = n(t, "quarantined") ?? 0;
    const swept = n(t, "swept") ?? 0;
    // THE REFUSALS WORTH A LOOK (G48). Read from the per-reason map, and NEVER
    // from `otherRefusals`: that counter reads 5-7 on an ordinary day, because a
    // session stays in the crashed set after it is retired and its scope answers
    // `NOTHING_TO_SWEEP` for good. A row written before this shipped carries no
    // map and gets no amber it cannot support — the old number could not tell a
    // stuck buffer from a quiet one, so neither can a reader of it.
    //
    // AND THE AMBER IS ONLY THE FIRST HALF (M3). `BELOW_MIN_CLAIM` is permanent
    // by construction — a crashed session's leftover under `MIN_CLAIM_BYTES` is
    // restored to the buffer and the session is never forgotten, so the same
    // scope refuses that way on every run for good. This narrator holds ONE row
    // and cannot tell a first refusal from a thousandth, so ambering on it made
    // one 200-byte leftover an amber dashboard forever. It is named instead, in
    // the ordinary line, and the alarm is kept for the reasons that cannot be a
    // normal day even once: IO_FAILED and OBSERVER.
    const refusals = refusalsOf(t);
    const sum = (rs: readonly string[]): number =>
      refusals === null ? 0 : rs.reduce((acc, r) => acc + (refusals[r] ?? 0), 0);
    const noisy = sum(NOISY_NOW_SWEEP_REASONS);
    // Derived from the MAP, not from the row's own `chronicCandidates`, so a row
    // written between G48 and this fix — map present, counter absent — still
    // gets the sentence.
    const chronic = sum(NOISY_IF_CHRONIC_SWEEP_REASONS);
    const chronicNote =
      chronic === 0
        ? ""
        : ` ${chronic} scope${chronic === 1 ? "" : "s"} held a buffer too small to claim` +
          " — fine once, a buffer that never drains if it is every day.";
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
    if (noisy > 0) {
      const named = NOISY_NOW_SWEEP_REASONS.filter((r) => (refusals?.[r] ?? 0) > 0)
        .map((r) => `${r} ${refusals?.[r] ?? 0}`)
        .join(", ");
      return amber(
        `The crash fallback refused ${noisy} of ${scopes} scopes for a reason that is never a normal day: ${named}. A claim the filesystem refused is not a quiet day, and a buffer that stood down under a root that did not is wiring.${chronicNote}`,
      );
    }
    if (ran === 0) {
      return calm(
        `The crash fallback ran and found nothing to do: ${scopes} scopes looked at, ${skipped} of them with nothing crashed. This line is here to prove the silence is real.${chronicNote}`,
      );
    }
    return notable(
      `The crash fallback picked up after a session that ended badly — ${swept} spans swept from ${ran} of ${scopes} scopes.${chronicNote}`,
    );
  },

  /**
   * THE WAKE THE FALLBACK READ WITH. Neutral by rule, like `self.briefing`: a
   * trim is the budget working and a cold store is a cold store, so nothing here
   * is amber. `included: false` is not a fault — it is this row telling the
   * truth about a run that had no self to carry.
   */
  "sweep.wake": (t) => {
    const reason = String(t.p["reason"] ?? "");
    const bytes = n(t, "bytes") ?? 0;
    const elements = n(t, "elements") ?? 0;
    const omitted = n(t, "omitted") ?? 0;
    const held =
      omitted === 0
        ? ""
        : ` ${omitted} confidential or permanent ${omitted === 1 ? "line" : "lines"} stayed behind, as ${omitted === 1 ? "it" : "they"} always will.`;
    if (t.p["included"] !== true) {
      if (reason === "not-reached") {
        return calm(
          "Nothing had crashed, so no transcript was read and I composed no wake at all — a quiet sweep costs nothing to be ready. This line is here to prove the sweep looked." + held,
        );
      }
      if (reason === "no-budget") {
        return calm(
          "The crash fallback read a transcript without me: this host never said how much context it can carry, so there was no wake to compose against." + held,
        );
      }
      if (reason === "no-room") {
        return calm(
          "The crash fallback read a transcript without me: the byte cap was too small for even the shape of a wake." + held,
        );
      }
      if (reason === "failed") {
        return amber(
          `The crash fallback read a transcript without me: composing my wake failed (${String(t.p["code"] ?? "no code")}). It read cold, which is what it always did before.`,
        );
      }
      return calm(
        "The crash fallback read a transcript without me: there was nothing of me to bring yet." + held,
      );
    }
    const trimmed = n(t, "trimmed") ?? 0;
    const chunks = n(t, "chunks") ?? 0;
    const cut =
      trimmed === 0
        ? ""
        : ` The cap set aside ${trimmed} element${trimmed === 1 ? "" : "s"} that would not fit.`;
    return notable(
      `The crash fallback read a transcript as ME: ${elements} element${elements === 1 ? "" : "s"} of my wake, ${num(bytes)} bytes, went in front of ${chunks} chunk${chunks === 1 ? "" : "s"}.${cut}${held}`,
    );
  },

  /**
   * THE CYCLE'S OWN ROW (U9). Amber when a phase failed, and NAMED: a cycle that
   * lost consolidation is not a cycle that ran, and the whole point of the row is
   * that the failure is still readable a week later, out of the store.
   */
  "sleep.cycle": (t) => {
    const failed = n(t, "failed") ?? 0;
    const reason = String(t.p["reason"] ?? "ran");
    if (reason === "threw") {
      return amber(
        `My nightly cycle died partway through (${String(t.p["code"] ?? "no code")}). What it had already finished stands; the rest is retried at the next boundary.`,
      );
    }
    // BEFORE the generic failed-phase line, not after it: a failed clock IS a
    // failed phase, so the generic branch would swallow this one entirely.
    if (reason === "clock-failed") {
      return amber(
        "My nightly cycle could not advance its own clock, so it ran on the day the store already believed in. Everything else went ahead on that day.",
      );
    }
    if (failed > 0) {
      return amber(
        `My nightly cycle ran, but ${failed} phase${failed === 1 ? "" : "s"} failed — ${phaseNames(t, "failed")}. Those markers did not advance, so the work is retried tomorrow.`,
      );
    }
    const promoted = n(t, "promoted") ?? 0;
    const pruned = n(t, "pruned") ?? 0;
    const merged = n(t, "merged") ?? 0;
    if (promoted + pruned + merged === 0) {
      return calm(
        "My nightly cycle ran end to end and changed nothing worth naming — nothing promoted, nothing let go, nothing merged. This line is here to prove the quiet is real.",
      );
    }
    return notable(
      `My nightly cycle ran: ${promoted} promoted, ${pruned} let go, ${merged} merged.`,
    );
  },
  /**
   * THE WAKE RENDER'S ROW (U9). Neutral by rule: a trim is the budget working,
   * not a fault — the wake is SUPPOSED to be smaller than everything it knows,
   * and amber is reserved for "look at this" (see the tone note in the header).
   */
  "self.briefing": (t) => {
    const bytes = n(t, "bytes") ?? 0;
    const budget = n(t, "budget") ?? 0;
    const trimmed = n(t, "trimmedTotal") ?? 0;
    const where = budget > 0 ? ` of the ${num(budget)} bytes the host said it could carry` : "";
    if (trimmed === 0) {
      return calm(`I rewrote my wake: ${num(bytes)} bytes${where}, with nothing trimmed.`);
    }
    return calm(
      `I rewrote my wake: ${num(bytes)} bytes${where}, after setting aside ${trimmed} element${trimmed === 1 ? "" : "s"} that would not fit.`,
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
    if (seen) return calm(`I checked the next turn and my briefing had arrived intact.`);
    // The check says WHY since 2026-09-17, and one of its answers is not a problem:
    // a session that was owed no briefing (nothing was printed at its start).
    const outcome = s(t, "outcome");
    if (outcome === "no-wake-expected") {
      return calm(`This session was owed no briefing, so there was nothing to check for.`);
    }
    if (outcome === "printed-unverified") {
      return calm(
        `My briefing was printed intact; this host does not record what it delivered, so I could not check further.`,
      );
    }
    if (outcome === "truncated") {
      return amber(`My briefing arrived cut short — the closing marker was missing from what the session was given.`);
    }
    if (outcome === "mismatch") {
      return amber(`A briefing arrived, but not the one I composed for this session — most likely a resumed session showing an earlier run's.`);
    }
    return amber(`I checked the next turn and could not confirm my briefing arrived. A wake nobody read is a day I started as a stranger.`);
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
  "adapter.checkout": "none",
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
  // The sweep's wake row describes the RUN's prompt, and carries no id at all —
  // counts, a flag and a reason, and deliberately not one line of the self.
  "sweep.wake": "none",
  // Neither U9 row points at a memory: one describes a RUN, the other the wake
  // BUNDLE. The ids they do carry (the trimmed elements) ride in the payload.
  "sleep.cycle": "none",
  "self.briefing": "none",
  "recall.credit": "none",
  // A flush describes a SET of pairs, not one memory. The ids stay in the edge
  // rows, where they are the record; the row carries counts.
  "associate.flush": "none",
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
