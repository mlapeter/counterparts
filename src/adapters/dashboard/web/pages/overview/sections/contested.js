/* Beliefs under argument — pressure against the bar it would take. */
import { absenceLine } from "../../../shared/absence.js";
import { COL } from "../../../shared/colors.js";
import { $, esc } from "../../../shared/dom.js";
import { n2, pct } from "../../../shared/format.js";

export const markup = `
        <h2>Beliefs under argument <small>— pressure against the bar it would take</small></h2>
        <div id="ov-contested"></div>`;

export function paint(d) {
  $("ov-contested").innerHTML = d.contestedAbsent
    ? absenceLine(d.contestedAbsent, "nothing I hold has been argued with")
    : d.contested.map(contestedCard).join("");
}

export function contestedCard(c) {
  const over = c.fraction >= 1;
  return '<div class="card pad" style="margin-bottom:8px">' +
    '<div style="font-size:10px;letter-spacing:1px;text-transform:uppercase;color:var(--faint)">about ' +
      esc(c.about) + "</div>" +
    '<div style="font-size:11.5px;margin:6px 0 8px;line-height:1.6">' + esc(c.now) + "</div>" +
    '<div class="bar" style="margin:6px 0"><span class="lab" style="font-size:10px;color:var(--dim)">pressure</span>' +
      '<span class="track"><span class="fill" style="width:' + pct(Math.min(1, c.fraction)) +
      "%;background:" + (over ? COL.amber : COL.teal) + ";box-shadow:0 0 9px " + (over ? COL.amber : COL.teal) + '55"></span></span>' +
      '<span class="n">' + n2(c.pressure) + "</span></div>" +
    '<div class="foot" style="margin-top:2px">' +
      (c.revised
        ? '<span style="color:var(--amber)">REVISED</span> — it changed its mind after ' + c.challenges + " credited " + (c.challenges === 1 ? "challenge" : "challenges") + ". The successor starts clean."
        : "held so far — it would take " + n2(c.bar) + " to move it, and " + c.challenges + " " + (c.challenges === 1 ? "challenge has" : "challenges have") + " landed") +
    "</div></div>";
}
