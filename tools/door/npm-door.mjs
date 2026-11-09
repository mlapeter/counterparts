#!/usr/bin/env node
/**
 * THE NPM DOOR, end to end, on whatever machine runs it: native Windows, WSL,
 * Linux or macOS (W1, 2026-11-09). Plain Node, no dependencies, no bun.
 *
 * It does what a stranger does, from the packed tarball, in a throwaway home:
 *
 *   1. `npm install -g <tarball>` into a temp npm prefix;
 *   2. `counterparts --version` from every shell a person types it in (on
 *      Windows: PowerShell, cmd and Git Bash; elsewhere sh);
 *   3. installs Claude Code itself from npm into the same prefix (so on
 *      Windows `claude` is npm's `claude.cmd`, the hard case), then
 *      `counterparts install` and `counterparts connect` against a temp
 *      `~/.claude` and `~/.claude.json` in that temp home, typed in PowerShell on Windows;
 *   4. `claude mcp list`: Claude Code itself starts the registered server and
 *      reports it connected;
 *   5. one hook round, SessionStart → UserPromptSubmit → Stop, each the
 *      command `connect` wrote, run the way Claude Code runs it (Git Bash on
 *      Windows, and SessionStart in PowerShell too, the fallback when Git Bash
 *      is not installed; `sh -c` elsewhere);
 *   6. a memory written through the registered MCP server, recalled through it
 *      and from the console; then the background worker's log, `doctor`, and
 *      what the night did (with no Claude login it cannot finish, so this
 *      checks it started and reached `claude`).
 *
 * Usage: node tools/door/npm-door.mjs <counterparts-x.y.z.tgz> [workdir]
 * The workdir must be outside the real home (default: under the OS temp, or
 * $RUNNER_TEMP). Nothing here reads or writes the real home's ~/.counterparts
 * or ~/.claude: HOME and USERPROFILE point into the workdir, CLAUDE_CONFIG_DIR is
 * dropped, and the run refuses an inherited COUNTERPARTS_DATA_DIR.
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, join, resolve, sep } from "node:path";

const WIN = process.platform === "win32";
const positional = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const tarball = positional[0] ? resolve(positional[0]) : "";
if (!tarball || !existsSync(tarball)) {
  console.error("usage: node tools/door/npm-door.mjs <counterparts-x.y.z.tgz> [workdir]");
  process.exit(2);
}
const version = /counterparts-(\d+\.\d+\.\d+[^/\\]*)\.tgz$/.exec(basename(tarball))?.[1] ?? "";

// ── the guard ────────────────────────────────────────────────────────────────
const realHome = homedir();
const work = resolve(positional[1] ?? join(process.env.RUNNER_TEMP ?? tmpdir(), `npm-door-${process.pid}`));
const inside = (child, parent) => {
  const c = (WIN ? child.toLowerCase() : child) + sep;
  const p = (WIN ? parent.toLowerCase() : parent) + sep;
  return c.startsWith(p);
};
if (inside(work, realHome)) {
  console.error(`REFUSED: the workdir (${work}) is inside the real home (${realHome}).`);
  process.exit(1);
}
if ((process.env.COUNTERPARTS_DATA_DIR ?? "").length > 0 || (process.env.COUNTERPARTS_CONFIG ?? "").length > 0) {
  console.error("REFUSED: COUNTERPARTS_DATA_DIR or COUNTERPARTS_CONFIG is inherited.");
  process.exit(1);
}
rmSync(work, { recursive: true, force: true });
mkdirSync(work, { recursive: true });
const WORK = realpathSync(work);
if (inside(WORK, realHome)) {
  console.error(`REFUSED: the workdir resolves inside the real home (${WORK}).`);
  process.exit(1);
}

const HOME = join(WORK, "home");
// Claude Code's own files where a stranger has them: ~/.claude/settings.json
// and ~/.claude.json, in the temp home (no CLAUDE_CONFIG_DIR).
const CLAUDE_DIR = join(HOME, ".claude");
const PREFIX = join(WORK, "npm-global");
const PROJECT = join(WORK, "project");
for (const d of [HOME, CLAUDE_DIR, PREFIX, PROJECT]) mkdirSync(d, { recursive: true });
const BIN_DIR = WIN ? PREFIX : join(PREFIX, "bin");

// The environment every step runs in: the stranger's, in the temp home.
const env = { ...process.env };
for (const k of Object.keys(env)) {
  if (/^COUNTERPARTS_/.test(k) || /^npm_/i.test(k) || k === "CLAUDE_CONFIG_DIR") delete env[k];
}
const pathKey = Object.keys(env).find((k) => k.toUpperCase() === "PATH") ?? "PATH";
env[pathKey] = `${BIN_DIR}${WIN ? ";" : ":"}${env[pathKey] ?? ""}`;
Object.assign(env, {
  HOME,
  npm_config_prefix: PREFIX,
  npm_config_update_notifier: "false",
  npm_config_fund: "false",
  npm_config_audit: "false",
  COUNTERPARTS_UPDATE_CHECK: "off",
  DISABLE_AUTOUPDATER: "1",
  CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
});
if (WIN) env.USERPROFILE = HOME;

// ── plumbing ─────────────────────────────────────────────────────────────────
let passed = 0;
let failed = 0;
const ok = (what) => {
  passed += 1;
  console.log(`PASS  ${what}`);
};
const no = (what, detail = "") => {
  failed += 1;
  console.log(`FAIL  ${what}`);
  if (detail) for (const line of String(detail).split(/\r?\n/).slice(0, 40)) console.log(`      ${line}`);
};
const note = (what) => console.log(`NOTE  ${what}`);
const show = (label, text) => {
  console.log(`----- ${label}`);
  for (const line of String(text).split(/\r?\n/).slice(0, 80)) console.log(`  ${line}`);
};

/** Run a line in a shell, as a person types it: `pwsh`/`powershell`, `cmd`,
 *  `bash` (Git Bash on Windows) or `sh`. */
