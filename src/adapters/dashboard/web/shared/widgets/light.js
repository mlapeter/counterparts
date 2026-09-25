/* The status light: one small dot that says whether a mechanism is working.
     green — built, and it fired in the window
     amber — built, and it has not fired in the window
     grey  — not built yet; it never claims activity
   The word travels with the dot (as its accessible name), so the colour is
   never the only carrier of the meaning. */
import { esc } from "../dom.js";

export const LIGHT_WORD = { green: "firing", amber: "quiet", grey: "not built yet" };

/** A light's markup. Unknown statuses draw grey rather than guess. */
export function light(status) {
  const s = status === "green" || status === "amber" ? status : "grey";
  return '<span class="light light-' + s + '" role="img" aria-label="' + esc(LIGHT_WORD[s]) + '"></span>';
}
