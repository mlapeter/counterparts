### Decided by the head-wins-gap builder, 2026-10-19, an experiment (the head-wins gap)

From the 10-19 overdue checks (`~/counterparts-notes/2026-10-19-overdue-checks.md`, head-wins):
since 10-12 a settled-over memory showed in a turn's footnotes 36 times (21 ids) while its
live head did not. Reproduced hermetically (`test/head-stands-in-bar.test.ts`). Two paths
gave that symptom; which one the live 36 came from was not measured.

- **Trying: a head brought in for an earlier memory faces the earlier one's bar, to see the
  earlier-shown-without-its-head count go to ~0.** The suspected cause was right: the
  brought-in head (`standsFor`) carries the earlier one's numbers but is outside the
  sample, so it faced the whole-sample bar (the earlier one's own activation included),
  while the earlier one faced its lower leave-one-out bar. A marginal earlier one passed and
  its head failed. Now it passes exactly when the earlier one would, and the earlier one is
  inhibited as before. One lookup in `gate.ts#barOf`.
- **Trying: a head the words reached more weakly than the earlier one is brought in to
  stand for it too** (the second path, found while reproducing). Reached on its own weak
  words it failed its own bar, so the earlier one was never inhibited. Its direct
  candidate is dropped, and its own reach stays in the turn's background
  (`Candidate.directReach`), so no other memory's bar moves. `recall/index.ts#headsWin`.
- **The strongest earlier claims the head** (review of #526): candidates come in the cut's
  salience order, so the first earlier met used to claim it — on a chain A→B→C, or two
  memories one head settled over, the head stood in at the weaker one's numbers and the
  stronger one showed alone. A link-only earlier claims it only when no word-reached one
  does, and never displaces a head the words reached (its arrival is not in their units).
- **An echo head keeps both out.** A head this session wrote is `echo-skipped` and the
  earlier one stays inhibited (#523's `echo(a.c.head)`), so neither shows.
- **Either bar** (the coordinator's call on the review of #526, lightly held): a stand-in
  the words also reached on their own passes when it clears the earlier one's bar at the
  earlier's numbers OR its own bar at its own reach and salience (`directSal`), so a head
  that showed on its own before this change still shows. (Without it, a head shown on a
  higher salience than the earlier one's could fail at the earlier's numbers: ~1–3% of such
  turns in a synthetic search; 0 with it.) `gate.ts#barsFor`.
- **The earlier one is held back whenever its head was brought in** (the coordinator's
  call, and what the 10-19 overdue-check row asked for: "hold back a settled-over memory
  whenever its head was brought in for it"), whether or not the head then shows. The newer
  state is what counts: a head that fails — habituated (#525), say, which lifts its bar by
  id — means the footnote was not useful, so neither shows rather than the earlier one
  alone. One exception, as before: a confidential head withheld from a guest leaves the
  earlier one showing, labelled. `gate.ts`, `stoodFor`.
- **Left as is:** a head reached at least as strongly as the earlier one is not brought
  in, so if it fails its bar while the earlier one passes (possible only through salience
  moving the bars), the earlier one shows alone. Deliberate recall is untouched (facts mode already
  folds earlier versions under the current one).
- **Check ~10-22:** on the live decision records since the install, count turns where a
  settled-over memory shows without its head (was 36 in ~981 turns); expect ~0, and the
  heads' showing count to rise by about as much; also count turns where a brought-in head
  failed and so neither showed (the cost of holding the earlier one back). **Revert by** removing the `byId` lookup
  in `gate.ts#barOf`, having `headsWin` skip a head whenever the words reached it (as
  `ids.has(head)` did), and dropping `directReach` (its field and its line in the gate's
  sample), `directSal` and the either-bar `min`, and `stoodFor` (the earlier one is then
  held back only when its head is admitted, as before). The strongest-earlier claim can stay: it only picks which earlier the head
  stands for.
