/* Salience, pictured: the most recent memories, each dot sized by the
   importance score it was written with. */
import { esc } from "../../shared/dom.js";
import { memLink, nothingYet, two } from "../picture.js";

export function picture(p) {
  if (!p || p.memories.length === 0) return nothingYet("Nothing has been written yet, so nothing has been scored.");
  return '<ul class="pic-sal">' + p.memories.map((m) => {
    const size = 6 + Math.round(Math.sqrt(Math.max(0, Math.min(1, m.salience))) * 22);
    return '<li><span class="pic-dotwrap"><span class="pic-dot" style="width:' + size + "px;height:" + size + 'px"></span></span>' +
      "<span>" + memLink(m, 90) + '<span class="pic-meta">score ' + two(m.salience) + " · " + esc(m.memKind) + " · born day " + m.bornDay + "</span></span></li>";
  }).join("") + "</ul>" +
  '<p class="pic-cap">' + esc("My newest memories, sized by how much each mattered when it was written. Small ones fade fast; what mattered sticks.") + "</p>";
}
