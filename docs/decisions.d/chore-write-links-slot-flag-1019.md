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
