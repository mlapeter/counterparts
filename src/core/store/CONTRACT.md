# `store/` — CONTRACT

## 1. Purpose

The substrate: three boxes — canonical prose, one small canonical transactional database,
one rebuildable search cache — and the single seam every write crosses.

## 2. Brain analog

None, deliberately. This is the engineering floor the brain does not have: **exactness
where the brain is reconstructive** (constitution line 9 — "biology's rules without
biology's limits"). Human memory has no separable substrate; conflating the two is how v1
ended up with canonical state spread across a prose store plus half a dozen sidecars
(Appendix A #14).

## 3. Keeps

- **Prose is canonical and readable in any editor.** [v1] Constitution line 6; test-triage
  P1 `schema-md.test.ts` / `files.test.ts` — a portable format must survive round-trip.
- **Lossless serialization that refuses ambiguity**: human-legible text beside an
  authoritative machine payload; the parser reads only the payload; content that could
  break the parser is rejected loudly, never truncated. [v1] behavioral-spec §4.2 G7.
- **Round-trip fidelity extends to metadata** — unrecognized fields survive
  parse→serialize untouched. [v1] §4.2 G6 (v1 incident: a parser silently dropped tier,
  frequency, provenance, and aliases on rewrite).
- **Omitted-when-absent** — a section never used serializes byte-identically to a store
  that predates the section. [v1] §4.2 G8.
- **Ids are immutable, never reused, type-prefixed; resolution follows lineage; a cycle,
  a dangling id, or an over-deep chain is a hard error.** [v1] §4.2 G2, test-triage P1
  `ids.test.ts`.
- **Every mutable sub-item carries a stable handle. Prose is the content; the handle is
  the identity.** [v1] §4.2 G1.
- **Archive-on-overwrite, atomic and collision-proof**, with temp files named so a
  crash-leaked one cannot be loaded as a duplicate. [v1] §16 G4.
- **The strength-only exemption to archive-on-overwrite** — a rewrite differing in nothing
  but strength bookkeeping skips the archive copy, decided by a conservative line-level
  diff, with the flag as permission only. [v1] §16 G5.
- **Destruction enforced by absence**, with a caller-universality test. [v1] §16 G1–G2,
  earned-mechanism #14: "the shape — enforced by absence, verified mechanically — is worth
  more than the specific mechanism."
- **Removal is recorded, the record is canonical and append-only, and carries no body and
  no content hash.** [v1] §16 G7–G9, scar §2.20.
- **A removed memory cannot be silently resurrected** — a deny-list at load and rebuild;
  the stray copy is skipped and logged, never deleted. [v1] §16 G12.
- **Per-item persistence isolation** — one item that fails to serialize is logged and
  skipped; the rest persist. [v1] §16 G6.
- **Three dates, deliberately distinct**: when it happened (at stated precision, never
  rounded), when it was learned, which lived day it was born on. [v1] §4.2.
- **One content-address function**, so a raw span, a run record, and a rejected proposal
  join on the same key. [v1] §17.1.

## 4. Drops / simplifies

- **The three boxes replace v1's prose-plus-sidecars layout** (owner decision 2026-08-25,
  settled):
  1. **Canonical prose** — memories, identity documents, episodes. Markdown, editable.
  2. **One small canonical transactional SQLite** — operational and structured state:
     ids, kinds, salience, `uses`, day stamps, lineage rows, entity/belief rows, prospective
     windows, the removal record, per-session gate state. **Transactional**: every
     multi-step change commits or does not.
  3. **A separate rebuildable cache** — embeddings and full-text index. **Never backed
     up**, always reconstructible, and its loss is a re-index, never a memory.
- **The universal "the DB is a cache" rebuild contract is released** (owner rescope 1,
  settled) — it now covers box 3 only. Box 2 is canonical and is backed up as a database.
- **Hand-serialized JSON sidecars are gone** (owner rescope 1, settled). All seven bugs in
  v1's 2026-08-18 verified-bug batch were structured-sidecar bugs, and the class refired
  2026-08-23; prose files never minted one (scar §2.1).
- **The staged quarantine → cooling-off → chase-every-copy erase ceremony is released**
  (owner rescope 3, settled): 871 lines, never production-fired. The kernel survives —
  owner-initiated removal, loud, recorded, unreachable from any model path. One property
  from inside the released ceremony is kept as a note for `cli/`: the cooling-off was
  deliberately **wall-clock**, not active days.
- **Forever-archive becomes bounded versioning** (owner rescope 3, settled) — superseded
  rows retained ~90 lived days.
- **Local-only absolutism is released**; the property is **no silent egress** (owner
  rescope 2, settled).

## 5. Contract

**Inputs** — write requests (create, revise, supersede, archive, prune), reads by id, by
cue, by kind, by scope; rebuild requests for box 3.
**Outputs** — durable state; resolved references; ids; the removal record; telemetry
by reference only.

**Guarantees** — **[M]** mechanized, **[A]** advisory:

1. **[M] One seam.** Every path by which text becomes canonical — steady state, jot,
   crash fallback, import, repair, replay harness, adapter — traverses one write function,
   and a totality test enumerates entrances and asserts each one does (scar §2.7).
2. **[M] The store exports no delete/remove/unlink function of any kind**, and a test
   asserts that over every export name. Removal lives in exactly one module, and a
   caller-universality test pins who may import it — **no model-reachable path may**
   (scar §2.6, earned-mechanism #14).
3. **[M] No structured mutable state is hand-serialized by more than one writer.** A test
   enumerates every mutable non-prose path in the data directory and fails on any that is
   neither transactional nor provably single-writer (scar §2.1).
4. **[M] Referential integrity is enforced by the store** — foreign keys, or one retarget
   site every write path inherits — never by remembering at each call site. Supersession
   leaves a forwarding address; a dangling reference is a hard error, not a silent drop
   (scar §2.2; v1's cross-boundary dangling gap, §6.2 known gaps, is closed by this).
5. **[M] Overwrites archive the prior version first**, atomically and collision-proof.
6. **[M] Removal is ordered so every crash point is safe**: at each moment a memory is
   fully alive, or dark *and* recorded. A failed record append is never reported as
   success — if the record cannot be written, nothing moves (§16 G10–G11).
7. **[M] Everything that must read doomed content happens before any copy is chased**
   (§16 G13), and every surface is chased including the derived index and the association
   graph (§16 G14, scar §2.2's erase variant).
8. **[M] Box 3 is behaviorally rebuildable**: a test deletes it, rebuilds from canonical,
   and asserts *the same recall for the same cues* — not merely that rebuild returned.
   Anything rebuild cannot recompute is declared, with a named owner and a repair path,
   and the count of un-recomputed items is logged at every rebuild (scar §2.12).
9. **[M] Path guards resolve and realpath both sides before comparing**; no tool accepts a
   pointer at a real store from an environment variable (scar §2.13).
10. **[M] Telemetry is content-by-reference** — ids, hashes, scores, counts, kinds, tiers;
    never body text, never user turn text; error messages included. Any surface that names
    a memory resolves the id against the live store **at render time**, so the display dies
    with the record (scar §2.20, earned-mechanism #16).
11. **[M] Every top-level path in the data directory is classified**: in the backup set, or
    on an explicit documented exclusion list. Adding a directory breaks the build until it
    is classified (scar §2.11 — v1 silently omitted the canonical episode journal from
    snapshots for three weeks).
12. **[A] Raw conversational text is not the system of record.** The shipped default keeps
    none; where a developer opts in, the window is as short as the retry path needs.
13. **[M] Reads of archived, superseded, and removal-record content emit an event.** v1
    could not answer "did the archival mechanisms ever pay for themselves" because nothing
    logged a read-back (log-audit §3). This is a v2 instrumentation requirement, not a
    preference.

## 6. Scars honored

**E5** (rescoped: transactions for structured state; locks only where files stay
canonical, and never held across a human prompt) · **§2.1** (multi-writer structured state
needs a transaction) · **§2.2** (supersede retargets every inbound reference) · **§2.4**
(every discard logs what and how much — v1's `pruneLogs` was the system's one true deleter
and emitted nothing) · **§2.7** (one chokepoint every write traverses) · **§2.11** (backup
scope asserted against the layout) · **§2.12** (a cache-rebuild contract is a test, not a
comment) · **§2.13** (path guards resolve before they compare) · **§2.20**
(content-by-reference is only private if the reference cannot be inverted).

## 7. Open questions

1. **Is the embedding cache one box or two?** Vectors and the FTS index have different
   rebuild costs — re-indexing text is free, re-embedding costs money and an API round
   trip. A vector cache that is never backed up is also a bill that must be re-paid after
   any loss. (Phase-2 storage agenda item, SYNTHESIS.)
2. **Does prose stay one file per memory?** v1 had 13.6K files across 36 scope
   directories, and 89K files in the archive tree. One file per memory is legible and
   greppable; it is also what made backups 2.6 GB.
3. **How does a v1→v2 import traverse the seam?** It is a near-certainty, and it is the
   exact shape of scar §2.7's worst incident — v1's migration path bypassed the secrets
   gate and put three live API keys into the store.
