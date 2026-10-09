# Round 2: judge's scorecard

The method and rubric are the same as round 1, so the scores compare directly.

**How I judged:**
- I scaled the 728 px frames (2x retina) to 364 px, which is what Mike sees, and to
  182 px for a squint test.
- I cropped the side frame's top and bottom to count dots.
- I checked the angles in `layout.ts`. Both rounds shot the same angles: side 0°,
  tq-front 40°, front 90°, tq-back −45°, flares and paused 20°, inline and hero
  30°. Round 2's sway now covers only 2–34°, so the tq-front shot (40°) sits a
  little past its far end.
- The lab's cell went from 8.13×16 to Mike's 8×16. The effect is negligible.

**Short version:** at real size, side and tq-front now read at once as a brain.
The carved fissure, the striped cerebellum tucked under, and the single top arc do
it. Both clear the bar at 8, but only just. The brainstem has almost vanished, the
folds are ruled lines rather than gyri, and the top rim is doubled.

## Scores, round 1 against round 2

| Item | Round 1 | Round 2 | Change |
|---|---|---|---|
| 1. Recognizable at 42×14: side | 7 | **8** | +1 |
| 1. Recognizable at 42×14: tq-front | 6 | **8** | +2 |
| 1. Recognizable at 42×14: front | 4 | 5 | +1 |
| 1. Recognizable at 42×14: tq-back | 5 | 6 | +1 |
| 2. Silhouette and anatomy | 6 | **7** | +1 |
| 3. Not a blob | 6 | **7** | +1 |
| 4. Hologram look | 6 | **7** | +1 |
| 5. Flares | 6 | **8** | +2 |
| 6. Small sizes and paused (inline / paused) | 6 (7 / 6) | **7** (7 / 8) | +1 |
| 7. Motion | 7 | **8** | +1 |

## Item by item

### 1. Recognizable as a brain at a glance at 42×14

**Side: 8.** It reads like classic brain clip-art: frontal lobe, a diagonal fissure
with the temporal lobe hanging below it, a lilac striped cerebellum under the back,
and the amber core. It's held at 8, not higher, by:
- a nearly invisible brainstem;
- folds that read as straight panel lines;
- a doubled middle stretch of the top edge.

**tq-front: 8.** Same read, and the bigger frontal pole helps. It's held back by the
same three things, plus about 5 near-vertical parallel folds in the back half
(around x≈450–600) that read as a barcode.

**Front: 5.** It now reads as two hemispheres either side of a midline, not a face.
Only one hippocampus is drawn, so it looks lopsided. The sway never shows it.

**tq-back: 6.** The fissure's mouth makes an odd hook or tongue at the left. The
cerebellum is a large striped slab. The sway never shows it.

### 2. Silhouette and anatomy: 7

Three of the four named parts are now strong:
- **Frontal lobe.**
- **Temporal lobe.** It has a rounded pole about 24% back from the front, which
  matches Gray728, and sits under a real channel.
- **Cerebellum.** I measured the overhang at about 7 of 74 dots (about 10%), with
  a 1–2-dot gap above it.

The top is now one arc.

**The brainstem is the gap.** My bottom crop shows two faint indigo dotted threads,
each about 6 dots long and about 5 dots apart. At 364 px they nearly disappear.

**The cerebellum is boxy:** a vertical back edge, a flat bottom, and a rounded-
rectangle outline.

### 3. Not a blob: 7

The blob problem is solved: the middle is dark glass, and every structure separates.
"Folds read as gyri" still fails. The named sulci are straight rulings with
right-angle junctions:
- vertical in the parietal lobe (side x≈260/290/355/400);
- horizontal in the frontal lobe.

They read as circuit traces or panel lines. The hero shows it plainly.

### 4. Hologram look: 7

**Better:**
- a bright rim over a glassy middle;
- an amber thalamus ring like PRIMARY's;
- a hippocampus that now curves back and up;
- a lilac-pink cerebellum distinct from the hippocampus violet;
- inner structures for one hemisphere only.

**Missing: the glow.** It now reads as a crisp blueprint or line drawing rather than
a luminous hologram. The rim is one 1-dot line in `#78eeff`. Mike's reference has
white-hot edges, and that's absent. The rim-weighted stipple shows as glow almost
nowhere except across the top, and there it reads as a second rim (see below).

### 5. Flares: 8

**Amber prefrontal:** the region reads as a lobe now, with an edge following the
central-sulcus line and dithered over about 2–3 dots. The tag is legible. One nit:
it sits on the top rim and breaks about 13 cells of the silhouette.

**Cyan amygdala:**
- It's now a small solid disc in the front of the temporal lobe, the right size and
  place.
- It stands out clearly on the brain dimmed to 60%.
- The `◆` sits just off the disc.
- The tag sits outside the brain at the bottom left and covers nothing.

### 6. Small sizes and the paused frame: 7

**Inline 30×10: 7.** It reads as a brain. The thalamus ring breaks into an amber
squiggle at this size, and a bright line through the middle runs nearly the full
length.

**Paused grey: 8.** It's now a clean line drawing of a brain: the fissure, the
temporal lobe and the striped cerebellum all read without colour. It's no longer
blob-like. This is the best frame of the round.

### 7. Motion, judged from the description: 8

**What works:**
- **Smaller sway.** It's ±16° about 18°, so the fastest dot moves 0.27 of a dot
  a frame, against 0.41 before.
- **Eased rest and wake.** It eases to rest at the best-reading angle, 18°, and
  eases back out when it wakes.
