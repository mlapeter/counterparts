### Decided by the R1 builder, 2026-10-24, lightly held (the reflection's core candidates, capped)

- Decided by the R1 builder, 2026-10-24, lightly held: the reflection is shown at most 30 core candidates a night
  (`REFLECT_TUNABLES.CANDIDATES`), 20 by the old order (strongest felt, then newest) and 10 rotated through the rest
  (`CANDIDATES_ROTATED`), the least recently shown first by the `shown` of the last 30 reflections
  (`CANDIDATES_LOOKBACK`). Why rotate rather than cut: promotion runs in sleep, not through the reflection, so a cut
  candidate is not shut out by rule, but the reflection's cites and recorded feelings are the core lanes' strongest
  feed (physics `ReturnSource`: awake returns are rare), and a plain cut at 30 would never show an old, lightly felt
  candidate again. Shown in any lane counts as shown, so a cut candidate the felt lane picks up waits its turn.
  Switch: `dream.REFLECT_CANDIDATES_CAP` (off: every candidate, exactly as before).
- Decided by the R1 builder, 2026-10-24: the reflection's row keeps the lanes it was shown, `detail.lanes`
  (`core`, `candidates`, `felt`, `candidatesNotShown`), beside `fit`, and the finish carries `lanes` and
  `chaptersAs` as it carries `fit` — the D1 check reads a finished row, and the finish dropped `chaptersAs`.
