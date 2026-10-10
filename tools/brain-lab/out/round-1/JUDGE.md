# Round 1: judge's scorecard

I judged the frames at their real size. The PNGs are 2x retina: 740 px is about
370 pt, which is what Mike sees. I scaled copies to 370 px, and to 185 px for a
squint test, and compared them with `PRIMARY-i2-side-view.png`, `gray728-lateral.png`
and `mike-hologram-reference.png`. I also read `brain.ts` to check what the flares
light up.

**Short version:** this is a big step up from the blob. The silhouette now does
almost all the work, and it does it well. The inside of the brain works against it:
the folds read as dashed static rather than gyri, there's no clear fissure, and the
cerebellum is fused to the occipital lobe. It isn't at the 8/10 bar yet.

## Scores

### 1. Recognizable as a brain at a glance at 42×14

| View | Score | Why |
|---|---|---|
| **side** | **7** | Squint at 185 px and it reads "brain" at once: rounded frontal pole, a temporal step, the violet cerebellum, a stem. At 370 px the inside is an even field of 1–4-dot dashes, so it reads as a brain-shaped outline full of static. |
| **tq-front** | **6** | Same silhouette, but the parietal area turns into vertical dash columns (a barcode look, around x≈490/545/600 in `tq-front.png`). The top rim is doubled. The temporal lobe reads as a separate sausage under the frontal lobe. |
| front | 4 | Reads as a heart, a teddy-bear head or a skull mask: two violet hippocampus "eyes" and an amber "brow". The sway never shows it, so it barely matters. |
| tq-back | 5 | The cerebellum swells to about 55% of the brain's width, and its two halves read as a second purple brain underneath. The sway never shows it. |

Weighted toward side and tq-front, this comes to **about 6.5**.

### 2. Silhouette and anatomy: **6**

The frontal lobe is good: a rounded pole and an orbital underside. Everything else
is present but soft:

- **Temporal lobe.** Its pole is a square vertical step (side view, x≈230 px), not
  a rounded nose under a V notch.
- **Lateral fissure.** It's a horizontal line at mid-height that never connects to
  that notch.
- **Cerebellum.** Its back edge stops only about 4 dots (about 5% of the length)
  short of the occipital pole. Gray728 and PRIMARY both have about 10%. There's
  0–1 dot of gap between it and the cerebrum.
- **Brainstem.** It's a closed U-shaped "drip" about 2.5 rows long, in nearly the
  cerebellum's violet.
- **Top edge.** There's a step of about 2 dots where the frontal ellipsoid meets
  the parietal one (side and tq-front, about 40% back from the front). In the hero
  the top edge reads as three bubbles.

### 3. Not a blob: **6**

It's no longer a blob. The rim, the amber core, the violet lower structures and the
cerebellum all separate. But the inside is one even texture, and the folds don't
read as gyri at 42×14. They're short, angular, gappy pieces: four plane waves cut
into cells read as circuit traces. In the upper teal zone, some fold dots are nearly
as bright as the rim.

### 4. Hologram look: **6**

**What's right:**
- the cyan family;
- a light-cyan rim;
- the region colours (the amber thalamus is the best single element on screen).

**What's missing:**
- **The glass body.** Mike's reference has a bright rim around a dark, glassy
  middle. Here the inside is about as dense as the edge, so it reads as a dot-matrix
  wireframe rather than a hologram.
- **Readable inner structures.** The thalamus is a solid block. The hippocampus is
  a straight bar. The amygdala is a 2-cell red smear that looks like a glitch.
- **One copy of each inner structure.** In three-quarter views both hemispheres'
  copies are drawn, so the hippocampus and amygdala appear twice. The hero shows
  two violet bands and two red rings.

### 5. Flares: **6**

**Amber prefrontal ("Prospective"):** unmistakable, and the tag is legible. But the
region ends in a straight vertical cut (`regionOf` splits the cerebrum at the plane
z > 0.56), so it reads as "the left third painted yellow", not as a lobe. It's also
the same hue as the thalamus at rest.

**Cyan amygdala ("Salience"):**
- The lit area is a bar about 9 cells wide and 3 rows tall. That's both amygdalae,
  pushed apart by the yaw, plus their 2-dot halos: about 4 times the resting
  amygdala's footprint.
- On the dimmed cyan brain it stands out by brightness only.
- The `◆` covers the white core.
- The tag sits on the thalamus and hippocampus, the brain's best landmarks.

The 60% spotlight dim works: the silhouette stays visible at real size in both.

### 6. Small sizes and the paused frame: **6**

- **Inline 30×10: 7.** It arguably reads better than 42×14, because the rim
  outweighs the inside. The amygdala is a stray red dot.
- **Paused grey: 6.** The silhouette holds. Without colour, the inside is a uniform
  grey dash field, and the thalamus and hippocampus become brighter grey blocks that
  look like rendering artefacts. This is the frame closest to the old blob.

### 7. Motion, judged from the description: **7**

**What works:**
- It sways rather than spins, on a sine, over 40 s.
- It stops drawing after 60 s idle, and bursts only while a pulse's arc flies.
- It costs 1.15 ms a frame (about 15% over the 1 ms target, which is fine) and
  changes 102 of 588 cells a frame, 60% fewer than the old brain.
