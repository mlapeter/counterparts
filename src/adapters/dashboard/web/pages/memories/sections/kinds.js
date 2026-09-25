/* Kinds — and the physics each one is moved by. */
import { $, esc } from "../../../shared/dom.js";
import { n2 } from "../../../shared/format.js";

export const markup = `
        <h2>Kinds <small>— and the physics each one is moved by</small></h2>
        <div class="card tablewrap" id="kinds"></div>
        <p class="foot">
          <b style="color:var(--dim);font-weight:400">wSal / wRep</b> — how much salience and repetition each
          contribute to a memory's base strength. <b style="color:var(--dim);font-weight:400">κ</b> divides
          stability, so a higher number erodes faster. <b style="color:var(--dim);font-weight:400">ι</b> is
          revision inertia: the fraction of the memory's own strength a challenge must out-sum to land.
        </p>`;

export function paint(d) {
  $("kinds").innerHTML =
    "<table><thead><tr><th>kind</th><th class='num'>held</th><th class='num'>mean</th>" +
    "<th class='num'>wSal</th><th class='num'>wRep</th><th class='num'>κ</th><th class='num'>ι</th></tr></thead><tbody>" +
    d.kinds.map((k) =>
      "<tr><td>" + esc(k.kind) + '<div class="meta" style="color:var(--faint);font-size:10px;margin-top:3px">' +
      esc(k.gloss) + "</div></td>" +
      '<td class="num' + (k.absent ? " dimtd" : "") + '">' + (k.absent ? esc(k.absent) : k.count) + "</td>" +
      '<td class="num dimtd">' + n2(k.meanStrength) + "</td>" +
      '<td class="num dimtd">' + n2(k.wSal) + '</td><td class="num dimtd">' + n2(k.wRep) + "</td>" +
      '<td class="num dimtd">' + n2(k.kappa) + '</td><td class="num dimtd">' + n2(k.iota) + "</td></tr>"
    ).join("") + "</tbody></table>";
}
