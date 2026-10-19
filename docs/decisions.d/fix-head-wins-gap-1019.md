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
- **Left as is, found in review:** a head the words reached more weakly that passed its own
  bar on a higher salience than the earlier one's is now shown at the earlier one's
  numbers and salience, and can fail where it used to show (both then held back). Rare in
  a synthetic search (~1–3% of such turns, with salience drawn uniformly); count it at the
  check. Habituation (#525) lifts the bar by id, so a habituated head standing in faces the
  earlier one's bar raised while the earlier one faces it unraised: the earlier one can
  still show alone there.
- **Left as is:** a head reached at least as strongly as the earlier one that still fails
  its bar while the earlier one passes (possible only through salience moving the bars;
  the earlier one would show alone). Deliberate recall is untouched (facts mode already
  folds earlier versions under the current one).
- **Check ~10-22:** on the live decision records since the install, count turns where a
  settled-over memory shows without its head (was 36 in ~981 turns); expect ~0, and the
  heads' showing count to rise by about as much. **Revert by** removing the `byId` lookup
  in `gate.ts#barOf` and keying `headsWin`'s `reached` map back to a set of ids
  (`ids.has(head)`).
