/* What it's settling into: the core (identity band), what is protected, the
   beliefs under challenge — and, while those are empty or few, the memories
   closest to the core, measured against physics' own promotion rule (the view
   computes it; this only draws it). One line for anything genuinely empty. */
import { absenceLine } from "../../../shared/absence.js";
import { $, esc } from "../../../shared/dom.js";
import { headline, n2, said } from "../../../shared/format.js";
import { openModal } from "../../../shared/modal.js";
import { storyCard } from "./stories.js";

export const markup = `
        <h2 id="self-settling-h">What it's settling into <small>— the core, what's protected, what's being argued with</small></h2>
        <div class="card pad" id="self-settling"></div>`;

const SHOW = 5;
let stories = [];

export function paint(d) {
  const s = d.settling;
  stories = d.stories || [];
  const plural = (n, one, many) => n + " " + (n === 1 ? one : many);
  const parts = [];

  // ── the one-line summary ──
  const counts = [
    plural(s.core.length, "memory in the core", "memories in the core"),
    plural(s.guarded.length, "protected", "protected"),
    plural(s.contested.length, "belief being argued with", "beliefs being argued with"),
  ];
  parts.push('<div class="st-sum">' + counts.map((c) => "<span>" + esc(c) + "</span>").join("") + "</div>");

  // ── rows it could not read: always shown when it happens (never folded) ──
  if (s.unreadable.length > 0) {
    parts.push('<div class="st-warn"><b>' + plural(s.unreadable.length, "core memory", "core memories") +
      " could not be read just now:</b> " + s.unreadable.map((u) => esc(u.label)).join(" · ") + "</div>");
  }

  // ── the core ──
  if (s.core.length > 0) parts.push(group("In the core", "what repetition and weight earned; it no longer fades", s.core, "core"));
  // ── protected ──
  // When nothing protected stands in the core, the two lists are the same rows:
  // say it once, in the gloss, rather than printing them twice.
  const sameRows = s.outside.length > 0 && s.outside.length === s.guarded.length;
  if (s.guarded.length > 0) {
    parts.push(group("Protected", sameRows
      ? "permanent, including permanently wrong — and none of it has earned the core"
      : "permanent — including permanently wrong", s.guarded, "guarded"));
  }
  if (s.outside.length > 0 && !sameRows) {
    parts.push(group("Permanent but not in the core", "worth a look: nothing earned these their place", s.outside, "outside"));
  }
  // ── contested ──
  if (s.contested.length > 0) {
    parts.push('<h4 class="st-h">Being argued with <small>— pressure against the bar it has to clear to change</small></h4>' +
      s.contested.map((c, i) =>
        '<button type="button" class="st-row st-story" data-i="' + i + '">' +
          '<span class="st-text"><span class="st-about">about ' + esc(c.about) + "</span>" + esc(headline(c.now)) + "</span>" +
          (c.revised
            ? '<span class="st-tag changed">changed its mind</span>'
            : '<span class="st-bar" title="pressure ' + n2(c.pressure) + " of " + n2(c.bar) + '"><span style="width:' +
                Math.round(Math.min(1, c.fraction) * 100) + '%"></span></span>') +
        "</button>").join(""));
  }

  // ── the honest absences, in one line ──
  const empty = [];
  if (s.coreAbsent) empty.push("nothing in the core yet");
  if (s.guardedAbsent) empty.push("nothing protected");
  if (s.contestedAbsent) empty.push("no belief under challenge");
  if (empty.length > 0) {
    const marker = s.coreAbsent || s.guardedAbsent || s.contestedAbsent;
    parts.push('<div class="st-none"><b>' + esc(marker) + "</b> " + esc(empty.join(" · ")) +
      (s.coreAbsent && s.candidates.length > 0 ? " — here's what's closest." : ".") + "</div>");
  }

  // ── on the way ──
  parts.push(candidates(s));

  $("self-settling").innerHTML = parts.join("");
  $("self-settling").querySelectorAll(".st-story").forEach((b) => b.addEventListener("click", () => {
    const story = stories[Number(b.dataset.i)];
    if (story) openModal("<h3>How I changed my mind — or didn't</h3>" + storyCard(story));
  }));
  $("self-settling").querySelectorAll(".st-more").forEach((b) => b.addEventListener("click", () => {
    b.closest(".st-group").classList.add("all");
    b.remove();
  }));
}

