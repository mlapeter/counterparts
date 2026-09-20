#!/usr/bin/env bash
#
# Deploy the shared checkout: detach `~/counterparts` at `origin/master`, or at
# whatever commit `--ref` names.
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
# Why `--ref` (2026-09-18). Until now the target was always `origin/master`, so
# every merge rode along in the next deploy. Three things need a named target:
#
#   1. ONE BATCH PER DEPLOY. Master moves while the owner holds a change back
#      (F1/WAL is merged and not deployed on purpose). `--ref <sha>` deploys
#      exactly the commit he approved and leaves the rest of master where it is,
#      so a red doctor afterwards has one suspect.
#   2. THE PIN. The live checkout gets pinned at `floor/v5-last` — the last
#      commit that can open the current store format — while master moves on to
#      an incompatible one, and anything the live store needs meanwhile comes
#      off a `hotfix/v5-floor` branch cut from that tag. Neither is reachable as
#      "origin/master", and the hotfix branch is not even an ancestor of it.
#   3. A ROLLBACK. Moving BACKWARDS to an older commit should go through this
#      script, with its checks, rather than a hand-typed `git checkout --detach`.
#
#   After the pin, doctor's Checkout line is wrong on purpose and must not be
#   "fixed" by deploying: at the tag it reads amber `behind`, and on a
#   `hotfix/v5-floor` commit — not an ancestor of origin/master — it reads RED
#   `detached`. `docs/HANDOFF.md` says which state is intended.
#
# What `--ref` accepts, and what it refuses. A DEPLOY IS OF WHAT IS ON THE
# REMOTE, so a bare name is looked up as `origin/<name>` and never as a local
# branch of the same name, and the target must be a commit some remote-tracking
# ref contains. Accepted: a tag, a full or abbreviated sha, `origin/<branch>`,
# or a bare branch name that exists on origin — and, when a tag and a branch
# answer to the same name, the fully-qualified `refs/tags/<name>` or
# `refs/remotes/origin/<name>` says which. Refused, exit 1: a ref that does
# not resolve; one that resolves only in this clone (an unpushed commit, a local
# branch, `refs/heads/<name>` — the I36 class); one that names two different
# commits.
#
# Refusals, each with its own sentence and exit 1:
#   - not a git repository, or a LINKED worktree (the shared checkout is the main
#     worktree; deploying a worktree deploys nothing)
#   - tracked changes in the tree (`git status --porcelain --untracked-files=no`);
#     untracked and ignored files — `.claude/worktrees/`, a stray notes file —
#     are not a reason to refuse. Also under `--ref`.
#   - a HEAD whose commits a move would ORPHAN. A checked-out BRANCH keeps its
#     commits and is moved off without complaint — that is the branch the rule
#     says should not be here. On a detached HEAD the question is asked
#     differently on each path, because "would this lose commits?" and "is this
#     going forwards?" are only the same question when the target is master:
#       * no `--ref`: refused when HEAD is not an ancestor of `origin/master`,
#         exactly as before. Unchanged, deliberately: the restated rule below is
#         strictly more permissive here (anything on no remote ref is also not an
#         ancestor of origin/master), and this path's behaviour does not move.
#       * with `--ref`: the target may legitimately be BEHIND HEAD (a rollback)
#         or on a side branch (the hotfix), so ancestry is the wrong test.
#         Refused when NO remote-tracking ref contains HEAD — those, and only
#         those, are the commits a move would leave to the reflog.
#   - the fetch failed: a deploy against a stale ref is not a deploy. Under
#     `--ref` the fetch takes tags too, so it can also fail because a LOCAL tag
#     disagrees with origin's tag of the same name; `git tag -d <tag>` and retry.
#
# The script is itself part of the checkout it moves, so a deploy runs the
# version the live tree already has. To deploy with a NEWER copy — this one, say,
# before it is live — run that copy from another worktree and point it at the
# shared checkout:
#
#   <worktree>/tools/deploy-checkout.sh --repo ~/counterparts --ref <sha>
#
# Usage: tools/deploy-checkout.sh [--repo <dir>] [--ref <commit-ish>] [--dry-run]
#   --repo     the shared checkout (default: $HOME/counterparts)
#   --ref      what to deploy (default: origin/master) — a tag, a sha,
#              origin/<branch>, or a branch name that exists on origin
#   --dry-run  run every check and the fetch, print the move, move nothing
# Exit 0 on a move or on already-there, 1 on a refusal, 2 on usage.
#
# The last stdout line is the sha, for the restart reason:
#   deployed <sha> (was <sha>)      or      already-at <sha>