const GIT_BASH = WIN
  ? ["C:\\Program Files\\Git\\bin\\bash.exe", "C:\\Program Files (x86)\\Git\\bin\\bash.exe"].find((p) => existsSync(p))
  : undefined;
function shell(kind, line, opts = {}) {
  const common = { env, cwd: opts.cwd ?? PROJECT, encoding: "utf8", input: opts.input ?? "", timeout: opts.timeout ?? 120_000, windowsHide: true };
  let res;
  if (kind === "powershell") {
    res = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", line], common);
  } else if (kind === "cmd") {
    res = spawnSync(process.env.ComSpec ?? "cmd.exe", ["/d", "/s", "/c", `"${line}"`], { ...common, windowsVerbatimArguments: true });
  } else if (kind === "bash") {
    res = spawnSync(GIT_BASH ?? "bash", ["-c", line], common);
  } else {
    res = spawnSync("sh", ["-c", line], common);
  }
  return { code: res.status, out: res.stdout ?? "", err: res.stderr ?? "", error: res.error };
}
/** The shell a person types `counterparts …` in. */
const TERMINAL = WIN ? "powershell" : "sh";

console.log(`tarball   ${tarball}`);
console.log(`version   ${version}`);
console.log(`work      ${WORK}`);
console.log(`node      ${process.version} (${process.platform} ${process.arch})`);
if (WIN) console.log(`git bash  ${GIT_BASH ?? "(none)"}`);
console.log("");

// ── 1. npm install -g ─────────────────────────────────────────────────────────
{
  const r = shell(TERMINAL, `npm install -g "${tarball}"`, { timeout: 300_000 });
  if (r.code === 0) ok("npm install -g <tarball>");
  else {
    no(`npm install -g (exit ${r.code})`, `${r.out}\n${r.err}`);
    finish();
  }
  const names = readdirSync(BIN_DIR).filter((n) => n.startsWith("counterparts"));
  note(`bin dir holds: ${names.join(" ")}`);
  if (WIN) {
    const cmd = readFileSync(join(BIN_DIR, "counterparts.cmd"), "utf8");
    if (/\/bin\/sh/.test(cmd)) no("counterparts.cmd still runs /bin/sh (the postinstall did not adjust it)", cmd);
    else ok("counterparts.cmd runs node, not /bin/sh");
  }
}

// ── 2. the console answers, from every shell ──────────────────────────────────
for (const kind of WIN ? ["powershell", "cmd", "bash"] : ["sh"]) {
  if (kind === "bash" && GIT_BASH === undefined) {
    note("no Git Bash on this machine; skipped it");
    continue;
  }
  const r = shell(kind, "counterparts --version");
  const said = r.out.trim();
  if (r.code === 0 && said === `counterparts ${version}`) ok(`${kind}: counterparts --version → ${said}`);
  else no(`${kind}: counterparts --version (exit ${r.code})`, `${r.out}\n${r.err}`);
}

