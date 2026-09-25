/* How I changed my mind — every credited challenge, in the order it landed. */
import { absenceLine } from "../../../shared/absence.js";
import { $, esc } from "../../../shared/dom.js";
import { n3, pct } from "../../../shared/format.js";

export const markup = `
    <h2>How I changed my mind <small>— every credited challenge, in the order it landed</small></h2>
    <div id="mind-stories"></div>`;

export function paint(d) {
  $("mind-stories").innerHTML = d.storiesAbsent
    ? absenceLine(d.storiesAbsent, "no belief of mine has taken a single credited challenge") +
      '<p class="foot">That is a real answer, not an empty panel: a store with no contested belief has never had one, and this line is how I say so.</p>'
    : d.stories.map(storyCard).join("");
}

export function storyCard(s) {
  const beats = s.beatsAbsent
    ? '<div class="foot">' + esc(s.beatsAbsent) + "</div>"
    : s.beats.map((b) =>
        '<div class="beat' + (b.crossed ? " crossed" : "") + '">' +
          '<div class="day">day ' + b.day + "</div>" +
          '<div class="who">' + esc(b.challenger) + "<em>force " + n3(b.force) + "</em></div>" +
          "<div><div class='track'><span class='fill' style='display:block;width:" + pct(Math.min(1, b.fraction)) +
            "%'></span><span class='barline' style='left:" + pct(Math.min(1, 1 / Math.max(b.fraction || 1, 1))) + "%'></span></div>" +
            // The numbers first, then the clause they mean. "0.598 of 0.470"
            // beside the bare word REVISED read as a numerator larger than its
            // denominator with nothing saying that IS what clearing looks like.
            "<div class='verdict'>pressure " + n3(b.pressureAfter) + " against a bar of " + n3(b.bar) +
              " — " + esc(b.verdict) + "</div>" +
            (b.became
              ? "<div class='verdict became'" + (b.becameId ? " onclick=\"openMemory('" + b.becameId + "')\"" : "") +
                ">it became: " + esc(b.became) + "</div>"
              : "") +
          "</div>" +
        "</div>"
      ).join("");
  // The two ends are shown around the point they DIVERGE, so a revision that
  // kept most of its sentence still reads as a revision. The whole statement is
  // one hover (or one click) away.
  const said = (label, text, full, id, style) =>
    '<div class="said"><span class="k">' + label + "</span>" +
    '<span class="stmt' + (id ? " click" : "") + '" title="' + esc(full) + '"' +
    (id ? " onclick=\"openMemory('" + id + "')\"" : "") + (style ? ' style="' + style + '"' : "") + ">" +
    esc(text) + "</span></div>";
  return '<div class="story">' +
    '<div class="about">about ' + esc(s.about) + "</div>" +
    said("it began as", s.began, s.beganFull, s.id, "") +
    (s.revised
      ? said("it now says", s.now, s.nowFull, s.headId, "color:var(--amber)")
      : said("it now says", s.now + " — nothing has revised it", s.nowFull, s.headId, "")) +
    '<div class="said"><span class="k">pressure now</span>' +
      (s.pressure === 0
        ? '<span style="color:var(--dim)">(none yet) — ' + (s.revised ? "the revision reset it; the successor starts clean" : "it has decayed, or was never credited") + "</span>"
        : n3(s.pressure) + " against a bar of " + n3(s.bar)) + "</div>" +
    "<div style='margin-top:10px'>" + beats + "</div></div>";
}