set -euo pipefail

usage="usage: $0 [--repo <dir>] [--ref <commit-ish>] [--dry-run]"

repo="${HOME}/counterparts"
dry_run=0
ref=""
ref_set=0
while [ $# -gt 0 ]; do
  case "$1" in
    --repo)
      [ $# -ge 2 ] || { echo "$usage" >&2; exit 2; }
      repo="$2"; shift 2 ;;
    --ref)
      # A `--ref` with nothing after it, or with an empty value, is a typo, not a
      # request to deploy master: say so rather than silently doing something else.
      [ $# -ge 2 ] || { echo "$usage" >&2; exit 2; }
      [ -n "$2" ] || { echo "$usage" >&2; exit 2; }
      ref="$2"; ref_set=1; shift 2 ;;
    --dry-run) dry_run=1; shift ;;
    -h|--help) echo "$usage"; exit 0 ;;
    *) echo "$usage" >&2; exit 2 ;;
  esac
done

refuse() { echo "refused: $*" >&2; exit 1; }

# Is commit $1 held by any remote-tracking ref? This is the question I36 is
# actually about — "could this commit be got back from origin?" — and it is the
# one asked of both the target and, under `--ref`, of HEAD.
remote_has() {
  [ -n "$(git -C "$repo" for-each-ref --count=1 --contains "$1" refs/remotes/ 2>/dev/null)" ]
}

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

if [ "$ref_set" -eq 1 ]; then
  # Everything origin has: all branches (so a bare name and `origin/<branch>`
  # are current, and a branch created since the clone is there at all) and all
  # tags (so the pin is found even though it was cut after this clone). `--prune`
  # drops remote-tracking refs origin no longer has, so a branch deleted on the
  # remote cannot pass the "is it on the remote?" test on the strength of a
  # stale local copy. It touches `refs/remotes/origin/*` only.
  git -C "$repo" fetch -q --prune --tags origin || refuse "fetch of origin failed; a deploy against a stale ref is not a deploy (a tag fetch also fails when a LOCAL tag disagrees with origin's — 'git tag -d <tag>' and retry)"
else
  git -C "$repo" fetch -q origin master || refuse "fetch of origin/master failed; a deploy against a stale ref is not a deploy"
fi

if [ "$ref_set" -eq 0 ]; then
  target="$(git -C "$repo" rev-parse origin/master)"
