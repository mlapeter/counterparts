/* The mechanism panel, under the hero — the site's Explorer, with this store in
   it. Eleven pills in the site's four families, each with its light (from
   `/api/mechanisms`) and, where the site marks it so, an "in dev" tag. Picking
   one (here, or on the brain) shows it INLINE: what it is, what the store says
   it did, a small picture of this store's own data where one exists
   (`mechanisms/<id>/panel.js`, fed by `/api/mechanism?id=`), what is built and
   what is still in development, and its last few firings.

   The pick survives the page's four-second refresh: it lives here, in module
   scope, and a refresh repaints the lights and the picked panel's data under it. */
import { FAMILIES, MECHANISMS, PANELS, guideUrl } from "../../../mechanisms/index.js";
import { REGIONS, regionOf } from "../../../mechanisms/regions.js";
import { api, fail } from "../../../shared/api.js";
import { $, esc } from "../../../shared/dom.js";
import "../../../shared/memory-modal.js"; // window.openMemory, for the pictures' rows
import { renderFeed } from "../../../shared/widgets/feed.js";
import { LIGHT_WORD, light } from "../../../shared/widgets/light.js";

export const markup = `
    <section class="home-panel" id="mech-panel" aria-labelledby="mech-title">
      <div class="mechs" id="mech-strip" role="group" aria-label="Memory mechanisms, by stage"></div>
      <div class="mech-body" id="mech-body"></div>
    </section>`;

const ORDER = MECHANISMS.map((m) => m.id);
const byIdStatic = Object.fromEntries(MECHANISMS.map((m) => [m.id, m]));
const familyOf = (m) => FAMILIES.find((f) => f.key === m.family) || FAMILIES[0];
const hexRgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);

let brain = { select() {}, levels() {}, pulse() {} };
let lights = {}; // id → { status, evidence, events }
let lastSeen = null; // id → newest backing seq, as of the previous paint
let selected = null;
let panelData = {}; // id → the /api/mechanism payload last read
let asked = 0;

const lightOf = (id) => lights[id] || { status: "grey", evidence: "", events: [] };

/** Hand the explorer the brain it drives (and that drives it). */
export function attachBrain(b) {
  brain = b;
  if (selected) pushSelectionToBrain();
}

/** A region was clicked on the brain: pick its first mechanism, or step to the
 *  next one if one of its mechanisms is already picked. */
export function pickRegion(key) {
  const region = REGIONS.find((r) => r.key === key);
  if (!region || region.mechanisms.length === 0) return;
  const at = region.mechanisms.indexOf(selected);
  select(region.mechanisms[at < 0 ? 0 : (at + 1) % region.mechanisms.length], true);
}

function pushSelectionToBrain() {
  const m = byIdStatic[selected];
  const region = regionOf(selected);
  if (!m || !region) return;
  brain.select(region.key, hexRgb(familyOf(m).color), m.short);
}

function paintStrip() {
  $("mech-strip").innerHTML = FAMILIES.map((f) =>
    '<div class="mech-group" style="--pin:' + f.color + '">' +
      '<span class="mech-fam">' + esc(f.label) + "</span>" +
      '<div class="mech-row">' +
        MECHANISMS.filter((m) => m.family === f.key).map((m) =>
          '<button type="button" class="mech-pill' + (m.id === selected ? " is-on" : "") + '" data-id="' + esc(m.id) + '"' +
            ' aria-pressed="' + (m.id === selected ? "true" : "false") + '" title="' + esc(m.name) + '">' +
            light(lightOf(m.id).status) + esc(m.short) + (m.inDev ? '<span class="mech-tag">in dev</span>' : "") + "</button>"
        ).join("") +
      "</div></div>"
  ).join("");
  for (const el of document.querySelectorAll("#mech-strip .mech-pill")) {
    el.addEventListener("click", () => select(el.dataset.id, false));
  }
}

const bullets = (xs) => xs.length === 0 ? "" : '<ul class="mech-list">' + xs.map((x) => "<li>" + esc(x) + "</li>").join("") + "</ul>";

/** The picked mechanism's panel. The words are the client module's; the light,
 *  the picture and the activity are this store's. */
