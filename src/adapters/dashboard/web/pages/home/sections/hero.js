/* The hero: one plain line about this memory and a few counts on the left, the
   brain on the right (`../brain.js`). The brain is mounted once; the words are
   repainted whenever the store moves. */
import { $ } from "../../../shared/dom.js";
import * as tiles from "./tiles.js";

export const markup = `
    <section class="home-hero" aria-label="This memory, today">
      <div class="home-copy">
        <p class="home-eyebrow">This memory, today</p>
        <p class="home-headline" id="home-headline"></p>
        ${tiles.markup}
      </div>
      <div class="home-brain" id="home-brain"></div>
    </section>`;

export function paint(d) {
  $("home-headline").textContent = d.hero.headline;
  tiles.paint(d);
}