else
  # Every namespace a deploy could mean, gathered at once rather than tried in
  # order, so a name that means two different commits is caught instead of
  # silently picked. The raw form is tried ONLY for something that looks like a
  # sha: that is what keeps a local branch out — `git rev-parse foo` would find
  # one, and what deploys is what origin has.
  cands=""
  add_cand() {
    c_sha="$(git -C "$repo" rev-parse -q --verify "$1^{commit}" 2>/dev/null || true)"
    if [ -n "$c_sha" ]; then
      cands="${cands}  $2 -> $c_sha
"
    fi
  }
  add_cand "refs/tags/$ref" "tag $ref"
  case "$ref" in */*) add_cand "refs/remotes/$ref" "remote branch $ref" ;; esac
  add_cand "refs/remotes/origin/$ref" "remote branch origin/$ref"
  # The fully-qualified forms, so a name that a tag and a branch both answer to
  # can still be said unambiguously. `refs/tags/*` and `refs/remotes/*` only:
  # `refs/heads/*` is a local branch, which is never what deploys.
  case "$ref" in refs/tags/*|refs/remotes/*) add_cand "$ref" "ref $ref" ;; esac
  case "$ref" in
    *[!0-9a-fA-F]*) ;;
    *) if [ "${#ref}" -ge 4 ] && [ "${#ref}" -le 40 ]; then add_cand "$ref" "commit $ref"; fi ;;
  esac

  uniq_shas="$(printf '%s' "$cands" | awk 'NF {print $NF}' | sort -u)"
  n_shas="$(printf '%s' "$uniq_shas" | awk 'NF {c++} END {print c+0}')"

  if [ "$n_shas" -gt 1 ]; then
    printf '%s' "$cands" >&2
    refuse "--ref '$ref' is ambiguous: it names $n_shas different commits (listed above) — say which one, as 'origin/$ref', 'refs/tags/$ref', or the sha"
  fi

  if [ "$n_shas" -eq 0 ]; then
    # A short sha that matches more than one object: git will not pick one either.
    case "$ref" in
      *[!0-9a-fA-F]*) ;;
      *) if [ "${#ref}" -ge 4 ]; then
           dis="$(git -C "$repo" rev-parse --disambiguate="$ref" 2>/dev/null | awk 'NF {c++} END {print c+0}' || true)"
           if [ "$dis" -gt 1 ]; then
             refuse "--ref '$ref' is ambiguous: $dis objects start with it — give more of the sha"
           fi
         fi ;;
    esac
    # It resolved through some local ref after all. Two different mistakes wear
    # that shape, and they want different advice.
    local_sha="$(git -C "$repo" rev-parse -q --verify "${ref}^{commit}" 2>/dev/null || true)"
    if [ -n "$local_sha" ]; then
      if remote_has "$local_sha"; then
        refuse "--ref '$ref' is a name only this clone has, although its commit $local_sha IS on origin; name it as a tag, as 'origin/<branch>', or by sha — a deploy is of what origin has, never of a local branch"
      fi
      refuse "--ref '$ref' names nothing on origin; it resolves only in this clone ($local_sha) — a local branch or an unpushed commit, which is the I36 class. Push it first."
    fi
    refuse "--ref '$ref' does not resolve to a commit; give a tag, a sha, 'origin/<branch>', or a branch name that exists on origin"
  fi

  target="$uniq_shas"
  if ! remote_has "$target"; then
    refuse "--ref '$ref' resolves to $target, which no remote-tracking ref contains; it exists only in this clone, and deploying an unpushed commit is the I36 class"
  fi
fi

head="$(git -C "$repo" rev-parse HEAD)"
branch="$(git -C "$repo" symbolic-ref -q --short HEAD || true)"

if [ "$head" = "$target" ]; then
  if [ -n "$branch" ]; then
    echo "note: HEAD is on branch '$branch' at ${ref:-origin/master}; detaching so the checkout stops following a branch" >&2
    [ "$dry_run" -eq 1 ] || git -C "$repo" checkout -q --detach "$target"
  fi
  [ "$ref_set" -eq 0 ] || echo "note: the shared checkout is already at ${ref} = ${target}; nothing to move" >&2
  echo "already-at $target"
  exit 0
fi

if [ -z "$branch" ]; then
  if [ "$ref_set" -eq 1 ]; then
    # See the header: with a named target, "forwards" is not the question — a
    # rollback goes backwards and a hotfix goes sideways, both on purpose. The
    # commits a move would orphan are the ones no remote ref holds.
    if ! remote_has "$head"; then
      refuse "HEAD $head is detached and no remote-tracking ref contains it; those commits would survive only in the reflog — push them or put them on a branch first"
    fi
  elif ! git -C "$repo" merge-base --is-ancestor "$head" "$target"; then
    refuse "HEAD $head is detached and not an ancestor of origin/master $target; those commits would survive only in the reflog — put them on a branch or drop them deliberately"
  fi
fi

behind="$(git -C "$repo" rev-list --count "${head}..${target}")"
ahead="$(git -C "$repo" rev-list --count "${target}..${head}")"

if [ "$ref_set" -eq 0 ]; then
  echo "shared checkout ${repo}: HEAD ${head}${branch:+ (branch $branch)} is ${behind} behind, ${ahead} ahead of origin/master ${target}" >&2
else
  # head != target here, so exactly one of these three is true.
  if [ "$ahead" -eq 0 ]; then direction="forwards"
  elif [ "$behind" -eq 0 ]; then direction="backwards"
  else direction="sideways"; fi
  om="$(git -C "$repo" rev-parse -q --verify origin/master || true)"
  {
    echo "shared checkout ${repo}:"
    echo "  from HEAD ${head}${branch:+ (branch $branch)}"
    echo "  to   ${ref} = ${target}"
    echo "  the move is ${direction}: HEAD is ${behind} behind, ${ahead} ahead of the target"
    if [ -n "$om" ]; then
      echo "  the target is $(git -C "$repo" rev-list --count "${target}..${om}") behind, $(git -C "$repo" rev-list --count "${om}..${target}") ahead of origin/master ${om}"
    else
      echo "  origin/master is not in this clone, so there is nothing to place the target against"
    fi
  } >&2
fi

if [ "$dry_run" -eq 1 ]; then
  echo "would-deploy $target (was $head)"
  exit 0
fi

if [ "$ref_set" -eq 0 ]; then
  git -C "$repo" checkout -q --detach origin/master
else
  git -C "$repo" checkout -q --detach "$target"
fi
after="$(git -C "$repo" rev-parse HEAD)"
[ "$after" = "$target" ] || refuse "checkout ended at $after, not $target"
[ -z "$(git -C "$repo" status --porcelain --untracked-files=no)" ] || refuse "tree is not clean after the move"
echo "deployed $target (was $head)"
