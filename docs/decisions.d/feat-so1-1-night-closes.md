### Decided by the SO1 step 1 builder, 2026-11-07, lightly held (the night closes open items itself)

- Decided by the SO1 step 1 builder, 2026-11-07, lightly held: the deterministic close is ONE rule,
  `release-supersedes`, in a night phase of its own (`close`, after `interfere`; `core/open-close.ts`). An open item
  (`unresolved`, with or without `settlesWhen`) whose headline names a version as a release step still owed — ready,
  ready to publish, after-publish, publish, beside the version (review of #782: never cut, built, packed, pushed,
  merged, approved, reviewed, queued or tagged, which a bug report names too) — closes when a later memory in the
  same folder, written `status: done`, reads a strictly higher patch of the same series as FINAL (released,
  published, shipped, deployed, installed, landed; `interference.ts#subjectKeys`), of the same product (the word
  right before the version: "site 0.3.46" is not "counterparts 0.3.50"; none, or the default name, on either side
  is the folder's own). W < Z only: the same version's release does not close its own after-publish steps. An
  unmarked memory is never evidence for a close ("Plan: 0.3.50 released by Friday", "0.3.50 released? Not yet"
  closed items in the review's attack); it may only list. Why one rule: precision over recall (a wrong close hides a real debt), and the brief's
  explicit rule is the only one whose evidence reliably lives in the store.
- Decided by the SO1 step 1 builder, 2026-11-07, lightly held: never closed by the night's rule — `status: asked`
  (a question to the owner closes on his answer: a write that `updates` it, or the reflection reading his words;
  similarity is not his answer), an item the owner reopened, a check (CHECK-AFTER, "Check due", a re-read: a release
  is when a check comes due), an item conditional on a version ("after 0.3.45", "aimed at 0.3.30"), a problem (the
  headline says break, broke, broken, fail, bug, missing, crash, regress, wrong or fix: "0.3.46 ready but the
  migration drops tags; fix before any release"), protected or archived rows.
- Decided by the SO1 step 1 builder, 2026-11-07, lightly held: the reflection's `close` (unsure) ids are no longer
  asked in the share ("Shall I close them?" is gone); they stay on the row as `closeProposed` and, with the night's
  own low-confidence matches (a version whose series moved on in an item that doesn't read it as a step; a PR named
  in the item that a later headline says merged), are listed as `mayBeDone` under `recall "still open"`. The
  reflection's `closeNow` stays the model's close, except on an `asked` item, which is listed instead.
- Decided by the SO1 step 1 builder, 2026-11-07, lightly held: the "touch" that reopens a night-closed item is (a)
  the reflect tool's phase `reopen` with its id (the existing undo path, extended; it also undoes an interference
  fade a later night put on the closed item), or (b) a `remember`/`session_end` write that `updates` it and says
  `unresolved: true` (the thread goes on, on the new row, with its `settlesWhen` carried). Recalling it by id is
  NOT a touch: the morning line prints ids, and looking at what closed must not undo it. Both are recorded
  (`thread.night.reopened`), clear `threadClosedBy {by: "night"}` (so a later close or reopen is not mistaken for
  the night's, and the morning line leaves it out), and leave `threadReopenedBy`, so no night closes it again on
  its own.
- Decided by the SO1 step 1 builder, 2026-11-07, lightly held: the morning line sits in the shaped wake's night
  section, after "Last night", as "Closed by the night (N): title — why [id]; … One not done? …": the newest night's
  closes from yesterday's lived day on, only those this folder's Still open would carry. It repeats in that day's
  wakes as "Last night" does; a once-a-day latch is SO1 step 4's.
