/* The row of numbers across the top of the overview. */
import { $, esc } from "../../../shared/dom.js";

export const markup = `<div class="tiles" id="ov-tiles"></div>`;

export function paint(d) {
  $("ov-tiles").innerHTML = d.tiles.map((t) =>
    '<div class="tile ' + esc(t.accent === "cyan" ? "" : t.accent) + (t.absent ? " absent" : "") + '">' +
      '<div class="n">' + esc(t.value) + "</div>" +
      '<div class="l">' + esc(t.label) + "</div>" +
      '<div class="s">' + esc(t.note) + "</div></div>"
  ).join("");
}

/** One overview tile's number, READ OFF THE PAGE rather than out of a variable,
 *  for the same reason: the flow diagram's counters were proved live while the
 *  tiles beside them were not, and a harness that asked the payload would have
 *  believed a page that never repainted. (`tools/visual-loop` calls this.) */
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
