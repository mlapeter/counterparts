### Decided with Mike, 2026-10-23 (roadmap seat; floated that morning, his go 15:32, lightly held): the day summary

- Bedtime rehearsal: what is gone over before sleep is consolidated more. Day's end already reads the day as told; it
  now also leaves a few lines (`self.DAY_SUMMARY_CHARS`, 600 characters, refused past it with the numbers, never cut),
  first person, what the day was about and what is in motion, with the memory ids they rest on.
- **A header, not a replacement.** The dream reads it first ("## today, as day's end told it", the bundle's first
  section, `daysEnd` in the JSON form), above `fresh`, `today`, `mixing` and `lookback`, which stay exactly as they
  were. The reflection gets the layer it was missing, general events: one line a day for `dream.TIMELINE_DAYS` (21),
  beside the last 3 days of chapters, in D1's room order (step 3, counted among the fixed parts).
- **A row, not a table.** No migration: the summary rides on the night's own `self.page.writer.ran` row (its JSON
  payload gains `summary` and `summaryCites`; `PageWriterRun.detail` is a plain string, not JSON). Readable by date
  (`self/writer.ts#daySummaries`).
- Decided by the D2 builder: one call. Event rows are append-only, so the summary goes with day's end's one closing
  `self_page` call: beside the page (on the `revised` row; a refused page's summary is not kept), or alone with no body when the page stands, which
  answers the night as `nothing-to-say` on a row carrying it. A page written without one is told so; the night is
  answered then, and its dream opens without a header.
- Decided by the D2 builder: the dream finds tonight's summary by the night's session (its children share it), told
  since the dream before it began (a long-lived session can run two nights), so a night that crosses midnight
  between day's end and the dream still opens with it; else the one about the night's own date. The reflection's
  timeline ends at the date its dream opened with.
- Decided by the D2 builder: a day day's end did not tell (every day before this lane, and any night it was missed)
  falls back to that day's chapters' summaries' first lines joined, marked `(chapters; N)`; a day with neither is
  counted ("N days without a summary or a chapter"). Why: the check after 7 nights would otherwise read a timeline
  of 7 lines and 14 gaps, and the chapters are the closest account the store has. Cost on the 10-23 corpus: ~5k
  characters, reflection parts unchanged.
