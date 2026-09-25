/* The one picture of everything I hold: every memory a dot — how many lived
   days old across, how strong up, how much it mattered as its size, today's
   band as its colour. The band counts are the legend (click one to filter the
   list below), and the right margin is the strength distribution, split by
   band, on the same strength axis. Hover for the words, click to open. */
import { fit, hitTest } from "../../../shared/canvas.js";
import { BANDCOL, COL } from "../../../shared/colors.js";
import { $, esc } from "../../../shared/dom.js";
import { openMemory } from "../../../shared/memory-modal.js";
import { hideTip, showTip } from "../../../shared/tip.js";
import { filters, onFilter, toggle } from "../state.js";

/** Each band in a few plain words. */
export const BAND_WORDS = {
  episodic: "fresh — still an episode",
  semantic: "settled into what I know",
  identity: "part of who I am",
};

export const markup = `
        <h2>Everything I hold <small id="con-sub"></small></h2>
        <div class="card glance">
          <div class="bandkey" id="con-legend" role="group" aria-label="bands — click one to filter the list"></div>
          <div class="chart"><canvas id="con" height="340"></canvas></div>
          <div class="glance-foot" id="con-foot"></div>
        </div>`;

let data = null;
let conPoints = [];

export function mount() {
  const cv = $("con");
  cv.addEventListener("mousemove", (e) => {
    const hit = hitTest(cv, e, conPoints);
    cv.style.cursor = hit ? "pointer" : "default";
    if (!hit) return hideTip();
    const p = hit.p;
    showTip(e.clientX, e.clientY,
      (p.confidential ? '<span class="withheld">' + esc(p.text) + "</span>" : esc(p.text)) +
      '<div class="dimline">' + esc(p.kind) + " · " + esc(p.band) + " · " + Math.round(p.strength * 100) +
      "% strong · " + p.ageDays + " lived days old · used " + p.uses + "×</div>");
  });
  cv.addEventListener("mouseleave", hideTip);
  cv.addEventListener("click", (e) => {
    const hit = hitTest(cv, e, conPoints);
    if (hit) openMemory(hit.p.id);
  });
  $("con-legend").addEventListener("click", (e) => {
    const chip = e.target.closest("[data-band]");
    if (chip && !chip.disabled) toggle("band", chip.dataset.band);
  });
  onFilter(() => { paintLegend(); draw(); });
}

export function paint(d) {
  data = d;
  const plotted = d.points.length;
  const held = d.memories + (d.memories === 1 ? " memory" : " memories") +
    (d.schemas ? " and " + d.schemas + (d.schemas === 1 ? " entity or belief" : " entities and beliefs") : "");
  $("con-sub").textContent = "— " + held +
    (plotted < d.total ? " (the " + plotted + " strongest are plotted)" : "");
  $("con-foot").innerHTML =
    "<span>older →</span><span>size: how much it mattered when it arrived</span>" +
    "<span>right edge: how many sit at each strength</span>";
  paintLegend();
}

function paintLegend() {
  if (!data) return;
  $("con-legend").innerHTML = data.bands.map((b) => {
    const none = b.count === 0;
    const on = filters.band === b.label;
    return '<button type="button" class="bchip' + (none ? " none" : "") + (on ? " on" : "") + '" data-band="' +
      esc(b.label) + '"' + (none ? " disabled" : "") + ' aria-pressed="' + on + '">' +
      '<span class="bdot' + (none ? " hollow" : "") + '" style="' + (none ? "border-color:" : "background:") +
        BANDCOL[b.label] + '"></span>' +
      '<span class="bname">' + esc(b.label) + "</span>" +
      '<span class="bn">' + (none ? esc(b.absent || "(none yet)") : b.count) + "</span>" +
      '<span class="bw">' + esc(BAND_WORDS[b.label] || b.note) + "</span></button>";
  }).join("") + (filters.band ? '<span class="bhint">showing ' + esc(filters.band) + " only — click again for all</span>" : "");
}

