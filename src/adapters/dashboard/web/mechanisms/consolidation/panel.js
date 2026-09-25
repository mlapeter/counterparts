/* Consolidation, pictured: memories climbing toward the core, and how far each
   has to go. Becoming core takes both at once — a strong enough base, and real
   use on separate lived days. */
import { esc } from "../../shared/dom.js";
import { bar, memLink, nothingYet, two } from "../picture.js";

export function picture(p) {
  if (!p) return "";
  const rows = p.climbing.length === 0
    ? nothingYet("Nothing is climbing toward the core yet.")
    : '<ul class="pic-climb">' + p.climbing.map((c) =>
        "<li>" + memLink(c, 90) +
        '<div class="pic-two">' +
          '<span class="pic-lab">strength ' + two(c.base) + " · needs " + two(p.threshold) + "</span>" + bar(c.base / p.threshold, "#b388ff") +
          '<span class="pic-lab">used on ' + c.days + (c.days === 1 ? " day" : " days") + " · needs " + p.requiredDays + "</span>" + bar(c.days / p.requiredDays, "#00e5ff") +
        "</div></li>"
      ).join("") + "</ul>";
  const made = p.promoted.length === 0 ? "" :
    '<div class="pic-head pic-gap">Recently became core</div><ul class="pic-list">' +
      p.promoted.map((m) => "<li>" + memLink(m, 90) + '<span class="pic-meta">day ' + m.day + "</span></li>").join("") + "</ul>";
  return rows + made +
    '<p class="pic-cap">' + esc(p.core + " core " + (p.core === 1 ? "memory" : "memories") + " now. A memory becomes core when it is strong enough and has been used on " + p.requiredDays + " separate days.") + "</p>";
}
