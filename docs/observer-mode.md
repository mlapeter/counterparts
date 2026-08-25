# Observer mode — a MODE of the core API, not a module (owner ruling 2026-08-25)

## 1. Purpose

An instrument leaves the store as it found it: read-only in both directions, everywhere,
by construction.

## 2. Brain analog

**None — this is an explicit anti-Heisenberg deviation** (constitution line 12). In humans
every retrieval changes the trace; there is no way to remember something without
remembering *that* you remembered it. This module exists precisely because the biological
answer is unacceptable for an instrument: you cannot measure a memory system whose
measurement is itself an encoding event.

## 3. Keeps

- **Read-only in BOTH directions: strengthens nothing AND deposits nothing.** [v1]
  behavioral-spec §15, earned-mechanism #12 — widened 2026-08-05 after a probe wrote an
  episode into the live store while technically honoring the older, narrower "strengthens
  nothing" rule.
- **Strengthens nothing** — no edge training, no `uses` increments, no strength or band
  movement, no firing-state advance, no reference credit. [v1] §15 G1.
- **Deposits nothing** — no span captured, no episode ask, no memory written, no proposal
  queued. [v1] §15 G2.
- **Spawns no consolidation** — because a cycle advances the clock, decays the store, and
  rewrites the briefing: *the instrument mutating what it measures.* [v1] §15 G3.
- **Reads normally.** [v1] §15 G4 — the wake is delivered, recall works, surfacing and
  ranking compute as usual. *An observer still sees; it just leaves no trace.* It is
  additionally treated as a non-owner for confidentiality.
- **Telemetry is the deliberate exception.** [v1] §15 G5, earned-mechanism #13 — a
  stood-down instrument logs its stand-down, so it is distinguishable from a broken hook.
- **Fail direction is toward standing down.** [v1] §15 G6 — an unreadable configuration
  falls back to observer, never to "encode anyway."
- **One predicate, living where read-only surfaces can reach it.** [v1] §15 G7 — a second
  definition is a leak waiting to happen (v1 had exactly that: a dashboard's own string
  comparison reported training-ON under a value the real predicate treated as observer).
  The predicate deliberately lives apart from any mutation module, so a **structurally
  read-only** surface can report the same truth without importing the ability to mutate.
- **The stand-down check belongs at the store seam, not only at the entry point** [v1] §15
  G8 — so a future caller inherits it instead of having to remember it.
- **The claim is checked against every writable substrate, caches included.** [engram E7's
  criterion] v1's residual on record: observer sessions warmed the embedding query cache,
  which is cache-tier but was undocumented.

## 4. Drops / simplifies

- **Nothing is dropped.** This module has no released mechanism, no tuning surface, and no
  earned-but-superseded parts. v1's own note is the whole disposition: *TUNABLE — nothing
  meaningful. Structural — all of the above.*
- **One v1 inconsistency is resolved rather than inherited**: the telemetry exception was
  applied unevenly — one refusal path logged its stand-down and a sibling stayed silent
  (§15 known gap). **v2's answer: every stand-down is observable.** A totality test
  enumerates stand-down sites and asserts each emits.

## 5. Contract

**Inputs** — the session's configuration and host-reported role; nothing else.
**Outputs** — one boolean predicate, and a stand-down event at every site that consults it.

**Guarantees** — **[M]** mechanized, **[A]** advisory:

1. **[M] One predicate.** A test asserts exactly one definition exists in the package and
   that every stand-down site imports it.
2. **[M] The predicate module imports nothing that can mutate.** Structurally read-only, so
   a dashboard, a probe, or a replay scorer can report the same truth without acquiring the
   ability to change it.
3. **[M] The stand-down is enforced at the store seam**, not only at entry points.
4. **[M] Byte-identical canonical state.** One test runs a full probe session against a
   populated store and asserts the canonical prose and the canonical database are
   byte-identical afterwards, and that the cache's mutations are enumerated and declared
   (scar E7's criterion, widened to caches by v1's own residual).
5. **[M] Fail toward standing down.** A config-load failure resolves to observer.
6. **[M] Every stand-down emits an event.** Silence is indistinguishable from a broken hook
   (scar §2.4); this is the module's single deliberate write.
7. **[M] An observer is a non-owner for confidentiality.**
8. **[A] Nothing here is tunable, and that is the answer.** Observer mode joins the
   non-ablatable class with the secrets gate: you do not A/B a property whose "off" arm is
   a trust hazard.

## 6. Scars honored

**E7** (observer mode is first-class, read-only in both directions — this module *is* the
scar) · **§2.4** (a stood-down instrument must be distinguishable from a broken one, and
every stand-down site is a distinct record) · **§2.6** (mechanize invariants: the
predicate is enforced at the seam, not stated in a doc) · **§2.13** (an instrument that
finds a pre-set data-directory variable errors rather than honoring it — v1's replay
harness silently honored one, which is the observer scar escalated from training the store
to destroying its graph).

## 7. Open questions

1. **Is this a module, or a mode threaded through the core API?** *The module map's
   standing check-in question.* Scar E7 says observer mode is **first-class** — but
   first-class is not the same as *separate directory*. The case for a module: guarantee 2
   requires a definition that imports nothing mutable, and a directory is the cheapest way
   to make that checkable. The case for a mode: every guarantee above is a refusal *inside
   another module's write path*, and a module containing one boolean plus a test suite is
   the kind of ceremony Amendment 15 exists to prevent. A third shape worth naming: the
   predicate is a field on the request context every store call already takes, and this
   directory holds only the totality tests. **Left open deliberately.**
2. **What is the enumerated, declared set of cache mutations an observer may cause?** v1
   left the embedding query-cache warming undocumented. Either it is declared and allowed,
   or the observer path skips the cache and pays the latency.
