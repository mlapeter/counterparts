/**
 * `tools/deploy-checkout.sh` — the one move that makes a merge live (I36):
 * detach the shared checkout at origin/master, or at the commit `--ref` names,
 * refusing everything that is not that. Hermetic: a bare "origin" and a clone
 * per test in a temp dir. Nothing here ever points `--repo` at a real tree.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SCRIPT = join(import.meta.dir, "..", "tools", "deploy-checkout.sh");

let root: string;
let origin: string;
let repo: string;
let other: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "counterparts-deploy-"));
  origin = join(root, "origin.git");
  repo = join(root, "shared");
  other = "";
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
/**
 * A second clone that pushes to origin, so the shared checkout falls behind.
 * Made once per test and reused: the `--ref` tests need several rounds of
 * origin history (a rollback target, a side branch, a tag cut after the clone).
 */
function otherClone(): string {
  if (!other) {
    other = join(root, "other");
    git(root, "clone", "-q", origin, other);
    git(other, "config", "user.email", "t@example.com");
    git(other, "config", "user.name", "t");
  }
  git(other, "fetch", "-q", "origin");
  git(other, "checkout", "-q", "-B", "master", "origin/master");
  return other;
}
function advanceOrigin(): string {
  const o = otherClone();
  const sha = commit(o, "two");
  git(o, "push", "-q", "origin", "master");
  return sha;
}
/** A tag pushed to origin AFTER the shared checkout was cloned. */
function tagOnOrigin(name: string, sha: string): string {
  const o = otherClone();
  git(o, "tag", "-f", name, sha);
  git(o, "push", "-q", "-f", "origin", `refs/tags/${name}`);
  return sha;
}
/**
 * A branch on origin starting at `from`, with one commit of its own — or, when
 * `file` is empty, pointing at `from` itself.
 */
