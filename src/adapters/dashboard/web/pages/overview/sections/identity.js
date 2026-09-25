/* Who I am — the identity band, as rows. */
import { absenceLine } from "../../../shared/absence.js";
import { $, esc } from "../../../shared/dom.js";
import { livedSpan, n2, said } from "../../../shared/format.js";

export const markup = `
        <h2>Who I am <small>— the identity band</small></h2>
        <div class="card rows" id="ov-identity"></div>`;

export function paint(d) {
  $("ov-identity").innerHTML = d.identityAbsent
    ? absenceLine(d.identityAbsent, "nothing has become constitutive")
    : d.identity.map((el) =>
        '<div class="r click" onclick="openMemory(\'' + el.id + '\')">' + said(el.text, el.confidential) +
        '<div class="meta"><span class="k">' + esc(el.kind) + "</span>" +
        // NOT `strength 1.00`. Every element in this band is at 1.00 by
        // construction, so the field said one thing fifteen times down the
        // panel in the README's first image. The day it crossed is the fact
        // that varies — and where the store never recorded a crossing, this
        // says nothing rather than repeating a tautology or inventing a day.
        (el.promotedDay === null
          ? (el.strength < 1 ? "<span>strength " + n2(el.strength) + "</span>" : "")
          : "<span>promoted day " + el.promotedDay + "</span>") +
        livedSpan(el) + "</div></div>"
      ).join("");
}
