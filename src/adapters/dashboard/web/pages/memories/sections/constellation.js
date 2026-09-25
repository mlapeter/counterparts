/* The constellation: every memory as a dot — age across, strength up,
   salience as size, band as colour. Hover for the sentence, click to open. */
import { fit, hitTest } from "../../../shared/canvas.js";
import { BANDCOL, COL } from "../../../shared/colors.js";
import { $, esc } from "../../../shared/dom.js";
import { n2 } from "../../../shared/format.js";
import { openMemory } from "../../../shared/memory-modal.js";
import { hideTip, showTip } from "../../../shared/tip.js";

export const markup = `
        <h2>The constellation <small id="con-sub"></small></h2>
        <div class="card chart"><canvas id="con" height="330"></canvas></div>
        <div class="legend" id="con-legend"></div>`;

let data = null;
let conPoints = [];

export function mount() {
  $("con").addEventListener("mousemove", (e) => {
    const hit = hitTest($("con"), e, conPoints);
    if (!hit) return hideTip();
    const p = hit.p;
    showTip(e.clientX, e.clientY,
      (p.confidential ? '<span class="withheld">' + esc(p.text) + "</span>" : esc(p.text)) +
      '<div class="dimline">' + esc(p.kind) + " · " + esc(p.band) + " · strength " + n2(p.strength) +
      " · salience " + n2(p.salience) + " · born day " + p.bornDay + " · used " + p.uses + "×</div>");
  });
  $("con").addEventListener("mouseleave", hideTip);
  $("con").addEventListener("click", (e) => {
    const hit = hitTest($("con"), e, conPoints);
    if (hit) openMemory(hit.p.id);
  });
}

export function paint(d) {
  data = d;
  $("con-sub").textContent = "— " + d.total + " of them: age across, strength up, salience as size";
  $("con-legend").innerHTML = ["episodic","semantic","identity"].map((b) =>
    '<span><span class="chip" style="background:' + BANDCOL[b] + '"></span>' + b + "</span>").join("") +
    '<span style="color:var(--faint)">band is computed for today, not the one it was born into</span>';
}

export function draw() {
  if (!data) return;
  const MEM = data;
  const cv = $("con");
  const { ctx, w, h } = fit(cv);
  const padL = 34, padR = 12, padT = 12, padB = 26;
  const maxAge = Math.max(1, ...MEM.points.map((p) => p.ageDays));
  const X = (a) => padL + (a / maxAge) * (w - padL - padR);
  const Y = (s) => h - padB - Math.max(0, Math.min(1, s)) * (h - padT - padB);

  // grid
  ctx.strokeStyle = "rgba(0,229,255,.07)";
  ctx.fillStyle = "#39424d";
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const y = Y(i / 4);
    ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(w - padR, y); ctx.stroke();
    ctx.fillText((i / 4).toFixed(2), 2, y + 3);
  }
  ctx.fillText("0", padL, h - 8);
  ctx.fillText(maxAge + " lived days old", w - padR - 118, h - 8);

  if (MEM.points.length === 0) {
    ctx.fillStyle = "#5c6773";
    ctx.fillText(String(MEM.pointsAbsent || "(never run)") + " — I hold no memory to plot.", padL + 8, h / 2);
    conPoints = [];
    return;
  }

  conPoints = [];
  for (const p of MEM.points) {
    const x = X(p.ageDays), y = Y(p.strength);
    const r = 2 + Math.max(0, Math.min(1, p.salience)) * 5;
    const col = BANDCOL[p.band] || COL.dim;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = col + (p.protected ? "ee" : "99");
    ctx.fill();
    if (p.protected || p.band === "identity") {
      ctx.strokeStyle = col; ctx.lineWidth = 1; ctx.stroke();
    }
    conPoints.push({ x, y, r: Math.max(r, 5), p });
  }
}
