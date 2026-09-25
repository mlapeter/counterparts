/* Graph hubs — what the most is wired to, by summed edge weight. */
import { absenceLine } from "../../../shared/absence.js";
import { $ } from "../../../shared/dom.js";
import { n2, said } from "../../../shared/format.js";

export const markup = `
        <h2>Graph hubs <small>— what the most is wired to, by summed edge weight</small></h2>
        <div class="card rows" id="hubs"></div>`;

export function paint(d) {
  $("hubs").innerHTML = d.hubsAbsent
    ? absenceLine(d.hubsAbsent, "nothing has been wired to anything yet")
    : d.hubs.map((h) =>
        '<div class="r click" onclick="openMemory(\'' + h.id + '\')">' + said(h.text, h.confidential) +
        '<div class="meta"><span>summed weight ' + n2(h.weight) + "</span><span>" + h.degree + " edges</span></div></div>"
      ).join("");
}