function group(title, gloss, rows, key) {
  const more = rows.length > SHOW;
  return '<div class="st-group" data-k="' + key + '"><h4 class="st-h">' + esc(title) + " <small>— " + esc(gloss) + "</small></h4>" +
    rows.map((r, i) =>
      '<div class="st-row click' + (i >= SHOW ? " extra" : "") + '" onclick="openMemory(\'' + r.id + '\')">' +
        '<span class="st-text">' + said(r.text, r.confidential) + "</span></div>").join("") +
    (more ? '<button type="button" class="st-more">show all ' + rows.length + "</button>" : "") +
    "</div>";
}

function candidates(s) {
  const r = s.rule;
  const c = s.candidates;
  const rule = "A memory joins the core once what it has earned reaches " + n2(r.threshold) +
    " and it has been used on " + r.days + " different days. That is checked every " + r.everyDays + " lived days.";
  if (c.length === 0) {
    return '<h4 class="st-h">On the way to the core</h4>' +
      absenceLine("(none yet)", "no memory is on its way to the core yet") +
      '<p class="foot">' + esc(rule) + (s.outOfReach > 0 ? " " + esc(outOfReachLine(s)) : "") + "</p>";
  }
  const lead = c[0];
  const title = s.onTheWay > 0
    ? s.onTheWay + (s.onTheWay === 1 ? " memory is" : " memories are") + " on the way to the core" +
      (lead.days > 0 ? ": the closest has been used on " + Math.min(lead.days, lead.requiredDays) + " of the " + lead.requiredDays + " days it needs" : "")
    : "Closest to the core — strong enough, not yet used on a later day";
  const rows = c.map((m) => {
    const ready = m.eligible;
    const scale = 1.2; // the bar is drawn from 0 to 1.2 so 0.85 sits right of centre
    const have = Math.min(m.base, scale) / scale * 100;
    const ghost = m.consolidated ? 0 : Math.min(m.bonus, scale - Math.min(m.base, scale)) / scale * 100;
    const strong = m.base >= m.threshold;
    const dots = Array.from({ length: m.requiredDays }, (_, i) =>
      '<span class="dd' + (i < m.days ? " on" : "") + '"></span>').join("");
    const status = ready
      ? "ready — it crosses at the next check"
      : (strong ? "strong enough" : "needs " + n2(m.threshold - m.base) + " more" + (m.consolidated ? "" : " (settling adds " + n2(m.bonus) + " once)")) +
        " · used on " + Math.min(m.days, m.requiredDays) + " of " + m.requiredDays + " days";
    return '<div class="cand click' + (ready ? " ready" : "") + '" onclick="openMemory(\'' + m.id + '\')">' +
      '<div class="cand-text">' + said(m.text, m.confidential) + "</div>" +
      '<div class="cand-meters">' +
        '<span class="cm-lab">earned</span>' +
        '<span class="cm-track" title="earned ' + n2(m.base) + " — the core needs " + n2(m.threshold) + '">' +
          '<span class="cm-fill' + (strong ? " ok" : "") + '" style="width:' + have.toFixed(1) + '%"></span>' +
          (ghost > 0 ? '<span class="cm-ghost" style="left:' + have.toFixed(1) + "%;width:" + ghost.toFixed(1) + '%"></span>' : "") +
          '<span class="cm-mark" style="left:' + (m.threshold / scale * 100).toFixed(1) + '%"></span>' +
        "</span>" +
        '<span class="cm-lab">days</span><span class="cm-dots" title="used on ' + m.days + " distinct days; " + m.requiredDays + ' needed">' + dots + "</span>" +
      "</div>" +
      '<div class="cand-status">' + esc(status) + "</div></div>";
  }).join("");
  const foot = [rule];
  if (s.unused > 0 && s.onTheWay > 0) foot.push(s.unused + " more could get there but haven't been used on a later day yet.");
  if (s.outOfReach > 0) foot.push(outOfReachLine(s));
  return '<h4 class="st-h">' + esc(title) + "</h4>" + rows + '<p class="foot">' + esc(foot.join(" ")) + "</p>";
}

function outOfReachLine(s) {
  const top = s.rule.repCap + s.rule.bonus;
  return s.outOfReach + (s.outOfReach === 1 ? " memory was" : " memories were") +
    " scored too low to get there by use alone (use tops out at " + n2(top) + ").";
}
