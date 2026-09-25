/* The "(none yet)" / "(never run)" block. Absence has two words, and every
   panel says which; none is blank. */
import { esc } from "./dom.js";

export function emptyBox(msg, extra) {
  return '<div class="empty"><b>' + esc(msg) + "</b>" + (extra ? " " + esc(extra) : "") + "</div>";
}
/** The two words, given their meaning back. */
export function absenceLine(marker, whatItWouldHold) {
  const why = marker === "(never run)"
    ? "I have never been asked, so there is nothing here to be wrong about."
    : "I have looked, and the answer is none.";
  return emptyBox(marker + " — " + whatItWouldHold + ".", why);
}
