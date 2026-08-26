# `adapters/cli/` — CONTRACT

## 1. Purpose

The `counterparts` command: status, install, and the owner-only operations — removal,
export, backup and restore — that no model-reachable path may perform.

## 2. Brain analog

None, and deliberately so. **Named deviation** (constitution line 12): humans have no
console on their own memory — no inspection of every unfalsifiable anchor, no deliberate
erasure, no export. This module is the improvement over the biological original that
constitution lines 4 and 6 promise: the self is **governed and owner-visible**, and the
owner owns the data.

## 3. Keeps

- **Destruction lives in exactly one place, and a caller-universality test pins who may
  reach it.** [v1] behavioral-spec §16 G1–G2, earned-mechanism #14 — *no model-reachable
  path may import it, and that test failing is the point.*
- **Removal is recorded, and the record is canonical, append-only, and carries no body and
  no content hash.** [v1] §16 G7–G9, scar §2.20 — a hash of low-entropy content is
  brute-forceable, which would make the record of removal a leak of the thing removed.
- **Removal is ordered so every crash point is safe** — at each moment the memory is fully
  alive, or dark *and recorded* — and a failed record append means nothing moves. [v1] §16
  G10–G11.
- **Everything that must READ the doomed content happens before anything is chased.** [v1]
  §16 G13 — v1 named this bug: chasing copies first made every span unidentifiable.
- **Chase every surface, including the derived association graph.** [v1] §16 G14 — an
  erased id left in the learned graph keeps *conducting* activation between its former
  neighbors.
- **No silent partial success**, and a contamination scan returns **ids only** — printing
  the matches would re-leak exactly what is being erased. [v1] §16 G15.
- **Removal targets are restricted to memory-bearing roots.** [v1] §16 G16 — the archive,
  backups, the graph, and the removal record itself are never nameable targets, so a typo
  cannot point removal at the record of removal.
- **A removed memory cannot be silently resurrected**, via a deny-list consulted at load
  and rebuild; a stray copy is skipped and logged, never deleted. [v1] §16 G12.
- **Catastrophe is covered separately, cheaply, and non-fatally**: rotated local snapshots,
  an **allowlist not a denylist**, never leaving the machine, never throwing. [v1] §16 G18.
- **Dry run is the default for anything destructive**, with an interactive confirmation, and
  the writer's lock taken only *after* the confirmation, then reload and re-plan under it.
  [v1] scar §2.13.
- **Wall-clock, not active days, for any cooling-off.** [v1] §16's note on the released
  ceremony — *a week of not using the machine must still be a week of second thoughts*, and
  an immediate-destroy setting was rejected in v1 because it would delete the only property
  that made the operation safe to have.
- **A machine-readable pass record that a runtime switch actually reads.** [v1] §17.2 — the
  ambient path refuses to turn on until a passing run is recorded. *The gate is not a
  document; it is a precondition.*
- **Everything permanent is enumerable and inspectable on demand — a list, not a cadence.**
  [v1] §14.1 G9, earned 2026-08-24.

## 4. Drops / simplifies

- **The staged quarantine → cooling-off → chase-every-copy erase ceremony is released**
  (owner rescope 3, settled): 871 lines, never production-fired, no designated target since
  2026-07-29. What replaces it is **plain owner-initiated removal plus a record** — loud,
  recorded, unreachable from any model path. Every guarantee in §3 survives the release;
  the staging does not.
- **Forever-archive becomes bounded versioning** (owner rescope 3, settled). Superseded
  rows retain ~90 lived days.
- **Local-only absolutism is released; the property is no silent egress** (owner rescope 2,
  settled). `export` is therefore a first-class owner operation: **explicit owner action,
  encrypted, owner-keyed**, in portable formats readable in any editor. Nothing leaves the
  machine any other way, and the core has no egress path at all.
- **Zero runtime dependencies as a vow is released.** **PROPOSED** — owner call at
  check-in. It was a proxy for constitution line 10 that already needed an exemption in v1,
  and v2 ships as a distributable package where dependency hygiene is judgment. The default
  stays zero.

## 5. Contract

**Inputs** — owner commands: `status`, `install`, `on`/`off`, `protected` (list),
`remove <id>`, `export`, `backup`, `restore`; interactive confirmation; the data directory.
**Outputs** — human-readable output; durable state changes for owner operations only;
snapshots and exports; the removal record; telemetry by reference.

