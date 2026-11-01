### The claim comes after the mint (coordinator's brief, 2026-11-01, marked for Mike's review)

- `remember` and `session_end` wrote the claim, then the memory. A mint that threw (a store
  locked past its busy timeout, measured) left no memory, a retry refused as a duplicate, and
  words marked as written up. Now: write, then claim. No store-format change, and the
  successful path gives the same ids and the same dedup answer.
- **Why not let a retry through when no memory has the claim's id.** It's smaller, and a note
  nobody retried would still read as written up and go at 3 days. Most wouldn't be retried: a
  Stop's `session_end` that saw `threw` isn't usually sent again.
- **The window left fails the other way.** A kill between the commit and the ledger append
  leaves a memory with no row: a repeat mints a twin, which sleep folds. Duplication over loss.
- **A write-up part with a memory that threw stays open**, because closing it left that memory
  nowhere. The exception is a last part where another memory landed: its claim took the words,
  so the door would refuse a resend. That part closes and says `notLanded`, and a nightly
  runner may not act on it. Mike could decide to make that case resendable too; it means the
  door reading past "owes nothing" for a part it handed out.
- **`remember` now answers `threw` as a tool result** instead of a protocol error, which makes
  it a logged `mcp.refused` row. Undo: drop the `try` around `submitJot` in `rememberCore`.
- Undo of the whole change: `counterpart-deposit.ts#deposit` back to `submitProposal` before the
  mint. It restores the loss.
