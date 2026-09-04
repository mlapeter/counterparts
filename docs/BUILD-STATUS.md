# Build status — feature-complete, 2026-08-25

> **This is a snapshot of 2026-08-25 and it is kept for the record, not for current
> state. `docs/LAUNCH-STATUS.md` supersedes it.** Several things it lists as open have
> since closed: the four numbered gaps under "Open gaps, by what they block" all closed
> the night of 2026-08-25 (the "Night shift" section below says so and this header is
> the pointer to it), and **CLI §7** — an observer minting an absent store at open —
> closed 2026-08-26 and was re-verified by running it (`LAUNCH-STATUS.md` §C2). The
> "merged, not yet verified live" list is superseded by `LAUNCH-STATUS.md` §B and §C;
> what remains genuinely open from this page is carried forward there as §I5. Nothing
> below has been rewritten — read it as of its date.

*One repo-birth-to-feature-complete day: 24 commits, 854 tests / 0 failures across
core (11 modules), 14 closed seams, 4 adapters, and the replay harness. This file is
the honest inventory the milestone claim rests on, stratified the way the day taught
us to stratify.*

## Verified live vs merged (constitution line 11: "verified live, not merged")

**Verified live** (exercised as real processes against real temp stores):
- The dashboard's five views, run end-to-end through `bin/dashboard.ts`.
- The Claude Code hook entry scripts under bun.
- The full pipeline integration test: wake → capture → session-end dump → gate →
  mint → recall → credit → sleep → next wake remembers.
- Backup correctness against a database holding an open uncommitted transaction.

**Merged, not yet verified live** (each named in its adapter's NOTES):
- A real MCP client handshake.
- `backup`/`export`/`remove` against a real (non-temp) store.
- The interpret client's first real API call (its CONTRACT G6 long-call proof is
  honestly deferred — needs a credential).
- The hooks inside an actual Claude Code session.
- The replay harness against the real corpus (fixtures only so far; format drift will
  print as a number on first contact).

## Night shift 2026-08-25 — the four blockers closed, live-verify run

All four numbered gaps below are CLOSED as of the night commit (tests named in the
commit): 1 (gate records durable via `gate.chunk`; refusalMix/schemasShown/channelMix
compute), 2 (`band.transition` direction counter; G12 fires; dashboard renders the
verdict BY REASON), 3 (chase completes via the owner seam; deny-list at read as
`REMOVED`; neutralize-not-delete for FK lineage), 4 (`self.enumerate` named absences,
tombstones surfaced). Also closed: birth-by-mention had ZERO live callers — now
ambient at both mint sites (`counterpart.mention`); the live-verify's backup-under-
lock failure (idempotent operational open, busy_timeout, graceful backup report,
re-verified live); the corpus reader speaks v1's real span shape (first contact:
events/embeddings matched to the digit, spans 0-parsed until the shape fix).

**Still open, updated:** replay §1a — `applySweep` passes no schema slices, so every
replayed chunk is blind and `preselect.meanSchemasShown` reads 0.00/FAIL by design
(the gap made visible; wiring slices is a behavior change for review). Replay §2a —
authored-path gate records can't cross remember's verdict seam without a `records`
field. CLI §7 — an observer still MINTS an absent store at open (fix breaks six
modules' observer-on-empty-dir tests; needs a deliberate pass). Entity mention has no
deliberate adapter surface (ambient-only now — fine, but an owner console verb may be
wanted).

## Open gaps, by what they block

**Blocks the real replay run:**
1. `Counterpart.applySweep` drops the chunk gate's records (`EncodeResult.events`,
   `blockedBy`, `preselection.shown`, channels never leave the composition root) —
   kills `gate.refusalMix`, `preselect.meanSchemasShown`, `preselect.channelMix`.
2. Decay reports rows-changed, not band transitions BY DIRECTION — and that counter
   is what `physics.symmetryCheck` (G12, the ratchet tripwire) needs to fire at all.
   As shipped, G12 is enforced-in-one-place-consumed-by-nobody — the exact pattern
   the self build warned about. The tripwire must be live DURING the parallel run;
   that is when it earns its keep.

**Blocks the launch claims:**
3. Removal cannot chase box-2 rows (`memories`/`edges`/`prospective` survive as
   reported-but-dark state) and the deny-list is not consulted at `Store.read` —
   until both land, "anything can be removed loudly" is half-true. Fix:
   `Store.chaseRemoved(id)` on the owner-op seam + deny-list at read.
4. `self.enumerate` silently drops unreadable rows — a removed protected element
   leaves the protected list silently (scar §2.19 from the other side).

**Blocks the v1→v2 migration (file with the migration tool's requirements):**
5. **Confidentiality mapping.** v1's live store carries `confidentiality: sensitive`
   traces (the store miner excluded 16 by that flag). v2's `isConfidential` has a
   reader and NO writer. If migration does not map the field, those memories silently
   lose their protection at cutover. Rides beside the already-filed requirement that
   the import path runs its own secrets gate (test-triage finding).

**Closed here:** the CLI CONTRACT §5 G6 vs LAYOUT contradiction on `versions/` in the
backup set — LAYOUT wins: under rescope 3's bounded version retention, `versions/` is
canonical-until-expiry and belongs in backups. The CONTRACT carries a correction note.

## Needs the owner

- **The real replay run is the project's first real API spend**: ~780 archived spans
  re-interpreted through a live model seat. Seat choice is a knob (constitution
  line 2), and the run should be priced and approved, not assumed.
- Timeline: the build compressed from "~a week" to one day; the irreducible remainder
  (replay days + the 1–2 week parallel run) is unchanged — the ~09-22 fallback rail
  now has large slack.
