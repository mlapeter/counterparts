/* The identity band, the protected rows, the permanent rows outside the band,
   and the band rows that could not be read — the left column of the mind tab. */
import { absenceLine, emptyBox } from "../../../shared/absence.js";
import { $, esc } from "../../../shared/dom.js";
import { livedSpan, n2, said } from "../../../shared/format.js";

export const markup = `
        <h2>Identity band <small>— what strength earned; physics can still move it</small></h2>
        <div class="card rows" id="mind-identity"></div>
        <h2>Protected <small>— permanent, including permanently wrong</small></h2>
        <div class="card rows" id="mind-protected"></div>
        <h2>Permanent but outside the band <small>— the rows most worth staring at</small></h2>
        <div class="card rows" id="mind-outside"></div>
        <h2>Identity-band rows I could not read just now</h2>
        <div class="card rows" id="mind-unreadable"></div>`;

export function paint(d) {
  const elRow = (el) =>
    '<div class="r click" onclick="openMemory(\'' + el.id + '\')">' + said(el.text, el.confidential) +
    '<div class="meta"><span class="k">' + esc(el.kind) + "</span><span>" + esc(el.band) +
    "</span><span>strength " + n2(el.strength) + "</span><span>" + el.bytes + " bytes</span>" +
    livedSpan(el) + "</div></div>";

  $("mind-identity").innerHTML = d.identityAbsent
    ? absenceLine(d.identityAbsent, "nothing has become constitutive")
    : d.identity.map(elRow).join("");
  $("mind-protected").innerHTML = d.guardedAbsent
    ? absenceLine(d.guardedAbsent, "nothing is permanent ink")
    : d.guarded.map(elRow).join("");
  $("mind-outside").innerHTML = d.protectedOutsideIdentity.length === 0
    ? emptyBox("(none yet) — every permanent element also stands in the identity band.", "")
    : d.protectedOutsideIdentity.map((el) =>
        '<div class="r click" onclick="openMemory(\'' + el.id + '\')">' + esc(el.text) + "</div>").join("");
  $("mind-unreadable").innerHTML = d.unreadable.length === 0
    ? emptyBox("(none yet) — every element in the band read cleanly.", "")
    : d.unreadable.map((u) => '<div class="r">' + esc(u.label) + "</div>").join("");
}
