# Round 2

This round follows the judge's round-1 list (`../round-1/JUDGE.md`) in its
order. The lab now uses Mike's profile: Menlo 13 in an 8 x 16 cell.

## What changed

**1. A real lateral fissure, and the temporal pole.**
- The dots of the cerebrum in a band just above and in front of the temporal
  lobe's side profile become a **channel**. It's the temporal ellipsoid's
  profile from the side, 2.6 dots wide at 42x14, measured by a first-order
  distance to that profile.
- The channel counts as *outside*, so both lips draw at rim brightness: the
  frontal/parietal operculum above and the temporal lobe's top edge below. The
  inside of the channel stays empty: no stipple, folds or inner structures.
- It opens at the front as a notch in the silhouette, over the temporal pole's
  rounded nose. From there it runs back and up about 17° to about 62% of the
  length, where it narrows to nothing so the lips meet.
- Every cerebrum dot inside the temporal profile now counts as temporal. The
  temporal lobe reads as its own lobe, with its own superior and inferior
  temporal sulci running lengthwise.
- The hippocampus sits below the channel, and inner dots are never drawn in it.

**2. A glassy middle under a bright rim.**
- **Stipple:** halved, from 30% to 15%. It's now weighted to the rim
  (`0.22 + 2.2·(1−facing)³`), so it's densest just inside the silhouette (the
  rim's glow) and sparse where the surface faces you. It's also brighter at the
  edge.
- **Folds:** capped at 62% of the rim's brightness. The maze of gyri is now a
  faint fill at 34%, at the stipple's priority.
- **Counts:** at 42x14, side view, stipple and maze together are 364 dots of
  2,960, and named folds plus folia are 321. In round 1, the stipple alone was
  479 and the folds 383.

**3. The cerebellum tucked under.**
- **Overhang:** its back edge is at z = −0.80, so the occipital pole overhangs
  it by 10% of the length.
- **Gap:** cerebellum dots within 2 dot rows below any cortex dot (in screen
  space) become a gap, which counts as outside. That leaves an empty band all
  the way across, with a rim on both sides.
- **Folia:** horizontal stripes every other dot row, bending a little. There's
  no stipple on the cerebellum.
- **Colour:** lilac-pink (`#f6b6ee` rim, `#d68cd6` folia), away from the
  hippocampus violet.

**4. Fewer, longer, curved folds.**
- **Named sulci, 9 in all**, each sinuous:
  - the central sulcus, from the top down, leaning forward, with the precentral
    and postcentral parallel to it;
  - the superior and inferior frontal, front to back;
  - the intraparietal;
  - a transverse occipital;
  - the superior and inferior temporal, along the lobe.
- **Short pieces dropped:** a flood fill removes any piece shorter than 7 dots
  (named), 6 (maze) or 3 (folia).
- **Off the rim:** folds and the midline keep at least 3 dots in from the rim.

**5. Silhouette and brainstem.**
- **Top:** the cerebrum is one big dome plus a frontal pole and an occipital
  pole, sized so the top is one arc. There's no frontal/parietal shoulder.
- **No doubled rim:** occlusion edges within 2 dots of the outside are dropped.
  Cortex-in-front-of-cortex edges draw at fold brightness.
- **Brainstem:** an open stalk in front of the cerebellum, angled down and a
  little back, in indigo-blue with cyan stipple. It fades as it drops and runs
  off the bottom row. The canvas edge no longer counts as outside, so there's
  no closed U.

**Also from the "next" list:**
- **One hemisphere:** only the inner structures of the hemisphere nearer the
  viewer are drawn.
- **Amygdala:** left out at rest below scale 50 (so at 42x14 and 30x10).
  When lit, it's a solid disc at least 4.3 dots across.
- **Hippocampus:** a tube of 8 ellipsoids along a curve from beside the
  amygdala, back and up to just under the thalamus.
- **Thalamus:** raised to sit above the fissure's end. It's a ring with a
  light fill, not a block.
- **Prefrontal:** bounded by an anatomical line, 0.36 in front of the central
  sulcus and leaning with it. Its edge is dithered over about 2.6 dots, not a
  straight z-cut.