- **A frame cache.** When nothing has moved more than a fifth of a dot, it reuses
  the last frame.
- **Measured trade-offs.** The bun A/B gives 457 cells repainted a second against
  670 before, and any one cell changes only about every 0.9 s. Choosing 6 fps is
  reasoned from data, with 12 fps one constant away if live viewing shows uneven
  jumps.

**Flags, both from the artist's own NOTES:**
- `register` still blits a cached, unchanged frame 6 times a second. It should
  skip those, whatever the frame rate.
- An uncached frame is about 1.6 ms, against round 1's 1.15 ms, over the ~1 ms
  target. The stipple pass is 0.65 ms of that. It was measured at a load average
  of about 10, so it needs a quiet re-measure before calling it a regression.
  Bucketing the pool by normal direction, the artist's own idea, is the fix.

## Improved, got worse, newly wrong

**Improved:**
- the fissure and temporal lobe, the brain's key cue, which is now strong;
- the cerebellum tucked under, with its overhang and gap;
- one top arc;
- the glassy middle;
- one hemisphere's inner structures;
- the curved hippocampus;
- the amygdala flare;
- tag placement for Salience;
- the paused frame;
- the motion design.

**Got worse:**
1. **The brainstem.** In round 1 it was a visible stem, if a U-shaped one. Now it's
   two faint threads that nearly vanish at real size. It's one of the four parts
   the rubric names.
2. **The top rim is doubled.** A second row of dots at full rim brightness runs 1–2
   dots inside the edge, over about the middle 40% of the top. The NOTES call it
   the rim's glow by design. At rim brightness, though, it's a second rim, not a
   glow.
3. **The cerebellum's shape.** It's more recognizable as a cerebellum than in
   round 1, but it's now a striped rounded rectangle, and in tq-back it looks like
   a radiator.
4. **The uncached frame cost**, about 1.15 → 1.6 ms (see item 7 for the load
   caveat).
5. **Overall glow.** The glassy middle cost the luminous feel. It's a line drawing
   now.

**Newly wrong:**
- the near-vertical parallel sulci (the barcode) in tq-front's back half and in
  the hero;
- in the hero, a faint nested ghost arc about 25 dots inside the frontal outline,
  where cortex lies in front of cortex;
- the hero's squared-off cap at the back end of the fissure, which the artist
  already flagged;
- the thalamus ring breaking up at 30×10.

## Next top 5, ranked

The first four are for recognizability. The fifth is for the look.

1. **Make the brainstem a real stalk again.**
   - Make it one stalk 4–5 dots wide, not two separate threads.
   - Draw both edges at 70% or more of the cortex rim's brightness for the first 2
     rows below the temporal lobe, fading only in the last row before it runs off
     the bottom.
   - Give it a sparse cyan stipple inside.

   Today it's about 6 dots per thread at roughly 30% brightness. This is small,
   and it closes the one missing named part.

2. **Make the named sulci sinuous and leaning, not ruled.**
   - Lean the central, precentral and postcentral sulci about 25–30° from vertical,
     top toward the back and bottom toward the front.
   - Give every named sulcus a wobble of ±1–2 dots per 8 dots of length.
   - Avoid T-junctions at 90°.
   - In the parietal and occipital lobes, keep at most 2–3 near-vertical sulci
     (about 5 today in tq-front) so the back half stops reading as a barcode.

3. **One top rim, not two.**
   - Remove the continuous full-brightness row 1–2 dots under the top edge,
     whether it comes from the midline, the superior frontal sulcus or the
     rim-weighted stipple.
   - **What counts as glow:** sparse dots (about 25% density or less), dim (half
     the rim's brightness or less), directly next to the rim, and spread evenly all
     round the silhouette.
   - **What counts as a second rim:** a continuous row at rim brightness, 1–3 dots
     in.
   - Apply the same rule to the transverse occipital line, which runs parallel to
     the back edge about 5 dots in (side view, x≈610). Tilt it or shorten it.

4. **Round the cerebellum and curve its folia.**
   - Make its back and bottom one smooth convex curve, lowest about 40% in from its
     back end. Today it has a vertical back edge and a flat bottom.
   - Bend the folia into shallow arcs that follow that curve, like PRIMARY's
     fingerprint lines, rather than straight horizontal rulings.
   - Keep the folia a step dimmer than the cerebellum's rim, so the outline reads.

5. **The look: put white-hot highlights on the rim.**
   - Where the surface is most edge-on, take the rim toward near-white cyan (about
     `#c8faff`). Keep `#78eeff` elsewhere.
   - Let the evenly spread rim glow from change 3 carry the rest.

   This brings back the luminous edge of Mike's reference without refilling the
   middle.

**After these:**
- Below scale 50, draw the thalamus as a solid oval instead of a ring, so it
  doesn't break into a squiggle at 30×10.
- Keep the Prospective tag off the top rim. If it has to overlap, use the top-left
  corner.
- Skip blits of cached frames in `register`.
- Bucket the stipple pool by normal direction.
- Remove the hero's ghost arc and the squared-off cap at the fissure's back end.

## Verdict

**It meets the bar: side 8 and tq-front 8 at 42×14. Show Mike.**

Show it live in his iTerm rather than as stills. The stills can't show the motion,
and the lab only simulates his braille font.

Before showing it, changes 1 (the stalk) and 3 (one top rim) are each a small pass
and worth doing if there's time. They aren't blockers. To lift side and tq-front
above 8, the folds need to read as gyri (change 2): today the interior says "brain
diagram with panel lines", not "brain".
