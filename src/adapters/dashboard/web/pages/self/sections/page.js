/* The self page — the heart of the tab — and its history as a line of dots.
   Clicking a dot shows that version and what changed from the one before it.
   Read-only: there is no write door here (the doors are the MCP tool and the
   console's `self-page`). */
import { absenceLine } from "../../../shared/absence.js";
import { $, esc } from "../../../shared/dom.js";
import { diffStats, diffText } from "../diff.js";
import { renderMarkdown } from "../markdown.js";

export const markup = `
    <section class="sp-card" id="self-page"></section>
    <div id="self-history"></div>`;

let steps = [];
let chosen = -1;
let showWhole = false;

const WHO = { owner: "you, by hand", session: "a session", writer: "the page writer" };
export const who = (by) => (by ? WHO[by] || by : "someone unrecorded");

/** "2026-09-24" → "Sep 24" (and the year when it is not this one). */
export function shortDate(iso) {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  const d = new Date(iso + "T12:00:00Z");
  const opts = { month: "short", day: "numeric", timeZone: "UTC" };
  if (d.getUTCFullYear() !== new Date().getFullYear()) opts.year = "numeric";
  return d.toLocaleDateString("en-US", opts);
}

export function paint(d) {
  const p = d.page;
  $("self-page").innerHTML = d.pageAbsent
    ? '<h2 class="sp-title">Who I am</h2>' +
      absenceLine(d.pageAbsent, "no page has been written yet — it is written at the end of a session, from what keeps coming up, and you can amend it by hand")
    : '<div class="sp-head"><h2 class="sp-title">Who I am <small>— in my own words; the next session opens with this</small></h2>' +
        '<div class="sp-chips">' +
          '<span class="chip">version ' + (p.version + 1) + "</span>" +
          '<span class="chip">revised ' + esc(shortDate(p.revisedOn) || p.revisedOn || "on an unrecorded date") + "</span>" +
          '<span class="chip">by ' + esc(who(p.by)) + "</span>" +
          (p.stale ? '<span class="chip warn">not revised in a while</span>' : "") +
        "</div></div>" +
      (p.reason ? '<div class="sp-reason">Last change: ' + esc(p.reason) + "</div>" : "") +
      '<div class="sp-body">' + renderMarkdown(p.body) + "</div>";

  // Stay on the standing page when a new version lands; otherwise stay put.
  const wasLast = chosen === steps.length - 1;
  steps = d.pageHistory || [];
  if (wasLast || chosen < 0 || chosen >= steps.length) chosen = steps.length - 1;
  paintHistory();
}

function paintHistory() {
  const el = $("self-history");
  if (steps.length === 0) { el.innerHTML = ""; return; }
  if (steps.length === 1) {
    el.innerHTML = '<p class="foot sp-once">The page has been written once; there is no earlier version to compare.</p>';
    return;
  }
  const dots = steps.map((s, i) =>
    '<button type="button" class="tl-step' + (i === chosen ? " on" : "") + (s.current ? " now" : "") +
      '" data-i="' + i + '" aria-pressed="' + (i === chosen) + '" title="' + esc(s.reason || "") + '">' +
      '<span class="tl-dot"></span>' +
      '<span class="tl-date">' + esc(shortDate(s.date) || (s.day !== null ? "day " + s.day : "undated")) + "</span>" +
      '<span class="tl-who">' + esc(s.current ? "now" : "v" + s.n) + " · " + esc(s.by === "owner" ? "you" : s.by || "?") + "</span>" +
    "</button>").join("");
  el.innerHTML =
    '<h2>How the page changed <small>— ' + steps.length + " versions; click one to see what changed</small></h2>" +
    '<div class="tl"><div class="tl-track">' + dots + "</div></div>" +
    '<div class="card pad tl-detail" id="self-version"></div>';
  el.querySelectorAll(".tl-step").forEach((b) => b.addEventListener("click", () => {
    chosen = Number(b.dataset.i);
    paintHistory();
  }));
  // Keep the chosen dot in view on a long history.
  const on = el.querySelector(".tl-step.on");
  if (on && on.scrollIntoView) on.scrollIntoView({ block: "nearest", inline: "nearest" });
  paintVersion();
}