// ── 3. Claude Code, then install + connect ────────────────────────────────────
{
  const r = shell(TERMINAL, "npm install -g @anthropic-ai/claude-code", { timeout: 300_000 });
  if (r.code !== 0) no(`npm install -g @anthropic-ai/claude-code (exit ${r.code})`, `${r.out}\n${r.err}`);
  const v = shell(TERMINAL, "claude --version", { timeout: 60_000 });
  if (v.code === 0) ok(`Claude Code is here: ${v.out.trim()}`);
  else no(`claude --version (exit ${v.code})`, `${v.out}\n${v.err}`);
  if (WIN) note(`claude on PATH: ${readdirSync(BIN_DIR).filter((n) => /^claude/i.test(n)).join(" ")}`);
}
{
  const r = shell(TERMINAL, 'counterparts install --budget 9000 --name "Door Test"');
  if (r.code === 0) ok("counterparts install --budget 9000 --name …");
  else no(`counterparts install (exit ${r.code})`, `${r.out}\n${r.err}`);
  const c = shell(TERMINAL, "counterparts connect");
  show("counterparts connect", `${c.out}${c.err}`);
  if (c.code === 0) ok("counterparts connect exit 0");
  else no(`counterparts connect (exit ${c.code})`);
}

// ── what connect wrote ───────────────────────────────────────────────────────
const settingsFile = join(CLAUDE_DIR, "settings.json");
const mcpFile = join(HOME, ".claude.json");
let hooks = {};
let server = null;
try {
  hooks = JSON.parse(readFileSync(settingsFile, "utf8")).hooks ?? {};
  const events = Object.keys(hooks);
  if (events.length >= 5) ok(`settings.json carries hooks for ${events.join(", ")}`);
  else no(`settings.json carries ${events.length} hook events`, readFileSync(settingsFile, "utf8"));
} catch (e) {
  no(`no readable ${settingsFile}`, String(e));
}
const hookCommand = (event) => hooks[event]?.[0]?.hooks?.[0]?.command;
show("the SessionStart hook command", hookCommand("SessionStart") ?? "(none)");
try {
  server = JSON.parse(readFileSync(mcpFile, "utf8")).mcpServers?.counterparts ?? null;
  if (server !== null) ok("the counterparts MCP server is registered (user scope)");
  else no(`no counterparts server in ${mcpFile}`);
  show("the MCP registration", JSON.stringify(server, null, 2));
} catch (e) {
  no(`no readable ${mcpFile}`, String(e));
}

// ── 4. Claude Code starts the server itself ──────────────────────────────────
{
  const r = shell(TERMINAL, "claude mcp list", { timeout: 120_000 });
  show("claude mcp list", `${r.out}${r.err}`);
  const line = `${r.out}\n${r.err}`.split(/\r?\n/).find((l) => /^counterparts\b/.test(l.trim())) ?? "";
  if (/connected/i.test(line) && !/failed|not connected/i.test(line)) ok("claude mcp list: counterparts connected");
  else no("claude mcp list did not report counterparts connected", line || r.out);
}

// ── 5. one hook round, run as Claude Code runs it ────────────────────────────
const SESSION = `door-${process.pid}`;
const transcript = join(PROJECT, "transcript.jsonl");
writeFileSync(
  transcript,
  [
    { type: "user", message: { role: "user", content: "Our espresso machine is a Rancilio Silvia; keep that in mind." }, sessionId: SESSION, cwd: PROJECT, timestamp: new Date().toISOString() },
    { type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "Noted: a Rancilio Silvia." }] }, sessionId: SESSION, cwd: PROJECT, timestamp: new Date().toISOString() },
  ].map((l) => JSON.stringify(l)).join("\n") + "\n",
);
const payload = (event, extra = {}) =>
  JSON.stringify({ hook_event_name: event, session_id: SESSION, cwd: PROJECT, transcript_path: transcript, ...extra });
const hookShell = WIN ? (GIT_BASH ? "bash" : "powershell") : "sh";
function runHook(event, kind, extra) {
  const command = hookCommand(event);
  if (command === undefined) {
    no(`${event}: no hook command was written`);
    return null;
  }
  const r = shell(kind, command, { input: payload(event, extra), timeout: 60_000 });
  if (r.code === 0) ok(`${event} hook, in ${kind}: exit 0, ${r.out.length} bytes out`);
  else no(`${event} hook, in ${kind} (exit ${r.code})`, `${r.out}\n${r.err}`);
  if (r.err.trim().length > 0) show(`${event} stderr`, r.err);
  return r;
}
{
  const start = runHook("SessionStart", hookShell, { source: "startup" });
  if (start !== null && start.out.trim().length > 0) ok("SessionStart returned a wake");
  else if (start !== null) no("SessionStart returned nothing", start.err);
  if (start !== null) show("the wake (head)", start.out.slice(0, 1200));
  if (WIN) {
    // Without Git Bash, Claude Code runs the same line in PowerShell.
    const again = runHook("SessionStart", "powershell", { source: "resume" });
    if (again !== null && again.out.trim().length > 0) ok("SessionStart in PowerShell returned a wake too");
  }
  runHook("UserPromptSubmit", hookShell, { prompt: "what espresso machine do we have?" });
  runHook("Stop", hookShell, { stop_hook_active: false });
}

