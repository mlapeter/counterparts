/**
 * `tools/deploy-checkout.sh` — the one move that makes a merge live (I36):
 * detach the shared checkout at origin/master, refusing everything that is
 * not that. Hermetic: a bare "origin" and a clone per test in a temp dir.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SCRIPT = join(import.meta.dir, "..", "tools", "deploy-checkout.sh");

let root: string;
let origin: string;
let repo: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "counterparts-deploy-"));
  origin = join(root, "origin.git");
  repo = join(root, "shared");
  git(root, "init", "-q", "--bare", "-b", "master", origin);
  git(root, "clone", "-q", origin, repo);
  git(repo, "config", "user.email", "t@example.com");
  git(repo, "config", "user.name", "t");
  commit(repo, "one");
  git(repo, "push", "-q", "origin", "master");
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function git(cwd: string, ...args: string[]): string {
  const r = Bun.spawnSync(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe" });
  if (r.exitCode !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr.toString()}`);
  return r.stdout.toString().trim();
}
let n = 0;
function commit(cwd: string, name: string): string {
  writeFileSync(join(cwd, `${name}.txt`), `${name} ${n++}\n`);
  git(cwd, "add", "-A");
  git(cwd, "commit", "-q", "-m", name);
  return git(cwd, "rev-parse", "HEAD");
}
/** A second clone that pushes to origin, so the shared checkout falls behind. */
function advanceOrigin(): string {
  const other = join(root, "other");
  git(root, "clone", "-q", origin, other);
  git(other, "config", "user.email", "t@example.com");
  git(other, "config", "user.name", "t");
  const sha = commit(other, "two");
  git(other, "push", "-q", "origin", "master");
  return sha;
}
function deploy(...args: string[]): { code: number; out: string; err: string } {
  const r = Bun.spawnSync(["bash", SCRIPT, "--repo", repo, ...args], { stdout: "pipe", stderr: "pipe", env: { ...process.env, HOME: root } });
  return { code: r.exitCode, out: r.stdout.toString().trim(), err: r.stderr.toString().trim() };
}
const head = () => git(repo, "rev-parse", "HEAD");
const onBranch = () => Bun.spawnSync(["git", "symbolic-ref", "-q", "HEAD"], { cwd: repo }).exitCode === 0;

describe("tools/deploy-checkout.sh", () => {
  test("behind origin/master: moves, detaches, last line is the sha for the restart reason", () => {
    const was = head();
    const target = advanceOrigin();
    const r = deploy();
    expect(r.code).toBe(0);
    expect(r.out.split("\n").at(-1)).toBe(`deployed ${target} (was ${was})`);
    expect(head()).toBe(target);
    expect(onBranch()).toBe(false);
    expect(r.err).toContain("is 1 behind, 0 ahead");
  });

  test("already at origin/master: no-op on a detached HEAD, exit 0", () => {
    git(repo, "checkout", "-q", "--detach", "origin/master");
    const r = deploy();
    expect(r.code).toBe(0);
    expect(r.out).toBe(`already-at ${head()}`);
  });

  test("at origin/master but on a branch: detaches, so the checkout stops following the branch", () => {
    expect(onBranch()).toBe(true);
    const r = deploy();
    expect(r.code).toBe(0);
    expect(r.out).toBe(`already-at ${head()}`);
    expect(r.err).toContain("detaching");
    expect(onBranch()).toBe(false);
  });

  test("--dry-run runs the checks and the fetch and moves nothing", () => {
    const was = head();
    const target = advanceOrigin();
    const r = deploy("--dry-run");
    expect(r.code).toBe(0);
    expect(r.out.split("\n").at(-1)).toBe(`would-deploy ${target} (was ${was})`);
    expect(head()).toBe(was);
  });

  test("tracked changes refuse; untracked files do not", () => {
    advanceOrigin();
    writeFileSync(join(repo, "notes.md"), "untracked\n");
    writeFileSync(join(repo, "one.txt"), "edited\n");
    let r = deploy();
    expect(r.code).toBe(1);
    expect(r.err).toContain("refused: tracked changes");
    expect(r.err).toContain("one.txt");
    git(repo, "checkout", "-q", "--", "one.txt");
    r = deploy();
    expect(r.code).toBe(0);
    expect(r.out).toStartWith("deployed ");
  });

  test("a linked worktree is refused: deploying a worktree deploys nothing", () => {
    const wt = join(root, "wt");
    git(repo, "worktree", "add", "-q", "--detach", wt);
    const r = Bun.spawnSync(["bash", SCRIPT, "--repo", wt], { stdout: "pipe", stderr: "pipe" });
    expect(r.exitCode).toBe(1);
    expect(r.stderr.toString()).toContain("linked worktree");
  });

  test("a detached HEAD with commits origin/master does not contain is refused; the same commits on a branch are moved off", () => {
    advanceOrigin();
    git(repo, "checkout", "-q", "--detach");
    const stray = commit(repo, "stray");
    let r = deploy();
    expect(r.code).toBe(1);
    expect(r.err).toContain("not an ancestor of origin/master");
    expect(head()).toBe(stray);
    git(repo, "checkout", "-q", "-b", "keep-me");
    r = deploy();
    expect(r.code).toBe(0);
    expect(r.err).toContain("(branch keep-me)");
    expect(git(repo, "rev-parse", "keep-me")).toBe(stray);
    expect(onBranch()).toBe(false);
  });

  test("not a repository, and a bad flag", () => {
    const plain = join(root, "plain");
    Bun.spawnSync(["mkdir", "-p", plain]);
    let r = Bun.spawnSync(["bash", SCRIPT, "--repo", plain], { stdout: "pipe", stderr: "pipe" });
    expect(r.exitCode).toBe(1);
    expect(r.stderr.toString()).toContain("not a git repository");
    r = Bun.spawnSync(["bash", SCRIPT, "--what"], { stdout: "pipe", stderr: "pipe" });
    expect(r.exitCode).toBe(2);
  });
});
