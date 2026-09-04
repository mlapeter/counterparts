# Flip checklist — making this repository public

*The ruled path, 2026-09-04: **this repository is flipped public as it stands.** Its git
history stays; the owner is content for first names and business names to exist in the
history, and for the author identity on all 183 commits — his real name and personal
email — to be public with it. That is a decision on record, not an open question. What
was cleaned is therefore the **working tree**, and that work is done: see the rewrites on
`launch/w3-depersonalize` and, until it is deleted at step 3, `docs/launch/repo-public-audit.md`
for what each one was and why.*

**Every step below is executed by the owner. No agent runs any of it.** **Step 8 is the
one that cannot be undone.** Everything before it is a commit or a local edit and can be
put back.

This file deliberately does **not** restate what was redacted. Naming the removals in a
file that ships would put them back.

---

## Before the flip

**1. Land the tree work.** Merge the de-personalization branch (`launch/w3-depersonalize`),
W1's packaging branch, and W3 part 2b's README rewrite. The flip is of `master`, so
nothing ships that is not merged.

**2. Re-scan the tree, and read the output rather than the exit code.**

```sh
~/.bun/bin/bun tools/audit/scan-personal.ts
~/.bun/bin/bun tools/audit/scan-personal.ts --list <class>   # for any class that grew
~/.bun/bin/bun tools/audit/scan-history.ts --worktree
```

Both scanners are over-broad on purpose: a hit is a question, not a verdict. What the
last run left behind was, in every case, one of four deliberate things — a business or
product name the owner has ruled fine; the author's own name in his own project; a
dotfile name that is load-bearing product behaviour (the guard that refuses to open a
live v1 store has to name it); or a record id from the project's own instruments, cited
as the evidence for a number. **A hit in a class or a file that is new since then is the
one to read.** Files added after the audit — anything under `tools/demo/`, and the launch
status documents — were covered by the pattern scan but never read end to end by a human;
a regex cannot find a name nobody knew to look for.

**3. Delete the backstage documents from the tree.** These are internal operating
material and an index of what was redacted; neither is what a stranger came for.

```sh
# owner executes — name the files; do NOT `rm -rf docs/launch`, which takes this
# checklist with it.
git rm docs/launch-prompt-2026-09-03.md \
       docs/preflight-prompt-2026-09-03.md \
       docs/launch/repo-public-audit.md
git commit -m "The backstage documents stay in the private working history, not the tree"
```

Removing them from the tip does not remove them from history — that is understood and
accepted under the ruling above. The point is what someone finds when they open the repo.

**4. Check the licensing and packaging pack** (W1 owns the changes; this is the
verification, and it should pass without editing anything):

```sh
test -f LICENSE && head -3 LICENSE               # MIT, Copyright (c) 2026
grep -E '"license"|"private"|"files"|"bin"' package.json   # "license": "MIT"; no "private": true
grep -niE 'pre-build|skeleton check-in|undecided' README.md docs/QUICKSTART.md   # expect no output
npm pack --dry-run                                # read the file list before it is public
```

**5. Add the forward-looking ignores.** Nothing of the sort was ever committed; this is
insurance for a repo that will now take outside contributions.

```sh
# owner executes — append to .gitignore
.env
credentials.env
*.pem
.npmrc
.claude/settings.local.json
```

**6. Read the 30 PR bodies.** They become public with the repo and no file scan covers
them. The audit pattern-scanned them; it did not read them. One needs an edit: **PR #19**
carries the only absolute home path that would be visible anywhere on the public repo.

```sh
gh pr list --repo mlapeter/counterparts --state all --limit 40 --json number,title,body > /tmp/pr-bodies.json
gh pr edit 19 --repo mlapeter/counterparts --body-file /tmp/pr19-body.md   # after editing it
```

Optional, not needed: **PR #17**'s body quotes a test fixture name that the tree has since
renamed. The old name is the owner's own handle, which the ruling permits — edit it only
if he wants the PR body and the tree to read the same.

Seventeen PR bodies carry a "Generated with Claude Code" trailer. Fine to keep — the
project's whole premise says the work is agent-assisted — but it should be a choice.

---

## The flip

**7. Last look, logged out in spirit:** `git ls-files | wc -l`, then skim the tree top
level and `docs/`. This is the last cheap moment.

**8. Flip it.** This is the point of no return for search engines, forks and archivers.

```sh
# owner executes
gh repo edit mlapeter/counterparts --visibility public --accept-visibility-change-consequences
```

---

## After the flip

**9. Clone what the public actually got** — anonymously, into a temp dir, never into
`~/counterparts` (its hooks run live against that checkout):

```sh
cd $(mktemp -d)
git clone https://github.com/mlapeter/counterparts.git && cd counterparts
```

**10. Re-run both scanners on that clone**, and include the PR head refs, which are
public too and cannot be deleted by a user:

```sh
~/.bun/bin/bun tools/audit/scan-personal.ts
~/.bun/bin/bun tools/audit/scan-history.ts > /tmp/public-scan.json
git fetch origin '+refs/pull/*/head:refs/remotes/origin/pr/*'
~/.bun/bin/bun tools/audit/scan-history.ts > /tmp/public-scan-with-prs.json
```

Expect the tree scan to match step 2. The history scan will show more, and that is the
ruling working as intended — read it once so the shape of what is public is known rather
than assumed.

**11. Check every link resolves for a logged-out reader.** `README.md`, `CONSTITUTION.md`
and `docs/` cite `~/bansai/...` as provenance in places; v1's repository is private, so
those must read as lineage, not as links someone can follow. Open the repo page, the PR
list and the commit list in a private window — that is exactly what a stranger sees.

**12. Walk the install path from the README alone**, in a fresh shell, on a machine that
has never had this project on it. If the README's first command fails there, it fails for
everyone.
