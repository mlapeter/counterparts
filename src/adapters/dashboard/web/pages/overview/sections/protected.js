/* Permanent ink — the protected rows. */
import { absenceLine } from "../../../shared/absence.js";
import { $, esc } from "../../../shared/dom.js";
import { livedSpan, said } from "../../../shared/format.js";

export const markup = `
        <h2>Permanent ink <small>— protected: no revision path reaches these</small></h2>
        <div class="card rows" id="ov-protected"></div>`;

export function paint(d) {
  $("ov-protected").innerHTML = d.guardedAbsent
    ? absenceLine(d.guardedAbsent, "nothing is permanent ink")
    : d.guarded.map((el) =>
        '<div class="r click" onclick="openMemory(\'' + el.id + '\')">' + said(el.text, el.confidential) +
        '<div class="meta"><span class="k">' + esc(el.kind) + "</span>" + livedSpan(el) + "</div></div>"
      ).join("");
}
