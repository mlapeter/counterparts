# Build status — feature-complete, 2026-08-25

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
