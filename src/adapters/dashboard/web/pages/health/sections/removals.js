/* The removal record — what the owner erased, and why. */
import { absenceLine } from "../../../shared/absence.js";
import { $, esc } from "../../../shared/dom.js";

export const markup = `
        <h2>The removal record</h2>
        <div class="card rows" id="h-removals"></div>`;

export function paint(d) {
  $("h-removals").innerHTML = d.removalsAbsent
    ? absenceLine(d.removalsAbsent, "the owner has erased nothing")
    : d.removals.map((r) =>
        '<div class="r">' + esc(r.label) + '<div class="meta"><span class="k">' + esc(r.stage) +
        "</span><span>by " + esc(r.actor) + "</span><span>" + esc(r.reason || "no reason recorded") +
        "</span></div></div>").join("");
}