// ── 6. a memory, through the server Claude Code would start ──────────────────
function mcpRound(requests) {
  return new Promise((done) => {
    if (server === null) return done("");
    const child = spawn(server.command, server.args ?? [], {
      env: { ...env, ...(server.env ?? {}) },
      cwd: PROJECT,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    let out = "";
    let err = "";
    child.stdout.on("data", (b) => (out += b));
    child.stderr.on("data", (b) => (err += b));
    child.on("error", (e) => done(`spawn error: ${e.message}`));
    const lines = [
      { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "npm-door", version: "1" } } },
      { jsonrpc: "2.0", method: "notifications/initialized" },
      ...requests,
    ];
    for (const l of lines) child.stdin.write(`${JSON.stringify(l)}\n`);
    const want = requests.filter((r) => r.id !== undefined).length + 1;
    const timer = setTimeout(() => finishRound(), 60_000);
    const check = setInterval(() => {
      if (out.split("\n").filter((l) => l.includes('"id"')).length >= want) finishRound();
    }, 200);
    function finishRound() {
      clearTimeout(timer);
      clearInterval(check);
      child.stdin.end();
      setTimeout(() => {
        try {
          child.kill();
        } catch {}
        done(out + (err ? `\n[stderr]\n${err}` : ""));
      }, 500);
    }
  });
}
{
  const out = await mcpRound([
    { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "remember", arguments: { text: "The kitchen's espresso machine is a Rancilio Silvia, bought in 2019." } } },
    // Two more, so the next day has enough new for a night (dream MIN_NEW is 3).
    { jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "remember", arguments: { text: "Door Test's bicycle is a green Surly Cross-Check, ridden to work on Fridays." } } },
    { jsonrpc: "2.0", id: 6, method: "tools/call", params: { name: "remember", arguments: { text: "The garden's tomatoes are Sungold, planted along the south fence in May." } } },
  ]);
  if (/"id":2/.test(out) && !/"isError":true/.test(out)) ok("mcp: remember landed");
  else no("mcp: remember", out);
  const back = await mcpRound([
    { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "recall", arguments: { question: "which coffee maker do we own?", mode: "facts" } } },
  ]);
  if (/Rancilio Silvia/.test(back)) ok("mcp: recall by meaning found it (a new server process, so it was written to disk)");
  else no("mcp: recall did not find it", back);
  const r = shell(TERMINAL, 'counterparts recall "what espresso machine is in the kitchen?"');
  if (/Rancilio Silvia/.test(r.out)) ok("console: counterparts recall found it");
  else no(`console: counterparts recall (exit ${r.code})`, `${r.out}\n${r.err}`);
}

// ── the worker the hooks started ─────────────────────────────────────────────
{
  const logDir = join(HOME, ".counterparts", "store", "sessions", "log");
  let worker = 0;
  let ran = 0;
  for (let i = 0; i < 60 && ran === 0; i += 1) {
    const text = existsSync(logDir) ? readdirSync(logDir).map((f) => readFileSync(join(logDir, f), "utf8")).join("\n") : "";
    const lines = text.split("\n").filter((l) => l.includes('"proc":"worker"'));
    worker = lines.length;
    ran = lines.filter((l) => l.includes('"name":"process.end"') && l.includes('"reason":"ran"')).length;
    if (ran === 0) await new Promise((r) => setTimeout(r, 1000));
  }
  if (ran > 0) ok(`the hooks' background worker ran (${ran} runs ended "ran", ${worker} log lines)`);
  else no(`no background worker run in ${logDir}`, existsSync(logDir) ? readdirSync(logDir).join(" ") : "(no log dir)");
  const all = existsSync(logDir) ? readdirSync(logDir).map((f) => readFileSync(join(logDir, f), "utf8")).join("\n") : "";
  const night = all.split("\n").filter((l) => /night/i.test(l)).slice(-12);
  show("what the logs say about the night", night.join("\n") || "(nothing)");
}

