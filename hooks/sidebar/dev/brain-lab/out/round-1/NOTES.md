# Round 1

Aimed at `refs/PRIMARY-i2-side-view.png` (side view, front left), with
`refs/gray728-lateral.png` (Gray's Anatomy fig. 728, public domain) for the
silhouette and the sulci.

## What changed

**The point cloud is gone.** `hooks/brain.ts` now models the brain as 13
ellipsoids: per hemisphere a frontal, a parietal and an occipital piece, the
temporal lobe (tilted 20°, hanging below the lateral fissure), and half the
cerebellum; then the midbrain, pons and medulla. They're proportioned from
Gray728 (length 2 units, cerebrum 1.27 tall), with the cerebellum and stem
lengthened toward the primary reference.

**Each frame casts one ray per braille dot** (orthographic, closed form), so
it gets a depth and a part for every dot (84 x 56 at 42x14). Everything drawn
comes from that, so every edge is exact and one dot wide:

- **Silhouette**: the brightest, light cyan (`#78eeff`).
- **Occlusion edges** (a part in front of another) are drawn as outline.
  **Creases** where two parts meet are drawn as fissures: the Sylvian fissure
  (cerebrum/temporal), the cerebellum's top edge, the stem. The midline
  between hemispheres is drawn dim, as a fold. Drawn bright, it read as a
  second outline in three-quarter views.
- **Folds**: each fold is the zero line of a function on the surface, drawn
  where the sign changes between neighbouring dots of one part. They stay glued
  to the brain as it turns, with no dither and no shimmer. They are:
  - the central sulcus and the superior temporal sulcus (named);
  - a quasi-periodic "maze" of gyri: four plane waves, finer as the brain gets
    bigger;
  - the cerebellum's folia, a fan of stripes.

  An A/B showed named sulci alone read as stripes or panels, and the maze reads
  as gyri.
- **Stipple**: about 30% of the facing surface, drawn from a pool of about
  32,000 fixed points on the surface, sorted by rank. A frame reads only as
  many as its size needs: about 4,300 at 42x14 and 22,000 at 90x32. They're fixed in the brain, so the
  dotted surface turns with it and never flickers. It runs cyan at the front
  and bottom to teal at the top and back (primary reference).
- **Inner structures behind glass**, in the regions' own colours:
  - the thalamus amber at the centre;
  - the hippocampus violet, a chain of 4 ellipsoids curving back and up;
  - the amygdala pink in front.

  They're drawn as an outline plus a light fill, which is a checker at large
  sizes.
- **The cerebellum is violet** with striped folia; the brainstem is indigo.

**No background colour.** Every cell takes the one bg it is given (the
sidebar's `#05080c`). The stepped glow is gone.

**Flares.** A lit region takes its stage colour:
- shell regions (prefrontal, cortex, cerebellum, stem): lines recoloured and
  the stipple 2.6x denser;
- inner regions: filled solid, with a white core and a halo 2 dots wide.

While anything is lit, the rest dims to 60% (a spotlight), so a cyan flare
still shows on the cyan brain. The tag (`◆` + name) is unchanged.

**One fg per cell.** Each dot has a priority:

| Priority | What |
|---|---|
| 1 | stipple |
| 2 | fold |
| 3 | inner |
| 4 | fissure |
| 5 | outline |
| 6 | lit |
| 7 | signal |

A cell takes the mean colour of its top-priority dots. Line dots always draw;
stipple draws only in cells whose top is a fold or less.

## Motion: sway, rest, burst

- **Sway, not spin.** The yaw swings 26° either side of 20°: from just past the
  side view (front left) to a three-quarter front-left. One cycle takes 40 s.
  The brain never sits in the front or back views. At its fastest, a pole of
  the 42x14 brain moves 2.4 dots/s, which is **0.41 dot a frame at 6 fps**.
  Each frame changes under half a dot, so it crawls rather than jumps.
- **Rest.** After 60 s with nothing firing, the sway eases to a stop over a
  few seconds and `mode()` says `rest`: no frames at all, and the last frame
  stands. A pulse or a picked mechanism wakes it.
- **Burst.** While a pulse's arc flies (about 1.75 s), `mode()` says `burst`
  and every tick draws.

**register.tsx wiring** (3 small edits):
- `DEFAULT_FPS` goes 6 → 12 (the burst rate);
- `tick()` asks `brain.mode()`: `rest` draws nothing, `calm` draws every
  other tick (6 fps), `burst` draws every tick;
- a tick counter on `fps`.

`/counterparts fps <n>` still sets the timer (the most it draws).

Tests updated:
- `pure.test.ts`: there's no bg glow, and it sways, rests and bursts.
- `pane.test.ts`: the report says `(target 12)`; the swaying window still
  draws 4–7 a second.

## Cost (bun 1.3.10, this Mac; `bun hooks/sidebar/dev/brain-lab/bench.ts`)

| brain | size | ms/frame (mean) | p95 | with encode | cells changed a frame (6 fps) |
|---|---|---|---|---|---|
| new | 42x14 | **1.15** | 1.26 | 1.19 | **102 of 588** |
| new | 30x10 | 0.60 | 0.72 | 0.61 | 42 of 300 |
| new | 90x32 | 5.53 | 6.21 | 5.68 | 795 of 2880 |
| before | 42x14 | 1.48 | 1.76 | 1.51 | 255 of 588 |
| before | 90x32 | 13.66 | 14.62 | 13.80 | 1037 of 2880 |

At 42x14:

- **Swaying:** about 7 ms of compute a second (6 fps), with 60% fewer cells
  for the terminal to repaint than before. The old brain's twinkle recoloured
  nearly every cell every frame.
- **At rest:** 0 frames. The 12 Hz timer ticks and returns.

The 7% CPU Mike saw in the host also includes the blit and the terminal's
repaint. Fewer changed cells and no frames at rest should cut those most.
That needs measuring live.

## The lab (`hooks/sidebar/dev/brain-lab/`)

- `lab.ts` + `index.html`: paint frames as iTerm2 would. Menlo is 13.5 px;
  cells are 8.13 x 16, measured from Mike's screenshot, not 7.8 x 17. Braille
  falls back to the system font that draws only the set dots.
- `shoot.ts round N`: builds the bundle and shoots each frame plus
  `contact.png` with headless Chrome on its own profile, then kills it.
- `bench.ts`: the table above.

## Open, for the judge

- The **front view** reads as two hemispheres with the stem, but it's the
  weakest. The sway never shows it.
- At 42x14, the gyri and the stipple share one hue family. They're told apart
  only by brightness.
- The `◆` sits on the anchor cell, so it covers a small lit inner structure
  (the amygdala). The halo shows around it.
