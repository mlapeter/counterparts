/* TEMPORARY: the eleven mechanisms as a compact strip — pills in their four
   families, each with its light; hover (or focus) for what it does and what
   the store says it did. The full home design replaces this. It fetches for
   itself (`/api/mechanisms`) so the rest of the page does not wait on it. */
import { MECHANISMS, FAMILIES } from "../../../mechanisms/index.js";
import { api, fail } from "../../../shared/api.js";
import { $, esc } from "../../../shared/dom.js";
import { openEvent } from "../../../shared/event-modal.js";
import { hideTip, showTip } from "../../../shared/tip.js";
import { LIGHT_WORD, light } from "../../../shared/widgets/light.js";

export const markup = `
    <h2>How it remembers <small>— lit by what fired in the last 7 lived days</small></h2>
    <div class="mechs" id="mech-strip" role="group" aria-label="Memory mechanisms, by stage"></div>`;

let byId = {};

function tipHtml(m) {
  const l = byId[m.id] || { status: "grey", evidence: "" };
  return "<b>" + esc(m.name) + "</b>" + (m.inDev ? ' <span class="mech-dev">in development</span>' : "") +
    "<div>" + esc(m.explainer) + "</div>" +
    '<div class="dimline">' + light(l.status) + " " + esc(LIGHT_WORD[l.status] || "") + " — " + esc(l.evidence) + "</div>";
}

export function paint(view) {
  byId = Object.fromEntries(view.mechanisms.map((l) => [l.id, l]));
  $("mech-strip").innerHTML = FAMILIES.map((f) =>
    '<div class="mech-group" style="--pin:' + f.color + '">' +
      '<span class="mech-fam">' + esc(f.label) + "</span>" +
      '<div class="mech-row">' +
        MECHANISMS.filter((m) => m.family === f.key).map((m) => {
          const l = byId[m.id] || { status: "grey" };
          return '<button type="button" class="mech-pill" data-id="' + esc(m.id) + '">' +
            light(l.status) + esc(m.short) + "</button>";
        }).join("") +
      "</div></div>"
  ).join("");
  for (const el of document.querySelectorAll("#mech-strip .mech-pill")) {
    const m = MECHANISMS.find((x) => x.id === el.dataset.id);
    const show = () => { const r = el.getBoundingClientRect(); showTip(r.left, r.top, tipHtml(m)); };
    el.addEventListener("mouseenter", show);
    el.addEventListener("focus", show);
    el.addEventListener("mouseleave", hideTip);
    el.addEventListener("blur", hideTip);
    // A lit pill opens the newest row behind its light.
    el.addEventListener("click", () => {
      const l = byId[m.id];
      if (l && l.events.length > 0) { hideTip(); openEvent(l.events[0]); }
    });
  }
}

export async function render() {
  let view;
  try { view = await api("/api/mechanisms"); } catch (e) { return fail("The mechanisms strip", e); }
  paint(view);
}