// ── doctor, and the night ────────────────────────────────────────────────────
{
  const r = shell(TERMINAL, "counterparts doctor", { timeout: 180_000 });
  show(`counterparts doctor (exit ${r.code})`, `${r.out}${r.err}`);
  if (r.code === 0) ok("counterparts doctor exit 0");
  else no(`counterparts doctor (exit ${r.code})`);
  const reds = r.out.split(/\r?\n/).filter((l) => /^\s*RED\b/.test(l));
  if (reds.length === 0) ok("doctor: nothing red");
  else no("doctor: red lines", reds.join("\n"));
  const n = shell(TERMINAL, "counterparts night", { timeout: 60_000 });
  show(`counterparts night (exit ${n.code})`, `${n.out}${n.err}`);
}

// ── the night, on a CI runner whose clock may be moved ───────────────────────
// The night starts with the first session of a LATER day. With
// `--advance-clock` (CI's Windows job only: it moves the runner's system clock,
// which is nobody's machine) the clock goes forward a day, a new session
// starts, and the night must start in the background and get as far as
// starting `claude -p` — which, with no Claude login on the runner, ends there.
// Only on CI (`CI=true`): never a person's own clock, whatever flag is passed.
// Not in WSL: its clock follows the host's and a `date -s` there did not hold.
const CAN_MOVE_CLOCK = process.env.CI === "true" && WIN;
if (process.argv.includes("--advance-clock") && CAN_MOVE_CLOCK) {
  const moved = shell("powershell", "Set-Date (Get-Date).AddDays(1) | Out-Null");
  if (moved.code !== 0) no("could not move the clock forward", moved.err);
  else {
    try {
      runHook("SessionEnd", hookShell, { reason: "logout" });
      const next = `${SESSION}-next`;
      const command = hookCommand("SessionStart");
      const r = shell(hookShell, command, { input: JSON.stringify({ hook_event_name: "SessionStart", session_id: next, cwd: PROJECT, transcript_path: transcript, source: "startup" }), timeout: 60_000 });
      if (r.code === 0) ok(`the next day's SessionStart: exit 0, ${r.out.length} bytes out`);
      else no(`the next day's SessionStart (exit ${r.code})`, r.err);
      show("the next day's wake (head)", r.out.slice(0, 1500));
      // The night is offered on the day's first PROMPT, not in the wake (`hooks.ts#dreamLines`).
      const prompt = shell(hookShell, hookCommand("UserPromptSubmit"), { input: JSON.stringify({ hook_event_name: "UserPromptSubmit", session_id: next, cwd: PROJECT, transcript_path: transcript, prompt: "good morning" }), timeout: 60_000 });
      if (prompt.code === 0) ok(`the next day's first prompt: exit 0, ${prompt.out.length} bytes out`);
      else no(`the next day's first prompt (exit ${prompt.code})`, prompt.err);
      show("the next day's first prompt's output", prompt.out.slice(0, 1500));
      const logDir = join(HOME, ".counterparts", "store", "sessions", "log");
      let lines = [];
      for (let i = 0; i < 90; i += 1) {
        const text = existsSync(logDir) ? readdirSync(logDir).map((f) => readFileSync(join(logDir, f), "utf8")).join("\n") : "";
        lines = text.split("\n").filter((l) => l.includes('"proc":"nightly"'));
        if (lines.some((l) => l.includes('"name":"process.end"'))) break;
        await new Promise((res) => setTimeout(res, 1000));
      }
      show("the nightly process's log", lines.join("\n") || "(nothing)");
      {
        const text = existsSync(logDir) ? readdirSync(logDir).map((f) => readFileSync(join(logDir, f), "utf8")).join("\n") : "";
        show("the hooks' night and dream lines", text.split("\n").filter((l) => /night|dream/i.test(l) && !l.includes('"proc":"nightly"')).slice(-15).join("\n") || "(nothing)");
      }
      if (lines.length > 0) ok("the night started in the background");
      else no("no nightly process logged anything");
      if (lines.some((l) => /ENOENT|EINVAL|spawn\.failed/.test(l))) no("the night could not start claude", lines.filter((l) => /ENOENT|EINVAL|spawn/.test(l)).join("\n"));
      else if (lines.length > 0) ok("the night's claude -p was started (no ENOENT/EINVAL)");
      const n = shell(TERMINAL, "counterparts night", { timeout: 60_000 });
      show(`counterparts night, the next day (exit ${n.code})`, `${n.out}${n.err}`);
    } finally {
      shell("powershell", "Set-Date (Get-Date).AddDays(-1) | Out-Null");
    }
  }
}

finish();

function finish() {
  console.log("");
  console.log(`${passed} passed, ${failed} failed`);
  if (!process.env.KEEP) {
    try {
      rmSync(WORK, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
    } catch (e) {
      console.log(`NOTE  could not remove ${WORK}: ${e.message}`);
    }
  } else console.log(`kept ${WORK}`);
  process.exit(failed === 0 ? 0 : 1);
}
