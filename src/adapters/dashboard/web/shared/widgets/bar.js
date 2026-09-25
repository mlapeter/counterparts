/* Band bars: where every memory sits on the consolidation gradient. Used on
   the overview (with a gloss under each bar) and on memories (without). */
import { BANDCOL } from "../colors.js";
import { esc } from "../dom.js";
import { pct } from "../format.js";

export function bandBars(bands, withGloss) {
  return bands.map((b) =>
    '<div class="bar"><span class="lab' + (b.absent ? " none" : "") + '">' + esc(b.label) + "</span>" +
      '<span class="track">' + (b.count > 0
        // No colour without a memory behind it: an empty band's 0-width fill
        // still painted its glow, so identity showed purple at zero.
        ? '<span class="fill" style="width:' + pct(b.fraction) + '%;background:' +
          BANDCOL[b.label] + ';box-shadow:0 0 9px ' + BANDCOL[b.label] + '55"></span>'
        : "") + "</span>" +
      '<span class="n">' + (b.absent ? esc(b.absent) : b.count) + "</span></div>" +
    (withGloss ? '<div class="gloss">' + esc(b.note) + "</div>" : "")
  ).join("");
}
