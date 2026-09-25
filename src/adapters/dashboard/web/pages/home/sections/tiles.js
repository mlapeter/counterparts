/* The few plain counts under the home page's headline (`/api/overview`'s
   `hero.counts`). Drawn with the tile classes, so the page reads its numbers
   the way it always did. */
import { $, esc } from "../../../shared/dom.js";

export const markup = `<div class="tiles home-counts" id="ov-tiles"></div>`;

export function paint(d) {
  $("ov-tiles").innerHTML = d.hero.counts.map((t) =>
    '<div class="tile' + (t.absent ? " quiet" : "") + '">' +
      '<div class="n">' + esc(t.value) + "</div>" +
      '<div class="l">' + esc(t.label) + "</div>" +
      '<div class="s">' + esc(t.note) + "</div></div>"
  ).join("");
}

/** One home count's number, READ OFF THE PAGE rather than out of a variable:
 *  the flow diagram's counters were proved live while the tiles beside them
 *  were not, and a harness that asked the payload would have believed a page
 *  that never repainted. (`tools/visual-loop` calls this.) */
window.tileValue = (label) => {
  for (const tile of document.querySelectorAll("#ov-tiles .tile")) {
    const l = tile.querySelector(".l");
    if (l && l.textContent === label) {
      const n = tile.querySelector(".n");
      return n ? n.textContent : "";
    }
  }
  return "";
};
