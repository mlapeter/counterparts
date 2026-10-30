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
#   - the run is on a release/* branch, finished, and every job in it passed;
#   - the file's sha256 matches SHA256 in the artifact, and the line the release job
#     printed in its log;
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

# The newest run of tests.yml on this commit from a release branch. Not a
# pull_request run: that one tests a merge of the branch into master, not this commit.
RUN=$(gh api "repos/$REPO/actions/workflows/tests.yml/runs?head_sha=$SHA&per_page=100" --jq \
  '[.workflow_runs[] | select((.head_branch | startswith("release/")) and (.event == "push" or .event == "workflow_dispatch"))] | sort_by(.created_at) | last | if . == null then "" else "\(.id) \(.status) \(.conclusion) \(.html_url)" end')
[ -n "$RUN" ] || stop "no release run of tests.yml on $SHA; has release/<version> been pushed at this commit?"
read -r RUN_ID STATUS CONCLUSION URL <<<"$RUN"
[ "$STATUS" = "completed" ] || stop "the run hasn't finished ($STATUS): $URL"
[ "$CONCLUSION" = "success" ] || stop "the run didn't pass ($CONCLUSION): $URL"

WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
gh run download "$RUN_ID" --repo "$REPO" --name "counterparts-tarball-$SHA" --dir "$WORK/artifact" ||
  stop "no tarball artifact on the run: $URL"
cd "$WORK/artifact"

TARBALL=$(ls counterparts-*.tgz)
shasum -a 256 -c SHA256 >/dev/null || stop "the tarball doesn't match the SHA256 beside it: $URL"
HASH=$(shasum -a 256 "$TARBALL" | cut -d' ' -f1)
[ "$(cat COMMIT)" = "$SHA" ] || stop "the artifact says it was packed from $(cat COMMIT), not $SHA"

JOB=$(gh api "repos/$REPO/actions/runs/$RUN_ID/jobs?per_page=100" --jq '.jobs[] | select(.name | startswith("release (pack")) | .id')
LOGGED=$(gh api "repos/$REPO/actions/jobs/$JOB/logs" | grep -oE 'TARBALL_SHA256=[0-9a-f]{64}' | head -1 | cut -d= -f2 || true)
[ "$LOGGED" = "$HASH" ] || stop "the file hashes to $HASH, the job's log says ${LOGGED:-nothing}: $URL"

PACKED=$(tar -xzOf "$TARBALL" package/package.json | grep -m1 '"version"' | cut -d'"' -f4)
WANTED=$(gh api -H "Accept: application/vnd.github.raw" "repos/$REPO/contents/package.json?ref=$SHA" | grep -m1 '"version"' | cut -d'"' -f4)
[ "$PACKED" = "$WANTED" ] || stop "the tarball is version $PACKED, the commit says $WANTED"

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