**Guarantees** — **[M]** mechanized, **[A]** advisory:

1. **[M] The destruction path is importable only from this directory**, asserted by a
   caller-universality test over the import graph. No core module, no adapter, no model
   path reaches it.
2. **[M] Destructive commands default to dry run and require interactive confirmation**,
   and take the writer's lock only after confirmation, then reload and re-plan under it.
3. **[M] Every path comparison resolves and realpaths both sides before comparing**, and no
   tool honors a pre-set data-directory environment variable when it claims a throwaway
   directory (scar §2.13 — v1's migration guard was a raw string comparison, and
   `--out ~/.bansai/` with a trailing slash pointed it at the live store and mass-wrote
   ~11K files).
4. **[M] A canonical database is backed up through the database's own backup API or
   `VACUUM INTO`, never a file copy.** A restore test opens the copy and reads a row written
   inside the pre-copy write window. **This is the sharpest scar in the list** (§2.11):
   v1 copied its SQLite file without a WAL checkpoint and it was harmless *because the
   database was a declared rebuildable cache* — and rescope 1 is precisely the removal of
   that mitigation, which promotes the same flaw to canonical-data loss.
5. **[M] Every top-level path in the data directory is either in the backup set or on an
   explicit documented exclusion list**, and adding a directory breaks the build until it is
   classified. Documentation that says "whole store" is checked against the copy list by
   that same test (scar §2.11 — v1's allowlist landed hours before the episode directory
   existed and silently omitted the canonical journal for three weeks).
6. **[M] The archive tree is deliberately excluded from snapshots** — archive-on-overwrite
   history is itself the redundancy layer, and snapshotting it copies an unbounded,
   already-redundant tree into every snapshot.
   *Correction (2026-08-25, closing the filed contradiction): as v2 shipped it, there is
   no unbounded archive tree — rescope 3 replaced it with the `versions/` directory under
   BOUNDED retention (H lived days). Bounded canonical-until-expiry state belongs IN the
   backup set, and LAYOUT says so; this guarantee's premise applied to v1's shape. The
   implementation followed LAYOUT, which guarantee 5 makes the single source of truth.*
7. **[M] `export` is the only egress**, and it is explicit, encrypted, and owner-keyed. A
   test asserts no other module opens a network socket to a non-model, non-embedding
   endpoint.
8. **[M] Backups never leave the machine and never throw** — a backup problem must not
   block a consolidation cycle.
9. **[M] Reads are pure.** Inspecting the protected list or the census writes nothing and
   logs nothing; loudness about corruption belongs at mutation time (§14.1 G8).
10. **[M] The runtime switch reads a machine-readable pass record** and refuses to enable a
    gated channel without one.
11. **[A] Command names, flag shapes, and output formatting are surface** and may change
    without touching a core contract.
12. **[M] Owner-in-the-loop is a short, named list — currently one item: removal.**
    Candidates for the list get discussed, never assumed (§14.3). Everything else that can
    be safely autonomous is.

## 6. Scars honored

**E5** (the CLI is one side of the seam between locking domains — the owner console versus
the background worker — which is exactly where v1's surviving races clustered; a lock is
never held across a human prompt) · **§2.4** (every path that deletes or discards logs what
and how much) · **§2.11** (backup scope asserted against the layout; the canonical database
checkpointed, never copied) · **§2.13** (path guards resolve before they compare; no tool
silently accepts a pointer at real data) · **§2.17** (the removal path is a curation path,
and a curation path that has never fired is unproven — see open question 2) · **§2.19**
(permanence and write bar scale together — everything permanent is enumerable here) ·
**§2.20** (the removal record carries no body and no content hash).

## 7. Open questions

1. **Does `export` encrypt to a key the owner already has, or does it mint one?** Minting
   is friendlier and is also how an owner ends up with a backup they cannot open.
2. **Removal has never fired in production, in any generation.** v1's erase machinery was
   built, tested, and never once run in anger — which by scar §2.17's own criterion makes
   it unproven rather than sound. v2 should either exercise it deliberately in bake-in or
   carry it as declared-dormant-by-design, and say which.
3. **Is `restore` a supported operation or a documented manual procedure?** v1 had no
   logged read-back of a backup ever, so there is no evidence its snapshots were usable.
   Guarantee 4's restore test is the minimum; a real restore command is more.