function branchOnOrigin(name: string, from: string, file: string): string {
  const o = otherClone();
  git(o, "checkout", "-q", "-B", name, from);
  const sha = file ? commit(o, file) : from;
  // Fully qualified on both sides: a tag of the same name makes a bare `name`
  // an ambiguous push source — which is the very case one of these tests builds.
  git(o, "push", "-q", "-f", "origin", `refs/heads/${name}:refs/heads/${name}`);
  git(o, "checkout", "-q", "-B", "master", "origin/master");
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

/**
 * `--ref <commit-ish>`: deploy one approved commit while master moves on, the
 * pin at `floor/v5-last` / a `hotfix/v5-floor` branch off it, and a rollback.
 * What must hold throughout: the target is what ORIGIN has (never a local
 * branch, never an unpushed commit), and a move is refused only when it would
 * orphan commits no remote ref holds.
 */
describe("tools/deploy-checkout.sh --ref", () => {
  test("a tag: found although it was cut after the clone, and the move is forwards", () => {
    const was = head();
    const two = advanceOrigin();
    tagOnOrigin("floor/v5-last", two);
    const r = deploy("--ref", "floor/v5-last");
    expect(r.code).toBe(0);
    expect(r.out.split("\n").at(-1)).toBe(`deployed ${two} (was ${was})`);
    expect(head()).toBe(two);
    expect(onBranch()).toBe(false);
    expect(r.err).toContain("the move is forwards");
    expect(r.err).toContain("floor/v5-last = ");
  });

  test("a tag cut behind master: it deploys, and the summary says how far behind master it is", () => {
    const two = advanceOrigin();
    advanceOrigin(); // master moves past the tag, on purpose
    tagOnOrigin("floor/v5-last", two);
    const r = deploy("--ref", "floor/v5-last");
    expect(r.code).toBe(0);
    expect(head()).toBe(two);
    expect(r.err).toContain("the target is 1 behind, 0 ahead of origin/master");
  });

  test("a full sha, and an abbreviated sha", () => {
    const two = advanceOrigin();
    let r = deploy("--ref", two);
    expect(r.code).toBe(0);
    expect(head()).toBe(two);

    const three = advanceOrigin();
    r = deploy("--ref", three.slice(0, 8));
    expect(r.code).toBe(0);
    expect(head()).toBe(three);
  });

  test("origin/<branch> and a bare remote branch name both resolve to the remote branch", () => {
    const was = head();
    const side = branchOnOrigin("hotfix/v5-floor", was, "hotfix");
    let r = deploy("--ref", "origin/hotfix/v5-floor");
    expect(r.code).toBe(0);
    expect(head()).toBe(side);

    const two = advanceOrigin();
    r = deploy("--ref", "master");
    expect(r.code).toBe(0);
    expect(head()).toBe(two);
  });

  test("a bare name is origin's branch, never the LOCAL branch of the same name", () => {
    const localOnly = head();
    git(repo, "branch", "foo", localOnly); // a local `foo` the remote knows nothing about
    const remoteFoo = branchOnOrigin("foo", localOnly, "remote-foo");
    expect(remoteFoo).not.toBe(localOnly);
    const r = deploy("--ref", "foo");
    expect(r.code).toBe(0);
    expect(head()).toBe(remoteFoo);
    expect(git(repo, "rev-parse", "refs/heads/foo")).toBe(localOnly);
  });

  test("a target behind HEAD is a rollback: it moves, and says backwards", () => {
    const one = head();
    const two = advanceOrigin();
    expect(deploy().code).toBe(0);
    expect(head()).toBe(two);
    const r = deploy("--ref", one);
    expect(r.code).toBe(0);
    expect(head()).toBe(one);
    expect(r.err).toContain("the move is backwards");
    expect(r.out.split("\n").at(-1)).toBe(`deployed ${one} (was ${two})`);
  });

  test("a side branch that is no ancestor of master deploys: that is the hotfix shape", () => {
    const one = head();
    const side = branchOnOrigin("hotfix/v5-floor", one, "hotfix");
    const two = advanceOrigin();
    expect(deploy().code).toBe(0);
    expect(head()).toBe(two);
    const r = deploy("--ref", "hotfix/v5-floor");
    expect(r.code).toBe(0);
    expect(head()).toBe(side);
    expect(r.err).toContain("the move is sideways");
    expect(r.err).toContain("the target is 1 behind, 1 ahead of origin/master");
  });

  test("a ref that does not resolve is refused", () => {
    const was = head();
    advanceOrigin();
    const r = deploy("--ref", "no-such-thing");
    expect(r.code).toBe(1);
    expect(r.err).toContain("does not resolve to a commit");
    expect(head()).toBe(was);
  });

  test("a commit or a branch that exists only in this clone is refused", () => {
    const one = head();
    git(repo, "checkout", "-q", "-b", "mine");
    const unpushed = commit(repo, "mine");
    git(repo, "checkout", "-q", "master");
    expect(head()).toBe(one);

    let r = deploy("--ref", unpushed);
    expect(r.code).toBe(1);
    expect(r.err).toContain("no remote-tracking ref contains");
    r = deploy("--ref", "mine");
    expect(r.code).toBe(1);
    expect(r.err).toContain("resolves only in this clone");
    expect(head()).toBe(one);
  });

  test("a name that means two different commits is refused, and both are named", () => {
    const one = head();
    const two = advanceOrigin();
    tagOnOrigin("rel", one);
    branchOnOrigin("rel", two, "rel-branch");
    const r = deploy("--ref", "rel");
    expect(r.code).toBe(1);
    expect(r.err).toContain("is ambiguous");
    expect(r.err).toContain(`tag rel -> ${one}`);
    expect(r.err).toContain("remote branch origin/rel ->");
  });

  test("the same name in two namespaces at the SAME commit is not ambiguous", () => {
    const two = advanceOrigin();
    tagOnOrigin("rel", two);
    branchOnOrigin("rel", two, "");
    const r = deploy("--ref", "rel");
    expect(r.code).toBe(0);
    expect(head()).toBe(two);
  });

  test("a detached HEAD holding an unpushed commit is refused under --ref too", () => {
    advanceOrigin();
    git(repo, "checkout", "-q", "--detach");
    const stray = commit(repo, "stray");
    const r = deploy("--ref", "origin/master");
    expect(r.code).toBe(1);
    expect(r.err).toContain("no remote-tracking ref contains it");
    expect(head()).toBe(stray);
  });

  test("a dirty tree is refused under --ref", () => {
    const two = advanceOrigin();
    tagOnOrigin("floor/v5-last", two);
    writeFileSync(join(repo, "one.txt"), "edited\n");
    const r = deploy("--ref", "floor/v5-last");
    expect(r.code).toBe(1);
    expect(r.err).toContain("refused: tracked changes");
  });

  test("--dry-run --ref prints the move and moves nothing", () => {
    const was = head();
    const two = advanceOrigin();
    tagOnOrigin("floor/v5-last", two);
    const r = deploy("--dry-run", "--ref", "floor/v5-last");
    expect(r.code).toBe(0);
    expect(r.out.split("\n").at(-1)).toBe(`would-deploy ${two} (was ${was})`);
    expect(r.err).toContain("the move is forwards");
    expect(head()).toBe(was);
  });

  test("--ref with no value is a usage error", () => {
    expect(deploy("--ref").code).toBe(2);
    expect(deploy("--ref", "").code).toBe(2);
  });

  test("already at the target: exit 0 and say so", () => {
    git(repo, "checkout", "-q", "--detach", "origin/master");
    const at = head();
    tagOnOrigin("here", at);
    const r = deploy("--ref", "here");
    expect(r.code).toBe(0);
    expect(r.out).toBe(`already-at ${at}`);
    expect(r.err).toContain(`already at here = ${at}`);
    expect(head()).toBe(at);
  });

  test("--repo and --ref together, run from a copy of the script outside the target repo", () => {
    // The script is part of the checkout it moves, so deploying a NEWER script
    // than the live tree has means running that copy from another worktree.
    const elsewhere = join(root, "newer", "tools");
    mkdirSync(elsewhere, { recursive: true });
    const copy = join(elsewhere, "deploy-checkout.sh");
    copyFileSync(SCRIPT, copy);

    const was = head();
    const two = advanceOrigin();
    tagOnOrigin("floor/v5-last", two);
    const r = Bun.spawnSync(["bash", copy, "--repo", repo, "--ref", "floor/v5-last"], {
      cwd: elsewhere,
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, HOME: root },
    });
    expect(r.exitCode).toBe(0);
    expect(r.stdout.toString().trim().split("\n").at(-1)).toBe(`deployed ${two} (was ${was})`);
    expect(head()).toBe(two);
    expect(onBranch()).toBe(false);
  });
});
