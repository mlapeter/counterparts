### Decided by Mike and the R3 builder, 2026-10-24, lightly held (cue learning)

- Decided by Mike, 2026-10-24, lightly held (R3, an experiment): the words of a turn that
  showed a memory the session then used wire to it (`cue_edges`), and a learned pair fetches
  its memory as one more cue. Why: the ping/pong habit; a person who practises "ping → pong"
  gets better at it, and recall was getting worse as talk about the habit added competitors.
  R3 ships on its own store bump (v15), not batched with R4. Switch: `physics.CUE_LEARNING`
  (off: nothing recorded, trained or read).
- Decided by the R3 builder, 2026-10-24: a fully learned pair is worth 6 rare words
  (`recall.CUE_PAIR_UNITS`), not the brief's "about one": the loud tier's floor is absolute
  (4.5 units) and a bare one-word prompt brings ~1, so at 1 the demo's bar (a bare "ping"
  brings pong back loud) is unreachable. η 0.5 per full use split by the turn's word weights;
  a rating of 1 trains a quarter, 0 depresses one full share; `CUE_W_CAP` 1, `CUE_MAX_OUT`
  1.5 per word, `S_CUE` 60 lived days. Each showing trains a memory at most once (up to its
  best share); cadence refusals still train (five sessions, five times); `own-write` and an
  unknown writer's birth day never do. An observer neither writes nor reads cue pairs.
- Decided by the R3 builder, 2026-10-24: the turn's cue words live in `gate_session` (kind
  `cues`), not a new table: they are session state, already bounded and swept with it, and
  `clearIdleCarries` drops them on the 14-day clock with the carried words.
