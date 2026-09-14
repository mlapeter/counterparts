#!/usr/bin/env bash
#
# Deploy the shared checkout: detach `~/counterparts` at `origin/master`.
#
# Why this exists (LAUNCH-STATUS I36, 2026-09-14). The repository checkout at
# `~/counterparts` is ALSO the runtime: the Claude Code hooks are fresh
# processes at every boundary and run whatever that tree has checked out, and
# an MCP server started there keeps the code it loaded. So two things are true
# that nothing else enforces:
#
#   1. A branch checked out there is LIVE on the owner's memory, merged or not.
#      Nobody develops in the shared checkout; all work is in `.claude/worktrees/`.
#   2. A merge to master deploys NOTHING until the checkout moves. On 2026-09-14
#      #104 sat merged for thirty minutes while every boundary ran the previous
#      commit. The deploy step of a batch is this move, made BEFORE the restart
#      so the restart reason can carry the sha.
#
# This script is the move, and only the move. It is deliberately not part of
# `tools/parallel/bin/restart.ts`, whose contract says the run directory is the
# only thing it writes: the tool that stamps the instrument must not also deploy
# the subject. `doctor` grades the checkout every morning (green at origin/master,
# amber behind it, red off it or dirty); this is what turns amber back to green.
#
# Refusals, each with its own sentence and exit 1:
#   - not a git repository, or a LINKED worktree (the shared checkout is the main
#     worktree; deploying a worktree deploys nothing)
#   - tracked changes in the tree (`git status --porcelain --untracked-files=no`);
#     untracked and ignored files — `.claude/worktrees/`, a stray notes file —
#     are not a reason to refuse
#   - a detached HEAD that is NOT an ancestor of origin/master: commits only the
#     reflog would remember. A checked-out BRANCH keeps its commits and is moved
#     off without complaint — that is the branch the rule says should not be here.
#   - the fetch failed: a deploy against a stale ref is not a deploy
#
# Usage: tools/deploy-checkout.sh [--repo <dir>] [--dry-run]
#   --repo     the shared checkout (default: $HOME/counterparts)
#   --dry-run  run every check and the fetch, print the move, move nothing
# Exit 0 on a move or on already-there, 1 on a refusal, 2 on usage.
#
# The last stdout line is the sha, for the restart reason:
#   deployed <sha> (was <sha>)      or      already-at <sha>

set -euo pipefail

repo="${HOME}/counterparts"
dry_run=0
while [ $# -gt 0 ]; do
  case "$1" in
    --repo)
      [ $# -ge 2 ] || { echo "usage: $0 [--repo <dir>] [--dry-run]" >&2; exit 2; }
      repo="$2"; shift 2 ;;
    --dry-run) dry_run=1; shift ;;
    -h|--help) echo "usage: $0 [--repo <dir>] [--dry-run]"; exit 0 ;;
    *) echo "usage: $0 [--repo <dir>] [--dry-run]" >&2; exit 2 ;;
  esac
done

refuse() { echo "refused: $*" >&2; exit 1; }

[ -d "$repo" ] || refuse "no directory at $repo"
git -C "$repo" rev-parse --is-inside-work-tree >/dev/null 2>&1 || refuse "$repo is not a git repository"

git_dir="$(git -C "$repo" rev-parse --git-dir)"
common_dir="$(git -C "$repo" rev-parse --git-common-dir)"
if [ "$git_dir" != "$common_dir" ]; then
  refuse "$repo is a linked worktree ($git_dir); the shared checkout is the main worktree, and deploying a worktree deploys nothing"
fi

dirty="$(git -C "$repo" status --porcelain --untracked-files=no)"
if [ -n "$dirty" ]; then
  echo "$dirty" >&2
  refuse "tracked changes in $repo; nothing is developed in the shared checkout — move them to a worktree first"
fi

git -C "$repo" fetch -q origin master || refuse "fetch of origin/master failed; a deploy against a stale ref is not a deploy"

target="$(git -C "$repo" rev-parse origin/master)"
head="$(git -C "$repo" rev-parse HEAD)"
branch="$(git -C "$repo" symbolic-ref -q --short HEAD || true)"

if [ "$head" = "$target" ]; then
  if [ -n "$branch" ]; then
    echo "note: HEAD is on branch '$branch' at origin/master; detaching so the checkout stops following a branch" >&2
    [ "$dry_run" -eq 1 ] || git -C "$repo" checkout -q --detach origin/master
  fi
  echo "already-at $target"
  exit 0
fi

if [ -z "$branch" ] && ! git -C "$repo" merge-base --is-ancestor "$head" "$target"; then
  refuse "HEAD $head is detached and not an ancestor of origin/master $target; those commits would survive only in the reflog — put them on a branch or drop them deliberately"
fi

behind="$(git -C "$repo" rev-list --count "${head}..${target}")"
ahead="$(git -C "$repo" rev-list --count "${target}..${head}")"
echo "shared checkout ${repo}: HEAD ${head}${branch:+ (branch $branch)} is ${behind} behind, ${ahead} ahead of origin/master ${target}" >&2

if [ "$dry_run" -eq 1 ]; then
  echo "would-deploy $target (was $head)"
  exit 0
fi

git -C "$repo" checkout -q --detach origin/master
after="$(git -C "$repo" rev-parse HEAD)"
[ "$after" = "$target" ] || refuse "checkout ended at $after, not $target"
[ -z "$(git -C "$repo" status --porcelain --untracked-files=no)" ] || refuse "tree is not clean after the move"
echo "deployed $target (was $head)"
