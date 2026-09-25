/* TEMPORARY: the eleven mechanisms as a compact strip — pills in their four
   families, each with its light and, where the site marks it so, an "in dev"
   tag. Hover (or focus) for a one-line reminder; click for a small card: what
   it does, what the store says it did (with the rows behind it), and what is
   built vs still in development. The full home design replaces this. It
   fetches for itself (`/api/mechanisms`) so the rest of the page does not wait. */
import { MECHANISMS, FAMILIES } from "../../../mechanisms/index.js";
import { api, fail } from "../../../shared/api.js";
import { $, esc } from "../../../shared/dom.js";
import "../../../shared/event-modal.js"; // window.openEvent, for the card's record rows
import { openModal, section } from "../../../shared/modal.js";
import { hideTip, showTip } from "../../../shared/tip.js";
import { LIGHT_WORD, light } from "../../../shared/widgets/light.js";

export const markup = `
    <h2>How it remembers <small>— lit by what fired in the last 7 lived days. Click one for what it does.</small></h2>
    <div class="mechs" id="mech-strip" role="group" aria-label="Memory mechanisms, by stage"></div>`;

let byId = {};

function lightOf(m) { return byId[m.id] || { status: "grey", evidence: "", events: [] }; }

function tipHtml(m) {
  const l = lightOf(m);
  return "<b>" + esc(m.name) + "</b>" + (m.inDev ? ' <span class="mech-dev">in development</span>' : "") +
    '<div class="dimline">' + light(l.status) + " " + esc(LIGHT_WORD[l.status] || "") + " — " + esc(l.evidence) + "</div>";
}

const bullets = (xs) => xs.length === 0 ? "" : '<ul class="mech-list">' + xs.map((x) => "<li>" + esc(x) + "</li>").join("") + "</ul>";

/** The detail card: explainer, the light's evidence and records, built vs in development. */
function openCard(m) {
  const l = lightOf(m);
  openModal(
    "<h3>" + esc(m.name) + (m.inDev ? ' <span class="mech-dev">in development</span>' : "") + "</h3>" +
    '<div class="sub">' + esc(m.tagline) + "</div>" +
    '<p class="mech-explainer">' + esc(m.explainer) + "</p>" +
    section("what the store says", '<div class="mech-evidence">' + light(l.status) + " <b>" + esc(LIGHT_WORD[l.status] || "") + "</b> — " + esc(l.evidence) + "</div>" +
      (l.events.length === 0 ? "" : l.events.map((seq) =>
        '<div class="ref" onclick="openEvent(' + Number(seq) + ')"><span class="role">record</span>#' + Number(seq) + " — open it</div>").join(""))) +
    section("what's built", bullets(m.built), "Nothing yet.") +
    section("what's still in development", bullets(m.inDevelopment), "Nothing outstanding for this one.")
  );
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
            light(l.status) + esc(m.short) + (m.inDev ? '<span class="mech-tag">in dev</span>' : "") + "</button>";
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
    el.addEventListener("click", () => { hideTip(); openCard(m); });
  }
}

export async function render() {
  let view;
  try { view = await api("/api/mechanisms"); } catch (e) { return fail("The mechanisms strip", e); }
  paint(view);
}
