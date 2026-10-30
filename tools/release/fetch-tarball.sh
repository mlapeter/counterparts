#!/usr/bin/env bash
#
# Fetch the tarball CI tested for a release commit, or stop.
#
#   tools/release/fetch-tarball.sh <full commit sha> <release folder>
#
# docs/RELEASING.md §4. CI packs once on a push to release/*, tests that file and
# uploads it. This takes it from the run on exactly that commit, and writes
# counterparts-<version>.tgz, SHA256 and COMMIT into the folder only when all of
# these hold:
#   - the run is on a release/* branch, finished, and every job in it passed, the
#     whole list of them present: a job marked continue-on-error leaves a failed job
#     under a green run, so the run's own verdict isn't enough;
#   - that branch is still at this commit, so an old sha can't bring back a tarball
#     the branch has since moved on from;
#   - the artifact holds one tarball, named for the commit's version, SHA256 names
#     that file and matches it, and the release job's log printed the same hash;
#   - COMMIT is the sha asked for, and the tarball's version is that commit's.
# Any mismatch exits 1 and writes nothing.
set -euo pipefail

REPO="${GH_REPO:-mlapeter/counterparts}"

stop() {
  echo "STOP: $1" >&2
  exit 1
}

SHA="${1:-}"
FOLDER="${2:-}"
[ -n "$FOLDER" ] || stop "usage: fetch-tarball.sh <full commit sha> <release folder>"
[[ "$SHA" =~ ^[0-9a-f]{40}$ ]] || stop "give the full 40-character commit sha, not '$SHA'"
# The checks below cd into a temp folder that's removed at the end, and a relative
# folder would land in it: every check green, and no file anywhere.
case "$FOLDER" in /*) ;; *) FOLDER="$PWD/$FOLDER" ;; esac

# The newest run of tests.yml on this commit from a release branch. Not a
# pull_request run: that one tests a merge of the branch into master, not this commit.
RUN=$(gh api "repos/$REPO/actions/workflows/tests.yml/runs?head_sha=$SHA&per_page=100" --jq \
  '[.workflow_runs[] | select(((.head_branch // "") | startswith("release/")) and (.event == "push" or .event == "workflow_dispatch"))] | sort_by(.created_at) | last | if . == null then "" else "\(.id) \(.status) \(.conclusion) \(.head_branch) \(.html_url)" end')
[ -n "$RUN" ] || stop "no release run of tests.yml on $SHA; has release/<version> been pushed at this commit?"
read -r RUN_ID STATUS CONCLUSION BRANCH URL <<<"$RUN"
[ "$STATUS" = "completed" ] || stop "the run hasn't finished ($STATUS): $URL"
[ "$CONCLUSION" = "success" ] || stop "the run didn't pass ($CONCLUSION): $URL"

# The run's verdict counts a continue-on-error job as passed, and a job dropped from
# the workflow as nothing at all, so read the jobs themselves.
JOBS=$(gh api "repos/$REPO/actions/runs/$RUN_ID/jobs?per_page=100" --jq '.jobs[] | "\(.id)\t\(.conclusion)\t\(.name)"')
while IFS=$'\t' read -r _ JOB_RESULT JOB_NAME; do
  [ "$JOB_RESULT" = "success" ] || stop "a job didn't pass, though the run says it did: '$JOB_NAME' ($JOB_RESULT): $URL"
done <<<"$JOBS"
for WANTED_JOB in "typecheck" "suite (" "node smoke (" "hosted (" "release (pack" "release (install loop"; do
  grep -qF -- "$(printf '\t')$WANTED_JOB" <<<"$JOBS" || stop "the run has no job called '$WANTED_JOB...', so it isn't the whole check: $URL"
done

HEAD=$(gh api "repos/$REPO/git/ref/heads/$BRANCH" --jq '.object.sha') ||
  stop "$BRANCH is gone from GitHub, so nothing says $SHA is still the release. If it is, push the branch back at that commit and wait for its run."
[ "$HEAD" = "$SHA" ] || stop "$BRANCH has moved on: it's at $HEAD, and you asked for $SHA. Fetch $HEAD once its run is green. To release the older commit, point the branch back at it first."

WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
gh run download "$RUN_ID" --repo "$REPO" --name "counterparts-tarball-$SHA" --dir "$WORK/artifact" ||
  stop "no tarball artifact on the run: $URL"
cd "$WORK/artifact"

TARBALLS=(*.tgz)
[ "${#TARBALLS[@]}" -eq 1 ] && [ -f "${TARBALLS[0]}" ] || stop "the artifact should hold one tarball, and holds: ${TARBALLS[*]}: $URL"
TARBALL="${TARBALLS[0]}"
# `shasum -c` checks whatever SHA256 names, which has to be this file and nothing else.
[ "$(wc -l <SHA256 | tr -d ' ')" = "1" ] && [ "$(cut -d' ' -f3- SHA256)" = "$TARBALL" ] || stop "SHA256 should name $TARBALL and only that: $URL"
shasum -a 256 -c SHA256 >/dev/null || stop "the tarball doesn't match the SHA256 beside it: $URL"
HASH=$(shasum -a 256 "$TARBALL" | cut -d' ' -f1)
[ "$(cat COMMIT)" = "$SHA" ] || stop "the artifact says it was packed from $(cat COMMIT), not $SHA"

JOB=$(grep -F "$(printf '\t')release (pack" <<<"$JOBS" | cut -f1)
LOGGED=$(gh api "repos/$REPO/actions/jobs/$JOB/logs" | grep -oE 'TARBALL_SHA256=[0-9a-f]{64}' | head -1 | cut -d= -f2 || true)
[ "$LOGGED" = "$HASH" ] || stop "the file hashes to $HASH, the job's log says ${LOGGED:-nothing}: $URL"

PACKED=$(tar -xzOf "$TARBALL" package/package.json | grep -m1 '"version"' | cut -d'"' -f4)
WANTED=$(gh api -H "Accept: application/vnd.github.raw" "repos/$REPO/contents/package.json?ref=$SHA" | grep -m1 '"version"' | cut -d'"' -f4)
[ "$PACKED" = "$WANTED" ] || stop "the tarball is version $PACKED, the commit says $WANTED"
[ "$TARBALL" = "counterparts-$WANTED.tgz" ] || stop "the tarball is called $TARBALL, and the commit's version is $WANTED"

mkdir -p "$FOLDER"
for f in "$TARBALL" SHA256 COMMIT; do
  if [ -e "$FOLDER/$f" ] && ! cmp -s "$f" "$FOLDER/$f"; then
    stop "$FOLDER/$f is already there and differs; nothing written"
  fi
done
cp "$TARBALL" SHA256 COMMIT "$FOLDER"/

echo "sha256 $HASH  $TARBALL"
echo "packed from $SHA"
echo "tested in $URL"
echo
echo "The PUBLISH sheet's line (the hash check stops it on a mismatch):"
echo "cd <release folder> && shasum -a 256 -c SHA256 && npm publish ./$TARBALL --otp=CODE"
