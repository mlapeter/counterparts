/* Retrieval, pictured: the last turns that brought memories to mind — which
   were said out loud and which were kept as footnotes — and whether each has
   actually been used since (read off the memory itself: its last credited use
   is on or after that day). */
import { esc } from "../../shared/dom.js";
import { memLink, nothingYet } from "../picture.js";

export function picture(p) {
  if (!p || p.turns.length === 0) return nothingYet("No turn has brought a memory to mind yet.");
  return '<div class="pic-turns">' + p.turns.map((t) =>
    '<div class="pic-turn"><div class="pic-head">day ' + t.day + " · turn " + t.turn + "</div><ul>" +
      t.memories.map((m) =>
        '<li><span class="pic-tag' + (m.said ? " on" : "") + '">' + (m.said ? "said" : "footnote") + "</span>" +
        memLink(m, 80) +
        '<span class="pic-used' + (m.usedSince ? " yes" : "") + '">' + (m.usedSince ? "used since" : "not used since") + "</span></li>"
      ).join("") +
    "</ul></div>"
  ).join("") + "</div>" +
  '<p class="pic-cap">' + esc("Said out loud means it came into the conversation; a footnote was near enough to mention. Only the ones actually used get stronger.") + "</p>";
}
