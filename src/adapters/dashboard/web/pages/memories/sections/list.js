/* Every memory, with its words — newest first, a page at a time. The server
   filters and pages (`/api/memories/list`), so a store of twenty thousand rows
   sends fifty. Click a row to open the memory. */
import { absenceLine } from "../../../shared/absence.js";
import { api, fail } from "../../../shared/api.js";
import { BANDCOL } from "../../../shared/colors.js";
import { $, esc } from "../../../shared/dom.js";
import { filters, onFilter, setFilter, toggle } from "../state.js";

const PAGE = 50;
const KIND_LABEL = { self: "about me", person: "people", entity: "things", skill: "skills", place: "places", fact: "facts" };

export const markup = `
        <h2 id="mlist-h">Every memory <small id="mlist-sub"></small></h2>
        <div class="mfilters" id="mfilters"></div>
        <div class="card mlist" id="mlist"></div>
        <div class="mpager" id="mpager"></div>`;

let seq = 0;

export function mount() {
  $("mfilters").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-f]");
    if (!b) return;
    const f = b.dataset.f, v = b.dataset.v || null;
    if (f === "state") setFilter({ state: v });
    else if (f === "clear") setFilter({ kind: null, band: null });
    else toggle(f, v);
  });
  $("mpager").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-off]");
    if (!b || b.disabled) return;
    setFilter({ offset: Number(b.dataset.off) });
    $("mlist-h").scrollIntoView({ block: "start", behavior: "smooth" });
  });
  onFilter(() => { render(); });
}

export async function render() {
  const mine = ++seq;
  const qs = new URLSearchParams({ state: filters.state, offset: String(filters.offset), limit: String(PAGE) });
  if (filters.kind) qs.set("kind", filters.kind);
  if (filters.band) qs.set("band", filters.band);
  let d;
  try { d = await api("/api/memories/list?" + qs.toString()); }
  catch (e) { return fail("The memory list", e); }
  if (mine !== seq) return; // a newer filter already asked
  paintFilters(d);
  paintRows(d);
  paintPager(d);
}

function chip(f, v, label, n, on, extraClass) {
  return '<button type="button" class="fchip' + (on ? " on" : "") + (extraClass ? " " + extraClass : "") +
    '" data-f="' + f + '"' + (v ? ' data-v="' + esc(v) + '"' : "") + ' aria-pressed="' + on + '">' +
    esc(label) + (n === undefined ? "" : ' <span class="fn">' + n + "</span>") + "</button>";
}

function paintFilters(d) {
  const c = d.counts;
  const state = [["live", "live", c.live], ["archived", "archived", c.archived], ["all", "all", c.live + c.archived]]
    .map(([v, l, n]) => chip("state", v, l, n, d.state === v, "seg")).join("");
  const kinds = Object.keys(c.kinds).map((k) => chip("kind", k, KIND_LABEL[k] || k, c.kinds[k], d.kind === k,
    c.kinds[k] === 0 ? "zero" : "")).join("");
  const bands = Object.keys(c.bands).map((b) => chip("band", b, b, c.bands[b], d.band === b,
    c.bands[b] === 0 ? "zero" : "")).join("");
  $("mfilters").innerHTML =
    '<div class="fgroup seggroup" role="group" aria-label="live or archived">' + state + "</div>" +
    '<div class="fgroup" role="group" aria-label="kind">' + kinds + "</div>" +
    '<div class="fgroup" role="group" aria-label="band">' + bands +
      (d.kind || d.band ? chip("clear", null, "show every kind and band", undefined, false, "clear") : "") + "</div>";
}

function paintRows(d) {
  const from = d.total === 0 ? 0 : d.offset + 1;
  const to = Math.min(d.total, d.offset + d.rows.length);
  $("mlist-sub").textContent = "— newest first · " + (d.total === 0 ? "none match" : from + "–" + to + " of " + d.total);
  if (d.rows.length === 0) {
    $("mlist").innerHTML = absenceLine(d.absent || "(none yet)",
      d.state === "archived" ? "nothing has been archived" + (d.kind || d.band ? " that matches these filters" : "")
        : "no memory matches these filters");
    return;
  }
  $("mlist").innerHTML = d.rows.map((r) => {
    const words = r.confidential
      ? '<span class="withheld">' + esc(r.line) + "</span>"
      : (r.title ? "<b>" + esc(r.title) + "</b>" + (r.line && r.line !== r.title ? " " + esc(r.line) : "") : esc(r.line));
    const pct = Math.round(Math.max(0, Math.min(1, r.strength)) * 100);
    return '<div class="mrow click' + (r.archived ? " arch" : "") + '" role="button" tabindex="0" ' +
      "onclick=\"openMemory('" + esc(r.id) + "')\" onkeydown=\"if(event.key==='Enter')openMemory('" + esc(r.id) + "')\">" +
      '<div class="mwords">' + words +
        (r.archived ? '<div class="mwhy">archived: ' + esc(r.archived) + "</div>" : "") + "</div>" +
      '<div class="mmeta">' +
        '<span class="mkind">' + esc(KIND_LABEL[r.kind] || r.kind) + (r.schemaRole ? " · " + esc(r.schemaRole) : "") + "</span>" +
        '<span class="mstr" title="' + pct + '% strong"><span class="strack"><span style="width:' + pct + '%;background:' +
          (BANDCOL[r.band] || "var(--dim)") + '"></span></span><span class="spct">' + pct + "%</span></span>" +
        '<span class="mage">' + (r.livedDays === 0 ? "today" : r.livedDays + (r.livedDays === 1 ? " day" : " days")) + "</span>" +
        '<span class="mband"><span class="bdot" style="background:' + (BANDCOL[r.band] || "var(--dim)") + '"></span>' +
          esc(r.band) + "</span>" +
      "</div></div>";
  }).join("");
}

function paintPager(d) {
  if (d.total <= d.limit) { $("mpager").innerHTML = ""; return; }
  const prev = Math.max(0, d.offset - d.limit);
  const next = d.offset + d.limit;
  const page = Math.floor(d.offset / d.limit) + 1;
  const pages = Math.ceil(d.total / d.limit);
  $("mpager").innerHTML =
    '<button type="button" class="mbtn" data-off="' + prev + '"' + (d.offset === 0 ? " disabled" : "") + ">← newer</button>" +
    '<span class="mpage">page ' + page + " of " + pages + "</span>" +
    '<button type="button" class="mbtn" data-off="' + next + '"' + (next >= d.total ? " disabled" : "") + ">older →</button>";
}
