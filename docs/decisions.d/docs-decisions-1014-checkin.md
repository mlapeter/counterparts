### Decided by Mike, 2026-10-14, lightly held (the Group 1 check-in: ratings, salience text, reminders)

- Decided by Mike, 2026-10-14, lightly held: **the model rates the memories it was shown, 0–3,
  at the session_end ask, and the ratings are only tracked** (#492). 0 = noise, 1 = on topic
  but not needed, 2 = useful background, 3 = changed what I did or said; drewOn ids are asked
  for especially. Nothing reads them into strength, ranking, credit or decay yet; how to use
  them is decided after there is data. Why: the check-in measured footnote use at about 1%
  (2,367 shown, 25 used, 10-09..10-14), but "used" counts only an open, a quote or drewOn, and
  drewOn had 6 rows in 3 days. The never-used list was topped by the owner's standing rulings,
  which shape behaviour without being cited, so habituation built on that signal would have
  hidden them first. Mike proposed rating every footnote (1–10); 0–3 with anchors was chosen
  because self-ratings on a wide scale bunch and lean polite. Cost: about 75 more characters
  on each due Stop ask, which now also names drewOn.
- Decided by Mike, 2026-10-14, lightly held: **habituation (ignoring lowers how readily a
  memory surfaces) stays unbuilt** until the ratings give a real signal. Never a strength
  change, as before.
- Decided by Mike, 2026-10-14, lightly held: **routine work is left at the default salience
  by the tool text, not by a code change** (#493, option A). Why: of 494 new work memories
  since 10-11, 40 were claimed ≤ 0.25 and the median claim was 0.40 (about 9 lived days in
  reach), so "over-store, let fading choose" mostly wasn't happening; routine notes that did
  sit at the default left reach in 1–2 days (46 of 47) while felt memories and the owner's
  rulings all stayed. Option B (scale work claims in code) only if the median doesn't move;
  the ratings say whether the 0.4 notes were worth their reach.
- Decided by Mike, 2026-10-14, lightly held: **closing a dated memory closes its whole moved
  chain, and the reply lists other dated neighbours without closing them** (#493). Why: one
  deadline had three reminder roots, a done note can name one `updates`, and the unclosed one
  stayed in the wake the day it was done. The chain close keeps `closeThread`'s guards and
  follows raw pointers only (review of #493).
- Decided by Mike, 2026-10-14, lightly held: **an untitled revision carries the old title,
  except a closing or `done` one (asked for instead) and never from a confidential row**
  (#493). Recall accepts `query` as `question`; `recall.decision` logs which ids mood matching
  lifted (`moodMatchedIds`), with mood weights still 0.
- Open, by Mike's ask: **turning mood matching back on** gets its own conversation after this
  batch. The 10-10 evidence (1.3% vs 2.4%) can't be checked from the store: only a per-turn
  count was logged, and the on/off overlap is two days.
