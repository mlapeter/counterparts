/* Strength, distributed — how many memories sit at each depth. */
import { fit } from "../../../shared/canvas.js";
import { COL } from "../../../shared/colors.js";
import { $ } from "../../../shared/dom.js";

export const markup = `
        <h2>Strength, distributed <small>— how many memories sit at each depth</small></h2>
        <div class="card chart"><canvas id="hist" height="170"></canvas></div>`;

let data = null;
export function paint(d) { data = d; }

export function draw() {
  const cv = $("hist");
  const { ctx, w, h } = fit(cv);
  const d = data.distribution;
  const peak = Math.max(1, ...d.map((b) => b.count));
  const padL = 30, padB = 20, padT = 10;
  const bw = (w - padL - 10) / d.length;
  ctx.fillStyle = "#39424d";
  ctx.fillText(String(peak), 2, padT + 8);
  ctx.fillText("0", 2, h - padB + 4);
  d.forEach((b, i) => {
    const bh = (b.count / peak) * (h - padT - padB);
    const x = padL + i * bw;
    const t = b.from;
    ctx.fillStyle = t < 0.25 ? COL.dim : t < 0.6 ? COL.cyan : t < 0.85 ? COL.teal : COL.purple;
    ctx.globalAlpha = 0.85;
    ctx.fillRect(x + 1, h - padB - bh, bw - 2, bh);
    ctx.globalAlpha = 1;
  });
  ctx.strokeStyle = "rgba(0,229,255,.12)";
  ctx.beginPath(); ctx.moveTo(padL, h - padB); ctx.lineTo(w - 8, h - padB); ctx.stroke();
  ctx.fillStyle = "#39424d";
  ctx.fillText("weakest", padL, h - 6);
  ctx.fillText("strongest", w - 68, h - 6);
}