function paintVersion() {
  const s = steps[chosen];
  const prev = chosen > 0 ? steps[chosen - 1] : null;
  const head =
    '<div class="tl-vhead"><b>' + (s.current ? "The page as it stands" : "Version " + s.n) + "</b>" +
    '<span class="tl-meta">' + esc(shortDate(s.date) || "undated") + (s.day !== null ? " · lived day " + s.day : "") +
    " · written by " + esc(who(s.by)) + (s.bytes !== null ? " · " + s.bytes + " bytes" : "") + "</span></div>" +
    (s.reason ? '<div class="tl-why">“' + esc(s.reason) + "”</div>" : "");
  if (s.body === null) {
    $("self-version").innerHTML = head + '<div class="foot">This version\'s words could not be read.</div>';
    return;
  }
  const canDiff = prev !== null && prev.body !== null;
  const toggle = canDiff
    ? '<div class="tl-toggle" role="group">' +
        '<button type="button" class="seg' + (showWhole ? "" : " on") + '" data-whole="0">What changed</button>' +
        '<button type="button" class="seg' + (showWhole ? " on" : "") + '" data-whole="1">The whole version</button></div>'
    : "";
  let body;
  if (!canDiff || showWhole) {
    body = (prev === null ? '<div class="foot">The first page — nothing came before it.</div>' : "") +
      '<div class="sp-body">' + renderMarkdown(s.body) + "</div>";
  } else {
    const rows = diffText(prev.body, s.body);
    const st = diffStats(rows);
    body = '<div class="foot">Compared with ' + (prev.n ? "version " + prev.n : "the one before") + ": " +
      '<span class="d-add">' + st.added + " line" + (st.added === 1 ? "" : "s") + " added or changed</span>, " +
      '<span class="d-del">' + st.removed + " taken out or changed</span>.</div>" +
      renderDiff(rows);
  }
  $("self-version").innerHTML = head + toggle + body;
  $("self-version").querySelectorAll(".seg").forEach((b) => b.addEventListener("click", () => {
    showWhole = b.dataset.whole === "1";
    paintVersion();
  }));
}

/** Unchanged runs longer than a few lines fold to one line saying so. */
function renderDiff(rows) {
  const out = [];
  let k = 0;
  while (k < rows.length) {
    if (rows[k].op === "=") {
      let e = k;
      while (e < rows.length && rows[e].op === "=") e++;
      const run = rows.slice(k, e);
      const keepHead = k === 0 ? 0 : 2, keepTail = e === rows.length ? 0 : 2;
      if (run.length > keepHead + keepTail + 1) {
        for (const r of run.slice(0, keepHead)) out.push(eqLine(r));
        out.push('<div class="d-fold">… ' + (run.length - keepHead - keepTail) + " unchanged lines …</div>");
        for (const r of run.slice(run.length - keepTail)) out.push(eqLine(r));
      } else {
        for (const r of run) out.push(eqLine(r));
      }
      k = e;
      continue;
    }
    const r = rows[k++];
    const cls = r.op === "+" ? "d-line add" : "d-line del";
    const sign = r.op === "+" ? "+" : "−";
    out.push('<div class="' + cls + '"><span class="d-sign" aria-hidden="true">' + sign + "</span><span>" +
      r.parts.map((p) => p.op === "=" ? esc(p.v) : p.op === "+" ? "<ins>" + esc(p.v) + "</ins>" : "<del>" + esc(p.v) + "</del>").join("") +
      "</span></div>");
  }
  return '<div class="diff">' + out.join("") + "</div>";
}

function eqLine(r) {
  return '<div class="d-line"><span class="d-sign" aria-hidden="true"> </span><span>' + (esc(r.text) || "&nbsp;") + "</span></div>";
}