export function draw() {
  if (!data) return;
  const MEM = data;
  const cv = $("con");
  const { ctx, w, h } = fit(cv);
  const narrow = w < 520;
  const margin = narrow ? 64 : 120; // the strength-distribution margin
  const padL = 40, padR = margin + 14, padT = 12, padB = 24;
  const plotR = w - padR;
  const maxAge = Math.max(1, ...MEM.points.map((p) => p.ageDays));
  const allNew = MEM.points.length > 0 && MEM.points.every((p) => p.ageDays === 0);
  const X = (a) => padL + (a / maxAge) * (plotR - padL);
  const Y = (s) => h - padB - Math.max(0, Math.min(1, s)) * (h - padT - padB);

  // grid + strength labels
  ctx.strokeStyle = "rgba(0,229,255,.07)";
  ctx.lineWidth = 1;
  ctx.fillStyle = "#79848f";
  for (let i = 0; i <= 4; i++) {
    const y = Y(i / 4);
    ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(w - 6, y); ctx.stroke();
    ctx.fillText(i * 25 + "%", 4, y + 4);
  }
  ctx.fillText("new", padL, h - 6);
  const label = maxAge + (maxAge === 1 ? " lived day" : " lived days");
  ctx.fillText(label, plotR - ctx.measureText(label).width, h - 6);

  // the right margin: strength, distributed, split by band
  const steps = MEM.strengthByBand || [];
  const peak = Math.max(1, ...steps.map((s) => Object.values(s.bands).reduce((a, b) => a + b, 0)));
  const mx = plotR + 12, mw = margin - 8;
  ctx.strokeStyle = "rgba(0,229,255,.14)";
  ctx.beginPath(); ctx.moveTo(mx - 0.5, padT); ctx.lineTo(mx - 0.5, h - padB); ctx.stroke();
  for (const s of steps) {
    const y0 = Y(s.to), y1 = Y(s.from);
    const bh = Math.max(1, y1 - y0 - 2);
    let x = mx;
    for (const b of ["episodic", "semantic", "identity"]) {
      const n = s.bands[b] || 0;
      if (n === 0) continue; // nothing drawn for an empty band — no colour without a memory behind it
      const bw = (n / peak) * mw;
      ctx.globalAlpha = filters.band && filters.band !== b ? 0.2 : 0.85;
      ctx.fillStyle = BANDCOL[b];
      ctx.fillRect(x, y0 + 1, bw, bh);
      x += bw;
    }
    ctx.globalAlpha = 1;
    const total = Object.values(s.bands).reduce((a, b) => a + b, 0);
    if (total > 0 && !narrow) {
      ctx.fillStyle = "#79848f";
      ctx.fillText(String(total), Math.min(x + 4, w - 24), y0 + bh / 2 + 5);
    }
  }

  if (MEM.points.length === 0) {
    ctx.fillStyle = "#8a95a3";
    ctx.fillText(String(MEM.pointsAbsent || "(never run)") + " — no memory to plot yet. Write a note, or just talk.", padL + 8, h / 2);
    conPoints = [];
    return;
  }

  if (allNew) {
    ctx.fillStyle = "#8a95a3";
    const msg = "All " + MEM.points.length + " were born today. They spread out to the right as days pass, and rise as they settle.";
    ctx.fillText(narrow ? "All born today — they spread out as days pass." : msg, padL + 30, Y(0.62));
  }

  conPoints = [];
  const few = MEM.points.length < 20;
  // Memories born the same day at the same strength would sit on one pixel —
  // on a young store, all of them. Stack them as a small sunflower instead, so
  // five memories read as five dots.
  const stacked = new Map();
  for (const p of MEM.points) {
    const r = (few ? 4 : 2) + Math.max(0, Math.min(1, p.salience)) * (few ? 6 : 5);
    let x = X(p.ageDays), y = Y(p.strength);
    const key = Math.round(x / 3) + "," + Math.round(y / 3);
    const i = stacked.get(key) || 0;
    stacked.set(key, i + 1);
    if (i > 0 && few) {
      const rad = 12 * Math.sqrt(i), th = i * 2.39996;
      x = Math.max(padL + r, Math.min(plotR - r, x + rad * Math.cos(th)));
      y = Math.max(padT + r, Math.min(h - padB - r, y + rad * Math.sin(th)));
    }
    const col = BANDCOL[p.band] || COL.dim;
    const faded = filters.band && filters.band !== p.band;
    ctx.globalAlpha = faded ? 0.15 : 1;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = col + (p.protected ? "ee" : "aa");
    ctx.fill();
    if (p.protected || p.band === "identity") { ctx.strokeStyle = col; ctx.lineWidth = 1; ctx.stroke(); }
    ctx.globalAlpha = 1;
    if (!faded) conPoints.push({ x, y, r: Math.max(r, 6), p });
  }
}
