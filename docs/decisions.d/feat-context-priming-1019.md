### An experiment, 2026-10-19, agreed with Mike: context priming (the downward half of the loop). Check on ~10-22

From the coordinator's brief (`~/counterparts-notes/2026-10-19-context-priming-brief.md`).
Trying a head start for memories connected to what the session is doing, to see whether
primed footnotes are rated more useful than unprimed ones, without one cluster winning turn
after turn. Revert by setting `PRIME_LINK_UNITS` and `PRIME_TRAIN_SHARE` to 0 (recall
`tunables.ts`), or by reverting the PR. Nothing is stored in a new format: the train and the
wake's open threads are `gate_session` rows of a new kind, `prime`, which an older build never
reads. Recall CONTRACT item 22; `src/core/recall/prime.ts`.

- **Sources.** What this session used (credited at the referenced, engaged or useful tier,
  or rated 2–3 on its own rating rows, which also catches a memory born today that physics
  credits nothing), what it wrote (#523's echo set: never a target, but its neighbours are
  warmed), and what is open in its folder (the open threads its wake kept, written by the
  host as a gate record at session start, plus the directory's live handoffs), read once a
  session. Not the self page (the brief's tunnel-vision worry).
- **Two channels.** Along links: one hop (`Associate#partnersOf`), Σ source weight × decayed
  edge × `PRIME_LINK_UNITS` (1) cue units. Why 1: a fresh source and a link two co-uses made
  (0.5, #525) give half a maximally-rare cue, about 2.5× the floor; a write-time or dream
  link (~0.05) only breaks ties. Along meaning: a running vector of this session's prompts,
  decayed ×`PRIME_TRAIN_DECAY` (0.5) a turn — the previous prompt 1, the one before 0.5 —
  with each source's vector folded in once when it first counts (a turn's new sources
  together weigh at most one prompt). A candidate close to it gets `PRIME_TRAIN_SHARE` (0.5)
  of what the turn's own meaning gives at that cosine (the in-line floor and weight of the
  store's embedder). Why 0.5: the last few turns count half as much as this one. A source's
  link head start decays ×`PRIME_SOURCE_DECAY` (0.8) a turn since it first counted (a third
  after five turns). Source weights: used 1, wrote 1, open here 0.5 (what was left in a
  folder is a softer sign of what this session is for). At most `PRIME_MAX_SOURCES` (24),
  newest first.
- **How strong.** Added to activation before the cut, like a hop, so it can lift a memory
  into the cut and past its relative bar, in either tier. Bounded: only candidates this
  turn's words or meaning reached; at most `PRIME_CEILING` (1) × their own cue + semantic
  (the dial to turn first if tunnel vision shows); out of `cueFraction`; out of the turn's
  background sample (a primed cluster must not raise everyone else's bar); out of both
  absolute floors (so a turn too thin for a relative bar is unchanged). Habituation's ×1.5
  bar applies after it, unchanged — a test shows a habituated memory's raised bar holding.
  Session dedup still shows a primed memory once.
- **Choices I made that the brief left open, lightly held.** (1) The floors exclude priming
  ("a head start is not evidence"); the brief's "strong" is honoured against the relative
  bar only. (2) The train is scored against the turn's candidates (the first
  `PRIME_TRAIN_POOL`, 72, in the cut's order; a box-3 vector read each), never ranked over
  the store, so its cost does not grow with the store; this turn's own vector is the in-line
  one, or the stripped prompt embedded once (~0.5 ms). Prompts only, not replies. (3) The
  train excludes the current prompt (that is the semantic channel's), so on a lagged turn
  the previous prompt counts in both the lagged cue and the train — a pull toward the
  previous subject the review should watch for. (4) A first prompt in a folder with open
  threads or a handoff IS primed by them; "identical to before" holds only with nothing
  open there.
- **Cost, measured 2026-10-19.** A synthetic store in a temp dir (20,000 topical memories
  with potion vectors, 9,500 links mostly within a topic; never a live store), 30 prepared
  sessions per arm, each measured turn in its own fresh process (a cold hook), the real
  embedder, priming on (sources used 1, wrote 1, open 3, a train, 24 candidates primed)
  against priming off: the recall build p50 66 / p95 69 ms against 62 / 66 ms; the whole
  `recallForTurn` p50 72 / p95 76 against 68 / 72 ms. About 4 ms, against the 1,200 ms
  budget. (The machine was shared with other test runs; the arms were interleaved.)
- **One thing to watch on the static table.** Its in-line floor is low (0.15), so on a
  steady topic nearly every candidate is a little near the train: in the cost run all 24
  were primed. Kept out of the bar, a uniform head start can still lift several over it;
  if `shown` rises with `byTrain` across the board, centre the train's score on the
  turn's own candidates (only what is nearer the train than the turn's average gets a
  head start) or lower `PRIME_TRAIN_SHARE`.
- **Privacy.** The train is the person's words in another form: it is emptied with the
  carried cues in a session idle past the retention ceiling (`clearIdleCarries`).

What to look at on ~10-22 (for docs/CHECK-AFTER.md):

- `recall.decision` rows: the `primed` summary (sources by kind, `train`, `candidates`,
  `cut`, `capped`, `shown`, `lifted`, `byLink`, `byTrain`) and the `primed` part on each
  shown row (`link`, `train`, `from`, `lifted`). How many shown footnotes a day were
  primed, and how many only because of it (`lifted`).
- Footnote ratings (`recall.rated`), primed against unprimed, joined on the decision rows'
  ids: are primed footnotes rated 2–3 more often? Lifted ones especially — those are the
  shows priming caused.
- Tunnel vision: within a session, the same cluster of primed footnotes turn after turn
  (`byTrain` high while the prompts changed subject; the same `from` source priming several
  turns running). If so, lower `PRIME_CEILING` or `PRIME_TRAIN_SHARE` first, then
  `PRIME_SOURCE_DECAY`.
- `capped`: how often the ceiling binds. Often means priming wants to carry more than the
  conversation gave; rarely means the ceiling is not the operative limit.
- Latency: `elapsedMs` on decision rows before and after install (the cost check below).
- Not added to `counterparts mechanisms` or doctor: a new proof there needs the sidebar's copy
  changed in step (`sidebar-mechanism-drift.test.ts`), so the counts live on the rows above.
