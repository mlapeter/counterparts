/* Ways out — counted since birth; nothing disappears silently. */
import { $, esc } from "../../../shared/dom.js";

export const markup = `
        <h2>Ways out <small>— counted since birth; nothing disappears silently</small></h2>
        <div class="card tablewrap" id="h-exits"></div>`;

export function paint(d) {
  $("h-exits").innerHTML =
    "<table><thead><tr><th>reason</th><th class='num'>since birth</th><th>what it means</th></tr></thead><tbody>" +
    d.exits.map((e) =>
      "<tr><td>" + esc(e.reason) + "</td>" +
      "<td class='num" + (e.absent ? " dimtd" : "") + "'>" + (e.absent ? esc(e.absent) : e.count) + "</td>" +
      "<td class='dimtd'>" + esc(e.gloss) + "</td></tr>"
    ).join("") + "</tbody></table>";
}
