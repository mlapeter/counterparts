### An experiment, 2026-10-19, agreed with Mike: no write-time links. Check on ~10-22

- **Trying** no write-time links (`WRITE_LINK_MAX` 0 in `src/core/associate/tunables.ts`;
  it was 4) **to see** whether co-use links from ratings (#525, `CO_USE_DEPOSIT`) build the
  graph on their own, without the noise. Why (`~/counterparts-notes/2026-10-18-association-diagnosis.md`):
  at most 3 of 161 write-time pairs were ever reinforced; a hand-read of 20 found 5 right,
  4 unsure, 11 noise; and they use up the 32-links-per-node budget (`MAX_EDGES_PER_NODE`).
- Contiguity links stay (memories written next to each other carry a real order). Edges
  already laid are kept and fade on their own; no rows are deleted, nothing on disk changes
  format. The code stays: `linkAtWrite` returns null at once when `WRITE_LINK_MAX` is 0.
- **Check ~10-22** (~2 lived days after install): the boundary's `associate.flush` rows
  carry no `atWrite`; links landed per day from co-use and contiguity; whether quiet
  pointers still show and get rated useful; links per node.
- **Revert by** setting `WRITE_LINK_MAX` back to 4, if the graph starves (few new links,
  pointers stop showing) or co-use links turn out as noisy.

### An experiment, 2026-10-19, agreed with Mike: the slot detector flags only. Check on ~10-22

- **Trying** slot proposals with no provisional fade (`SLOT_FADE` 1 in
  `src/core/reconsolidation.ts`; it was 0.8, and `changedFade` makes no cut at 1) **to see**
  whether flagging alone, with the fade only on the dream's or the writer's confirmation,
  costs nothing when the detector is wrong. Why (`~/counterparts-notes/2026-10-19-overdue-checks.md`,
  "Detector precision"): right on 4 of 7 by hand-read, under the ~3-in-4 bar; the dream said
  "not the same" on 3 of the 4 it judged; right and wrong overlap in cosine (0.867), so
  raising `SLOT_COSINE` would not separate them.
- The proposal is unchanged otherwise: an unsettled `slot` pair, the older labelled "may be
  out of date", shown to the dream to confirm (`slot {pair, same}`). `same: true` (or the
  writer's settle `changed`) is a settle at `CHANGED_FADE`, the only fade; `same: false`
  withdraws it, with nothing to put back. Proposals made before keep their cut on the trail,
  and a confirmation lifts it or a withdrawal puts it back exactly, as before. No store
  format change; the write's `slotHint` no longer says the older faded.
- **Check ~10-22**: `contradiction.proposed` events carry `faded: false`; the dream's
  same true/false over the new proposals; confirmed ones at the full fade; and whether the
  "may be out of date" label on a wrong proposal shows up as a problem before the dream
  answers.
- **Revert by** setting `SLOT_FADE` back to 0.8.
