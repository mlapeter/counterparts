/**
 * THE CLAUDE.AI TRIAL SCRIPT (`tools/trials/claude-ai/trial.sh`), run as a
 * process (review of #634): its refusal of a live store as the disk resolves
 * it, `check`'s throwaway call log, `night`'s URL kept off claude's command
 * line, and the server and the tunnel stopping together.
 *
 * Hermetic (CLAUDE.md): a temp HOME of the test's own, so its `.counterparts`
 * stands for the owner's; a fake `cloudflared` on PATH that opens no tunnel;
 * nothing reaches the network.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { spawn } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SCRIPT = join(import.meta.dir, "..", "tools", "trials", "claude-ai", "trial.sh");

let root: string;
let home: string;
let bin: string;

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "counterparts-trial-script-")));
  home = join(root, "home");
  bin = join(root, "bin");
  mkdirSync(join(home, ".counterparts"), { recursive: true });
  mkdirSync(bin);
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

/** A fake cloudflared: writes its pid, prints a quick-tunnel line, then lives `seconds` (the same pid). */
function fakeTunnel(seconds: number): string {
  const pidFile = join(root, "tunnel.pid");
  const path = join(bin, "cloudflared");
  writeFileSync(path, `#!/bin/bash\necho $$ > '${pidFile}'\necho "INF |  https://fake-name.trycloudflare.com  |" >&2\nexec sleep ${String(seconds)}\n`);
  chmodSync(path, 0o755);
  return pidFile;
}

interface Run {
  code: number | null;
  out: string;
  err: string;
}

function run(args: string[], opts: { onOut?: (out: string) => void; timeoutMs?: number } = {}): Promise<Run> {
  return new Promise((resolveRun) => {
    const child = spawn("/bin/bash", [SCRIPT, ...args], {
      env: { PATH: `${bin}:${process.env["PATH"] ?? ""}`, HOME: home, BUN: process.execPath, COUNTERPARTS_REQUIRE_EXPLICIT_DIR: "1" },
      stdio: ["ignore", "pipe", "pipe"],
      // Its own process group, so a run that hangs is stopped whole — the
      // server and the fake tunnel with it — and leaves nothing behind.
      detached: true,
    });
    let out = "";
    let err = "";
    child.stdout.on("data", (d: Buffer) => {
      out += d.toString();
      opts.onOut?.(out);
    });
    child.stderr.on("data", (d: Buffer) => {
      err += d.toString();
    });
    const timer = setTimeout(() => {
      try {
        process.kill(-(child.pid as number), "SIGKILL");
      } catch {
        /* already gone */
      }
    }, opts.timeoutMs ?? 30_000);
    child.on("close", (code) => {
      clearTimeout(timer);
      resolveRun({ code, out, err });
    });
  });
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

describe("trial.sh refuses a live store before it writes anything", () => {
  test("a symlink into ~/.counterparts is refused, and nothing lands there", async () => {
    symlinkSync(join(home, ".counterparts"), join(home, "trial-link"));
    const out = await run(["check", "--dir", join(home, "trial-link", "claude-ai")]);
    expect(out.code).toBe(1);
    expect(out.err).toContain("refused");
    expect(readdirSync(join(home, ".counterparts"))).toEqual([]);
  });

  test("a '..' in the directory is refused outright", async () => {
    const out = await run(["check", "--dir", `${home}/elsewhere/../.counterparts`]);
    expect(out.code).toBe(1);
    expect(out.err).toContain("without '.' or '..'");
    expect(readdirSync(join(home, ".counterparts"))).toEqual([]);
    expect(existsSync(join(home, "elsewhere"))).toBe(false);
  });
});

describe("trial.sh's commands", () => {
  test("check proves the door on a trial store and leaves the trial's call log untouched", async () => {
    const dir = join(home, "counterparts-trials", "claude-ai");
    const out = await run(["check", "--dir", dir]);
    expect({ code: out.code, err: out.err }).toMatchObject({ code: 0 });
    expect(out.out).toContain("check: passed");
    expect(existsSync(join(dir, "calls.jsonl"))).toBe(false);
    expect(existsSync(join(dir, "server.pid"))).toBe(false);
  }, 60_000);

  test("night keeps the server's URL off claude's command line", async () => {
    const secret = "S3cretSegmentForTheTestOnly_0123456789";
    const out = await run(["night", `http://127.0.0.1:1/${secret}`, "--dry-run", "--dir", join(root, "t")]);
    expect(out.code).toBe(0);
    expect(out.out).toContain("--mcp-config");
    expect(out.out).toContain("<a 0600 file naming the local url>");
    expect(out.out).not.toContain(secret);
  });
});

describe("trial.sh stops the server and the tunnel together", () => {
  test("a tunnel that stops takes the server with it", async () => {
    const pidFile = fakeTunnel(2);
    let localUrl = "";
    const out = await run(["start", "--dir", join(root, "t")], {
      onOut: (o) => {
        localUrl = /trial\.sh night (http:\/\/127\.0\.0\.1:\d+\/\S+)/.exec(o)?.[1] ?? localUrl;
      },
    });
    expect(out.code).toBe(1);
    expect(out.err).toContain("the tunnel stopped");
    expect(out.out).toContain("https://fake-name.trycloudflare.com/");
    expect(localUrl).not.toBe("");
    expect(existsSync(pidFile)).toBe(true);
    const after = await fetch(localUrl, { method: "POST", body: "{}" }).then(
      () => "answered",
      () => "refused",
    );
    expect(after).toBe("refused");
  }, 60_000);

  test("a server that dies takes the tunnel with it", async () => {
    const pidFile = fakeTunnel(600);
    const dir = join(root, "t");
    let killed = false;
    const out = await run(["start", "--dir", dir], {
      onOut: (o) => {
        if (!killed && o.includes("Running.")) {
          killed = true;
          process.kill(Number(readFileSync(join(dir, "server.pid"), "utf8").trim()), "SIGKILL");
        }
      },
    });
    expect(killed).toBe(true);
    expect(out.code).toBe(0);
    const tunnelPid = Number(readFileSync(pidFile, "utf8").trim());
    await new Promise((r) => setTimeout(r, 300));
    expect(alive(tunnelPid)).toBe(false);
  }, 60_000);
});

describe("the night prompt, v2 (OL1b)", () => {
  test("keeps the share for the next chat, keeps notices in the run, and ends with the step list alone", async () => {
    const out = await run(["prompt", "--dir", join(root, "t")]);
    expect(out.code).toBe(0);
    const prompt = out.out.trim();
    expect(prompt).toContain('phase "launch"');
    expect(prompt).toContain("it is for my next chat, so do not tell it here and do not mark it told");
    expect(prompt).toContain("Do not pass on Counterparts' own notices");
    expect(prompt).toContain("reply with only a short list of the steps");
    expect(prompt.endsWith("Do not quote any memory in that list.")).toBe(true);
  });
});
