/* "Is everything working?" — `counterparts doctor`, as a checklist with lights.

   The reading is the console's own: the page runs `doctor --json` through the
   actions seam (a READ — it writes nothing) and draws its findings, so this
   list and the terminal cannot disagree about what "healthy" means. It runs
   once when the tab first opens; "Check again" runs it again. */
import { act } from "../../../shared/actions.js";
import { $, esc } from "../../../shared/dom.js";

export const markup = `
    <h2>Is everything working? <small>— the same checks as <code>counterparts doctor</code></small></h2>
    <div class="card hc" id="h-checks">
      <div class="hc-sum"><span class="hc-dot hc-grey"></span><span>Checking…</span></div>
    </div>`;

/**
 * Plain names for doctor's lines, by the finding's stable `key`. A key not
 * listed keeps doctor's own title, so a check added next month still shows.
 */
const NAMES = {
  store: "Your memory",
  host: "Connected to Claude Code",
  embedder: "Recall by meaning",
  "crash-write-up": "Session write-ups",
  snapshot: "Snapshots",
  "self-page": "Self page",
  config: "Settings file",
  checkout: "Code version",
  "store-open": "Memory opens",
  spawn: "Background worker",
  clock: "Clock",
  sweep: "Crash sweep",
  sleep: "Sleep",
  backfill: "Meaning index backfill",
  credit: "Recall credit",
  authorship: "Writing its own memories",
  journal: "Database journal",
  vectors: "Meaning vectors",
  retention: "Raw transcripts",
  "page-writer": "Self-page writer",
  "journal-copy": "Journal copy",
  fired: "Mechanisms",
  stance: "Mode",
  budget: "Time budget",
};

/**
 * THE LINES THAT KEEP A ROW OF THEIR OWN however green they are — the
 * terminal's own allowlist (`cli/report.ts#HEADLINE`, read there and restated
 * here because a browser module cannot import it). Every other GREEN line
 * folds into one "Behind the scenes" row that opens to list them; anything
 * amber or red always gets its own row.
 */
const HEADLINE = ["store", "host", "embedder", "crash-write-up", "snapshot", "self-page"];

let state = { running: false };

/** A light for one grade. `off` is an optional feature nobody turned on;
 *  `unasked` is a check this page could not make (no configuration named). */
function dot(grade) {
  return '<span class="hc-dot hc-' + grade + '" role="img" aria-label="' +
    ({ green: "fine", amber: "look at this", red: "broken", grey: "not checked", off: "off" }[grade] || grade) + '"></span>';
}

/** Doctor leads many details with the store's path; the row reads without it. */
function plain(detail) {
  return String(detail || "").replace(/^\/\S+ — /, "").replace(/^\/\S+ /, "");
}

function gradeOf(f) {
  if (f.key === "config" && f.data && f.data.reason === "not-read") return "grey";
  if (f.optional) return "off";
  return f.severity;
}

function row(i, f, grade, name, line) {
  return '<button type="button" class="hc-row" aria-expanded="false" data-i="' + i + '">' + dot(grade) +
    '<span class="hc-name">' + esc(name) + '</span><span class="hc-line">' + esc(line) + "</span></button>" +
    '<div class="hc-more" id="hc-more-' + i + '" hidden></div>';
}

function more(f) {
  return '<div class="hc-detail">' + esc(f.detail) + "</div>" +
    (f.fix ? '<div class="hc-fix"><b>What to do:</b> ' + esc(f.fix) + "</div>" : "") +
    '<div class="hc-key">doctor · ' + esc(f.key) + "</div>";
}

function paintFindings(report, when) {
  const box = $("h-checks");
  const rows = [];
  const details = [];
  const folded = [];
  let look = 0;
  let unasked = 0;
  for (const f of report.findings) {
    const grade = gradeOf(f);
    if (grade === "red" || grade === "amber") look += 1;
    if (grade === "grey") unasked += 1;
    if (grade === "green" && !HEADLINE.includes(f.key)) { folded.push(f); continue; }
    const name = NAMES[f.key] || f.title;
    const line = grade === "grey"
      ? "not checked — this dashboard was opened on a store, not through its settings file"
      : plain(f.detail);
    details.push(f);
    rows.push({ grade, name, line, f, order: HEADLINE.indexOf(f.key) });
  }
  // Worst first, then the headline order the terminal reads in.
  const rank = { red: 0, amber: 1, grey: 2, off: 3, green: 4 };
  rows.sort((a, b) => (rank[a.grade] - rank[b.grade]) || ((a.order < 0 ? 99 : a.order) - (b.order < 0 ? 99 : b.order)));
  const html = rows.map((r, i) => row(i, r.f, r.grade, r.name, r.line));
  const moreHtml = rows.map((r) => more(r.f));
  if (folded.length > 0) {
    const i = rows.length;
    html.push(row(i, null, "green", "Behind the scenes",
      folded.length + " background checks, all fine"));
    moreHtml.push('<ul class="hc-fold">' + folded.map((f) =>
      "<li>" + dot("green") + '<span class="hc-name">' + esc(NAMES[f.key] || f.title) + "</span>" +
      '<span class="hc-detail">' + esc(plain(f.detail)) + "</span></li>").join("") + "</ul>");
  }
  const head = look === 0
    ? dot("green") + '<span class="hc-verdict">All good</span>'
    : dot(report.red > 0 ? "red" : "amber") +
      '<span class="hc-verdict">' + look + (look === 1 ? " thing" : " things") + " to look at</span>";
  const tail = [];
  tail.push(report.findings.length + " checks");
  if (unasked > 0) tail.push(unasked + " not checked");
  box.innerHTML =
    '<div class="hc-sum">' + head + '<span class="hc-sub">' + esc(tail.join(" · ")) + "</span></div>" +
    '<div class="hc-list">' + html.join("") + "</div>" +
    '<div class="hc-foot"><span>Checked ' + esc(when) + '</span>' +
    '<button type="button" class="act-btn hc-again" id="hc-again">Check again</button></div>';
  box.querySelectorAll(".hc-row").forEach((b) => {
    b.onclick = () => {
      const i = Number(b.dataset.i);
      const panel = $("hc-more-" + i);
      const open = panel.hidden;
      if (open && !panel.innerHTML) panel.innerHTML = moreHtml[i];
      panel.hidden = !open;
      b.setAttribute("aria-expanded", open ? "true" : "false");
    };
  });
  $("hc-again").onclick = run;
}

function paintProblem(message) {
  $("h-checks").innerHTML =
    '<div class="hc-sum">' + dot("grey") + '<span class="hc-verdict">Could not check</span></div>' +
    '<div class="hc-problem">' + esc(message) + "</div>" +
    '<div class="hc-foot"><span></span><button type="button" class="act-btn hc-again" id="hc-again">Try again</button></div>';
  $("hc-again").onclick = run;
}

/** Run `doctor --json` through the seam and draw what it said. */
export async function run() {
  if (state.running) return;
  state.running = true;
  const again = document.getElementById("hc-again");
  if (again) { again.disabled = true; again.textContent = "Checking…"; }
  try {
    const r = await act("doctor", {});
    if (r.error && !r.out) return paintProblem(r.error);
    let report = null;
    try { report = JSON.parse((r.out || []).join("\n")); } catch (e) { report = null; }
    if (!report || !Array.isArray(report.findings)) {
      return paintProblem((r.err && r.err.length ? r.err.join(" ") : r.error) || "doctor gave no reading.");
    }
    const now = new Date();
    paintFindings(report, now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }));
  } finally {
    state.running = false;
  }
}
