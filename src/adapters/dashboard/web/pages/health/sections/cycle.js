/* The last sleep cycle, as one line with a dot per step. */
import { $, esc } from "../../../shared/dom.js";

export const markup = `
    <div class="card pad hcy" id="h-cycle"></div>`;

function sameLocalDay(ms) {
  const a = new Date(ms);
  const b = new Date();
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function when(c) {
  if (c.at !== null && sameLocalDay(c.at)) return "today";
  if (c.at !== null) {
    const d = new Date(c.at);
    return "on " + d.toLocaleDateString([], { month: "short", day: "numeric" }) + " (lived day " + c.day + ")";
  }
  return "on lived day " + c.day;
}

const WORD = { ran: "finished in the last cycle", behind: "behind — last finished on lived day ", never: "has never run", torn: "its marker is unreadable" };

export function paint(d) {
  const c = d.cycle;
  const dots = c.phases.map((p) => {
    const tone = p.state === "ran" ? "green" : p.state === "never" && c.day === null ? "grey" : "amber";
    const said = p.state === "behind" ? WORD.behind + p.day : WORD[p.state];
    const title = p.phase + " — " + p.gloss + " (" + said + ")";
    return '<span class="hcy-dot hc-dot hc-' + tone + '" title="' + esc(title) + '" role="img" aria-label="' + esc(title) + '"></span>';
  }).join("");
  let line;
  if (c.day === null) line = "Sleep hasn't run yet — it runs after a session ends";
  else if (c.ran === c.total) line = "Sleep last ran " + when(c) + ": all " + c.total + " steps";
  else line = "Sleep last ran " + when(c) + ": " + c.ran + " of " + c.total + " steps finished";
  $("h-cycle").innerHTML = '<span class="hcy-line">' + esc(line) + '</span><span class="hcy-dots">' + dots + "</span>";
}
