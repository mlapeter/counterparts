/* The activity feed: narrated durable-log rows, newest first. Any page may
   render one; a feed REGISTERED as live also receives the pulse's new rows
   (`shell/pulse.js`), prepended and flashed. */
import { absenceLine } from "../absence.js";
import { $, esc } from "../dom.js";
import { openEvent } from "../event-modal.js";

export function renderFeed(el, events, ctx) {
  if (!events || events.length === 0) {
    el.innerHTML = absenceLine(ctx && ctx.feedAbsent ? ctx.feedAbsent : "(never run)", "nothing has reached my durable log");
    return;
  }
  el.innerHTML = events.map((e) =>
    '<div class="ev ' + e.tone + '" data-seq="' + e.seq + '" onclick="openEvent(' + e.seq + ')">' +
      '<span class="d">day ' + e.day + "</span>" +
      '<span class="t">' + esc(e.text) + '<span class="k">' + esc(e.name) +
        (e.node ? " · " + esc(e.node) : "") + "</span></span></div>"
  ).join("");
}

/** Element ids of the feeds the pulse writes into, in registration order. */
const LIVE = [];
export function registerLiveFeed(id) { if (!LIVE.includes(id)) LIVE.push(id); }

/** New events arrive oldest-first; each is inserted at the top, flashed. A feed
 *  still showing its absence line is left alone (its page repaints it). */
export function prependToLiveFeeds(fresh) {
  for (const el of LIVE.map((id) => $(id))) {
    if (!el || el.querySelector(".empty")) continue;
    for (const e of fresh) {
      const row = document.createElement("div");
      row.className = "ev " + e.tone + " flash";
      row.dataset.seq = e.seq;
      row.onclick = () => openEvent(e.seq);
      row.innerHTML = '<span class="d">day ' + e.day + '</span><span class="t">' + esc(e.text) +
        '<span class="k">' + esc(e.name) + (e.node ? " · " + esc(e.node) : "") + "</span></span>";
      el.insertBefore(row, el.firstChild);
    }
    while (el.children.length > 60) el.removeChild(el.lastChild);
  }
}