- Resting after 60 s is the real fix for "choppy".

**Caveats:**
- Braille dots snap to place. A one-dot rim moving 0.41 dot a frame doesn't glide.
  It jumps a whole dot every 2–3 frames, and at 6 fps those jumps land 333 or 500 ms
  apart. That uneven rhythm can still read as choppy even though the speed is low.
- Changing 17% of the cells six times a second is still a visible shimmer at the
  edge of your vision.
- The notes don't say how it eases back in when it wakes from rest.
- The notes don't say where it rests. It could freeze at an extreme (−6° or 46°).

**Worth A/B-testing live:**
- the calm sway drawn at 12 fps (about 14 ms of compute a second), so the jumps
  land at even intervals;
- or a smaller swing (±15–18°), so the jumps are rarer;
- easing into a fixed rest angle, the best-reading one (about 15–20°), and easing
  back out when it wakes.

## Top 5 changes for recognizability at 42×14, ranked

1. **Cut a real lateral fissure and shape the temporal pole.**
   - Draw an empty channel at least 2 dot-rows tall: no stipple, no folds, no inner
     fill.
   - Start it at the frontal–temporal notch, about 30% of the length from the front,
     and run it back and up 15–20° to about 65% of the length.
   - Draw the temporal lobe's top edge just below it at rim brightness.
   - Keep the hippocampus band out of the channel. Today it sits right on the
     fissure line and fills it.
   - Replace the square temporal pole with a rounded nose, under a notch at least
     2 dots deep.

   This line is what turns a brain-shaped outline into a brain.

2. **Make the rim clearly the brightest thing, and make the middle glassy.**
   - Halve the cortex stipple at 42×14.
   - Spread what's left so it's densest in the 2–3 dots just inside the silhouette
     and sparse where the surface faces the viewer.
   - Cap folds at about 60% of the rim's brightness.

   At real size, the rim should stand out and the inside should read as dark glass
   with a few lines in it. This is the biggest single lever between "blob" and
   "hologram".

3. **Fewer, longer, curved folds that follow the lobes.**
   - Aim for about 3–4 sinuous folds per lobe, each at least 8 dots long.
   - Drop any fold piece shorter than about 4 dots. Those pieces are the
     dashes and the "barcode".
   - Follow the anatomy: the central sulcus runs from the top down toward the
     fissure, leaning slightly forward, with the gyri on either side parallel to it.
     The temporal sulci run lengthwise along the temporal lobe, and the frontal
     sulci run front to back.
   - Keep the maze as a faint fill between those folds, not as the main structure.

4. **Tuck the cerebellum under and separate it.**
   - Pull its back edge forward so the occipital pole overhangs it by about 7 dots
     (about 10% of the length) rather than about 4.
   - Leave an empty gap of 1–2 dots between the cerebrum's underside and the
     cerebellum's top edge, all the way across.
   - Draw the folia as horizontal stripes every 2 dot-rows (about 5–6 stripes), with
     no stipple inside.
   - Shift it toward PRIMARY's lilac-pink, so it parts from the hippocampus violet
     and the brainstem.

5. **Clean up the silhouette and the brainstem.**
   - **Top edge:** make it one smooth convex arc, and remove the 2-dot shoulder
     where the frontal and parietal ellipsoids meet. The only notches should be the
     anatomical ones: the temporal pole, under the occipital lobe, and the stem.
   - **Double rim:** suppress inner occlusion edges that run within about 2 dots of
     the silhouette (the doubled top and front edges in the three-quarter view), or
     draw them at fold brightness.
   - **Brainstem:** make it an open stalk angled down and slightly back that fades
     out or runs off the bottom row, in indigo-blue with cyan stipple as in PRIMARY,
     instead of a closed violet U.

**Next after these:** draw the inner structures for one hemisphere only. Make the
amygdala at least 2×2 cells of solid pink, or leave it out at 42×14. Curve the
hippocampus from the amygdala back and up under the thalamus. Bound the prefrontal
flare by an anatomical line, or fade its edge over 2–3 dots, instead of a straight
cut. Put tags where they don't cover the thalamus.

## Anything worse than the old blob

- **The luminous volume is gone.** The old blob had a glowing body, staircase and
  all. This is a wireframe. Most of that is deliberate, but change 2 is what wins it
  back.
- **The paused grey frame** is close to a blob: an even grey dash field inside an
  outline.
- **The top edge is lumpy.** The old dome's top was a smooth arc. Now the ellipsoid
  seams show.
- **The front view is a new failure mode** (a face or heart). It's harmless only
  because the sway never shows it.
- **The cerebellum looks like a second brain** in tq-back. Same caveat: the sway
  never shows it.

Nothing else is worse: cost, cells changed per frame, flicker and the background
staircase all improved.

## Verdict

**Not yet ready to show Mike as "the brain".** Side scores 7 and tq-front 6, against
a bar of 8. It is clearly better than the blob, and Mike would recognize a brain.
But it doesn't yet read as a crisp hologram brain at a glance.

**The gap is the inside, not the outline.** Changes 1, 2 and 4 together (fissure
and temporal pole, rim-bright with a glassy middle, the cerebellum tucked under with
a gap) should take side to 8+ and tq-front to about 8. Change 3 and the silhouette
cleanup take it from there.
