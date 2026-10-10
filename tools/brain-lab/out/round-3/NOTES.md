# Round 3

The last polish round before Mike sees it live, following the judge's round-2
list (`../round-2/JUDGE.md`) in order.

## What changed

**1. The brainstem is one stalk.**
- **Width:** the medulla is now about 5 dots wide (radius 0.066).
- **Edges:** brighter indigo-blue (`#78a6ff`, about 70% of the cortex rim's
  luminance), at full strength down to the last row of cells, where they halve.
- **Fill:** a sparse cyan fill (about 40%), fixed to the surface, drawn at a
  priority that holds in the stalk's own edge cells. It reads as one filled
  stalk, not two threads.

**2. One top rim.**
- **No second row:** a cell that holds rim or fissure dots now shows only rim
  and fissure dots. A fold, stipple or inner dot 1–3 dots inside can no longer
  ride on the rim's colour. That was the doubled top edge.
- **Folds:** named folds keep at least 3 dots off the rim and off surfaces seen
  nearly edge-on. The midline cleft draws only where it faces you (facing above
  0.35).
- **The rim's glow:** now a separate, sparse, dim band right inside the rim.
  About 21% of the dots next to it, at 45% of the rim's colour, are chosen by a
  hash of the dot-sized patch of surface under them. They hold still as the
  brain turns. They show only where the rim leaves a cell free, so they never
  form a second line.
- **Body stipple:** an even ~8% (no rim weighting).
- **Occipital sulcus:** now short (y −0.18..0.14) and tilted like the others,
  no longer parallel to the back edge.

**3. Sinuous, leaning sulci.**
- **Lean:** the central, precentral and postcentral now lean about 30° from
  vertical, top toward the back (`Zc` slope 0.62, was 0.42).
- **Wobble:** each named sulcus wobbles about ±1.5 dots per 8 (amplitude
  0.04, wavelength about 0.23, plus a smaller second harmonic).
- **No T-joins:** the frontal sulci now stop 0.14 short of the precentral, and
  the intraparietal starts 0.14 past the postcentral.
- **Near-vertical in the back half:** the central and postcentral only.
- **Maze:** the maze of gyri is dropped below scale 50 (42x14, 30x10), where it
  was dashes. The named folds carry the inside. It stays as a faint fill on the
  hero.

**4. A round cerebellum.**
- **Shape:** rounder (radii 0.25 x 0.29) and tilted 0.25 rad, so its back and
  bottom are one convex curve with the lowest point a little behind its
  middle.
- **Folia:** shallow arcs every other dot row round a point above and in front
  of it, following the curve. They're `#b272b4`, a step dimmer than its rim
  `#f6b6ee`.

**5. White-hot rim highlights.** The rim goes toward `#c8faff` where the surface
turns most edge-on toward the upper left. It stays `#78eeff` elsewhere.

**6. No blit for a standing frame.**
- **`fresh`:** `frame()` sets `brain.fresh`. `register.tsx`'s `tick` skips the
  blit when it's false.
- **Brain clock:** the brain now runs on its own clock, the sum of `step`'s
  `dt`, and `tick` gives it at least one tick's interval. So it moves with the
  ticks that draw it, including the test kit's fake clock. Without that, the
  pane tests advanced fake time while the brain sat still on the wall clock, and
  every frame was skipped.
- Both edits are in `tick`; nothing else in `register.tsx` changed this round.

**The quick ones:**
- **Thalamus:** a solid oval below scale 50. The ring broke up at 30x10.
- **Tags:** the label can also go in the empty corners, and rim cells now cost
  as much as fissure cells. The Prospective tag sits in the top-left corner,
  off the rim.
- **Ghost arcs:** cortex-before-cortex edges inside one lobe draw nothing. The
  only ones that stay are the midline (where it faces you) and the temporal pole
  before the frontal lobe, both quiet.
- **Fissure's back end:** it narrows over twice the length, on a curve, so the
  lips meet at a point.
- **Fit:** a one-dot margin above the dome. At this pitch the far hemisphere's
  top touched row 0. The top and side canvas edges now close the shape; only
  the bottom is open, for the stalk.

## Cost

`bun hooks/sidebar/dev/brain-lab/bench.ts`. The load average while measuring was
about 7, not quiet: other sessions were busy. The old brain measured 1.46 ms in
the same run.

| brain | size | ms/frame, mean with the cache | drawn afresh | cells changed a frame |
|---|---|---|---|---|
| new | 42x14 | 0.75 | **0.99** | **45 of 588** |
| new | 30x10 | 0.27 | 0.62 | 21 of 300 |
| new | 90x32 | 4.06 | 5.25 | 425 of 2880 |
| before | 42x14 | 1.46 | 1.46 | 255 of 588 |
| before | 90x32 | 14.19 | 14.19 | 1037 of 2880 |

The stipple got cheaper with the even body density: it now stops reading the
pool at 1.6 times the base density, not 2.42, and drops the points inside the
rim band before it shades them.

## Motion, now with blits skipped

| calm fps | swing | blits /s (frames that changed) | cells repainted /s | compute ms /s |
|---|---|---|---|---|
| **6** | **±16°** | **4.5** | **334** | **4.4** |
| 12 | ±16° | 5.0 | 339 | 4.9 |
| 6 | ±26° | 5.1 | 512 | 4.9 |
| 12 | ±26° | 7.9 | 561 | 7.6 |

With unchanged frames no longer blitted, **12 fps calm is now nearly free**:
5.0 blits a second against 4.5, and 4.9 ms of compute against 4.4. It's the
natural A/B to try live if the jumps look uneven: `Brain.calmFps = 12`, one
constant. 6 stays the default until someone has watched it.

At rest: no frames, no blits. The 12 Hz timer ticks and returns.

## `hooks/sidebar/NOTES.md`

Updated:
- the frame rate section: modes, the cache, the brain's clock, what
  `/counterparts fps` reports with cached frames ("achieved" counts only blits
  of changed frames; "a frame takes N ms" averages cached and drawn frames and
  reads low; the true cost is the bench's "drawn afresh");
- the old measurements, kept as history;
- the design bullets: no glow, line art, sway and rest.

## Checks

`check.sh`: both validates pass (the CLAUDE.md warning at the plugin root
predates this work). Tests: 46 pass, 0 fail. `tsc` clean.

## Open (not taken this round)

- The **front view** (5 in round 2) and **tq-back** (6) aren't reworked: the
  sway never shows them.
- **Bucketing the stipple pool** by normal direction isn't done. The even body
  density made the stipple pass cheaper, and the whole frame is now under
  1 ms.