- **Tags:** placed where they cover the fewest landmarks (lit, inner, rim).
  The `◆` moves one cell toward the label when the anchor cell is the lit
  structure itself.
- **Paused grey:** a rim with a faint inside, and inner structures as outlines
  only.

## Motion

- **Sway:** ±16° about 18°, so 2° to 34°, side view to three-quarter, with a
  40 s period. At its fastest the 42x14 poles move 1.64 dots/s, which is
  **0.27 dot a frame at 6 fps**.
- **Rest:** it now rests at the sway's centre, the best-reading 18°. After 60 s
  quiet, the sway's amplitude eases to 0 over a few seconds. On waking, it eases
  back up from 0, so there's no jump either way.
- **Frame cache:** `frame()` returns its last cells when nothing has moved more
  than a fifth of a dot: the view (quantised to 0.2 dot at the poles), the
  glows, tag, mono and bg are all unchanged, and no signal is in flight. That's
  most frames near the sway's slow ends, and every frame while a picked
  mechanism's glow holds still.
- **A/B in bun** (`bench.ts`), 42x14, one 40 s period:

| calm fps | swing | frames that changed /s | cells repainted /s | compute ms /s | a cell changes every |
|---|---|---|---|---|---|
| 6 | ±26° | 5.1 | 670 | 8.5 | 0.64 s |
| 12 | ±26° | 8.2 | 769 | 12.4 | 0.56 s |
| **6** | **±16°** | **4.5** | **457** | **7.4** | **0.90 s** |
| 12 | ±16° | 5.2 | 471 | 10.3 | 0.87 s |

**Chosen: 6 fps, ±16°.** The smaller swing cuts repaints by 32%. At 12 fps a
cell changes just as often, so 12 fps only quantises jump times to 83 ms
instead of 167. The cost would be 12 blits a second instead of 6 (register
blits every drawn tick, even when the frame is cached) and 40% more compute.
If live viewing says the jumps still look uneven, raising the calm rate to 12
is one constant (`Brain.calmFps`). In that case register should also skip
blits of an unchanged frame.

## Cost

`bun hooks/sidebar/dev/brain-lab/bench.ts`, during sway at 6 fps. The machine
was under load (load average around 10), and the old brain measured 1.48 ms
quiet in round 1 against 1.56 here.

| brain | size | ms/frame (mean) | p95 | cells changed a frame |
|---|---|---|---|---|
| new | 42x14 | **1.30** | 3.12 | **62 of 588** |
| new | 30x10 | 0.49 | 1.33 | 28 of 300 |
| new | 90x32 | 5.80 | 9.05 | 451 of 2880 |
| before | 42x14 | 1.56 | 2.14 | 255 of 588 |
| before | 90x32 | 15.76 | 22.13 | 1037 of 2880 |

- **Uncached frame at 42x14:** about 1.6 ms under this load.
- **Profile** (medians, ms):

  | Pass | ms |
  |---|---|
  | rays | 0.19 |
  | hit points, channel and gap | 0.06 |
  | rim | 0.06 |
  | folds | 0.45 |
  | stipple | 0.65 |
  | cells | 0.13 |
- **Folds:** were 1.25 ms as 11 closure passes, now one inline pass into sign
  bitmasks plus one neighbour pass.
- **Stipple:** the largest piece left. It reads about 6,200 pool points a frame
  to place about 300.
- The dashboard-polling pane test (210 s of fake time) now runs in 0.65 s,
  against 4.1 s with round 1's brain, thanks to the frame cache.

## Checks

`check.sh`: both validates pass (the repository warning about CLAUDE.md at the
plugin root predates this work). Tests: 46 pass, 0 fail. `tsc` clean.

## Open

- The **front view** still reads as two hemispheres and a stem. The sway never
  shows it.
- The **hero** shows the channel's back end as a squared-off cap. It doesn't
  show at 42x14.
- The rim-weighted stipple thickens the top edge into a band 2–3 dots deep in
  side views. That's by design (the rim's glow), but it could read as a doubled
  rim.
- **Stipple cost:** a pool bucketed by normal direction would skip most of the
  points it reads and rejects.