function paintBody() {
  const m = byIdStatic[selected];
  if (!m) return;
  const l = lightOf(m.id);
  const grey = l.status === "grey";
  const panel = PANELS[m.id];
  const data = panelData[m.id];
  $("mech-panel").style.setProperty("--reg", familyOf(m).color);
  let picture;
  if (grey) {
    picture = '<div class="mech-notbuilt"><b>Not built yet.</b> ' + esc(l.evidence || "") + "</div>";
  } else if (!panel) {
    picture = "";
  } else if (data === undefined) {
    picture = '<p class="pic-none">reading this store…</p>';
  } else {
    picture = '<div class="mech-picture">' + panel.picture(data.picture) + "</div>";
  }
  $("mech-body").innerHTML =
    '<div class="mech-grid">' +
      '<div class="mech-text">' +
        '<p class="mech-eyebrow">' + esc(m.name) + (m.inDev ? ' <span class="mech-dev">in development</span>' : "") + "</p>" +
        '<h2 class="mech-title" id="mech-title">' + esc(m.tagline) + "</h2>" +
        '<p class="mech-explainer">' + esc(m.explainer) + "</p>" +
        '<p class="mech-evidence">' + light(l.status) + " <b>" + esc(LIGHT_WORD[l.status] || "") + "</b> — " + esc(l.evidence) + "</p>" +
        '<p class="mech-guide"><a href="' + esc(guideUrl(m.id)) + '" target="_blank" rel="noopener">see how it works →</a></p>' +
      "</div>" +
      '<div class="mech-side">' + picture + "</div>" +
    "</div>" +
    '<div class="mech-foot">' +
      '<div><h3 class="mech-h">What’s built</h3>' + (bullets(m.built) || '<p class="pic-none">Nothing yet.</p>') + "</div>" +
      '<div><h3 class="mech-h">Still in development</h3>' + (bullets(m.inDevelopment) || '<p class="pic-none">Nothing outstanding for this one.</p>') + "</div>" +
    "</div>" +
    (grey ? "" : '<h3 class="mech-h">Lately</h3><div class="card feed mech-feed" id="mech-feed"></div>');
  if (!grey) {
    const feed = $("mech-feed");
    if (data === undefined) feed.innerHTML = '<p class="pic-none" style="padding:10px 14px">reading this store…</p>';
    else if (data.activity.length === 0) feed.innerHTML = '<p class="pic-none" style="padding:10px 14px">No firing of this one is on record yet.</p>';
    else renderFeed(feed, data.activity);
  }
}

async function loadPanel(id) {
  if (lightOf(id).status === "grey") return;
  const ticket = ++asked;
  let d;
  try { d = await api("/api/mechanism?id=" + encodeURIComponent(id)); } catch (e) { return fail("The " + id + " panel", e); }
  panelData[id] = d;
  if (ticket === asked && id === selected) paintBody();
}

/** Pick a mechanism. `fromBrain`: on a phone the panel sits below the brain,
 *  often off screen, so bring it into view or the tap looks like it did nothing. */
export function select(id, fromBrain) {
  if (!byIdStatic[id]) return;
  selected = id;
  for (const el of document.querySelectorAll("#mech-strip .mech-pill")) {
    const on = el.dataset.id === id;
    el.classList.toggle("is-on", on);
    el.setAttribute("aria-pressed", on ? "true" : "false");
  }
  pushSelectionToBrain();
  paintBody();
  loadPanel(id);
  if (fromBrain && matchMedia("(max-width: 900px)").matches) {
    const panel = $("mech-panel");
    if (panel && panel.getBoundingClientRect().top > innerHeight * 0.45) {
      panel.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
    }
  }
}

/** Lights in: repaint the strip, the brain's steady glow, and — for every
 *  mechanism whose newest backing row moved since the last paint — a flare on
 *  its region. The first paint flares each working region once, staggered. */
function paint(view) {
  lights = Object.fromEntries(view.mechanisms.map((l) => [l.id, l]));
  if (selected === null) {
    selected = ORDER.find((id) => lightOf(id).status === "green") || ORDER[0];
  }
  paintStrip();
  const levels = {};
  for (const r of REGIONS) {
    levels[r.key] = Math.max(0, ...r.mechanisms.map((id) => {
      const s = lightOf(id).status;
      return s === "green" ? 1 : s === "amber" ? 0.25 : 0;
    }));
  }
  brain.levels(levels);
  const newest = Object.fromEntries(view.mechanisms.map((l) => [l.id, l.events[0] ?? null]));
  if (lastSeen === null) {
    let k = 0;
    for (const r of REGIONS) {
      if (levels[r.key] === 1) setTimeout(() => brain.pulse(r.key), 400 + 450 * k++);
    }
  } else {
    for (const id of ORDER) {
      if (newest[id] !== null && newest[id] !== lastSeen[id]) {
        const r = regionOf(id);
        if (r) brain.pulse(r.key);
      }
    }
  }
  lastSeen = newest;
  pushSelectionToBrain();
}

export async function render() {
  let view;
  try { view = await api("/api/mechanisms"); } catch (e) { return fail("The mechanisms", e); }
  paint(view);
  paintBody();
  await loadPanel(selected);
}

/** The store moved: new lights, and the picked panel's data read again (the
 *  others are dropped, so picking one later reads it fresh). */
export async function refresh() {
  let view;
  try { view = await api("/api/mechanisms"); } catch (e) { return; }
  paint(view);
  const keep = panelData[selected];
  panelData = keep === undefined ? {} : { [selected]: keep };
  await loadPanel(selected);
}
