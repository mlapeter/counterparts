/* The last cycle — which lived day each phase finished on. */
import { $, esc } from "../../../shared/dom.js";

export const markup = `
        <h2>The last cycle <small>— which lived day each phase finished on</small></h2>
        <div class="card tablewrap" id="h-phases"></div>`;

export function paint(d) {
  $("h-phases").innerHTML =
    "<table><thead><tr><th>phase</th><th>last finished</th><th class='num'>days ago</th></tr></thead><tbody>" +
    d.phases.map((p) =>
      "<tr><td>" + esc(p.phase) + "</td><td class='" + (p.absent ? "dimtd" : "") + "'>" +
      (p.absent ? esc(p.absent) : "lived day " + p.day) + "</td>" +
      "<td class='num dimtd'>" + (p.absent ? "—" : p.ago === 0 ? "today" : p.ago) + "</td></tr>"
    ).join("") + "</tbody></table>";
}
