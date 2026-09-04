# Repo-public audit — secrets, de-personalization, ship list, flip checklist

*W3 part 1 of the launch session. Audited 2026-09-04 on branch `launch/w3-audit`, at
`master` = `55c12bc`. This is a **read-only** audit: no source was changed, no history
rewritten, nothing pushed. Every step the owner must run is staged as a command below and
marked **owner executes**.*

*This file is a working default like everything except `CONSTITUTION.md`. Where it names a
rewrite, the rewrite is a recommendation with a reason, not a ruling.*

---

## 1. Headline

### What was scanned

| | |
|---|---|
| Commits | **183**, reachable from all 71 refs |
| Refs | **41** branch refs (9 local heads, 32 `origin/*`) **+ 30 `refs/pull/N/head`** fetched read-only for this audit |
| Unique blobs scanned | **1002** (970 reachable from refs + 32 reachable only from dangling objects) |
| Bytes scanned | **28,013,797** (28.0 MB); 7 blobs skipped as binary (NUL-bearing), all `bun.lock`-adjacent text-with-BOM false positives re-checked by hand |
| Working tree scanned separately | **246** tracked files, 4,241,647 bytes |
| Commit messages + author/committer idents scanned | **183** commits |
| GitHub side-channels checked | 30 PRs (titles + bodies), 0 issues |
| Largest blob in the whole object store | 170 KB (`test/parallel.test.ts`) — no binaries, no bloat, nothing to strip for size |

Detectors: (a) the repo's own gate, `scanSecrets` from `src/core/encode/secrets.ts` — all
16 families, imported and run, not reimplemented; (b) an extra rule set the gate does not
cover (any `-----BEGIN` armored block, Voyage `pa-` keys, named credential env vars with a
value, `.npmrc` `_authToken`, SSH public keys); (c) a Shannon-entropy sweep over every
`[A-Za-z0-9+/=_-]{32,}` run at > 4.0 bits/char, with a named benign list rather than silent
suppression.

### What was found

**Secrets: zero true positives. Nothing needs to be removed from history for secrecy.**

| | count |
|---|---|
| Blobs with any detector hit | 554 |
| Blobs with a non-keyword hit | 160 |
| Total credential-shaped hits, all commits, all refs | **894** |
| **True positives (a real credential)** | **0** |
| False positives — synthetic test fixtures | 875 |
| False positives — identifiers in source (`const token = …`) | 16 |
| False positives — `bun.lock` `sha512-` integrity hashes | 5 |
| Files ever committed and later deleted | 2, both ordinary source (`src/core/observe/CONTRACT.md`, `src/core/store/observer.ts`) — **no `.env`, no `credentials.env`, no `.npmrc`, no `.claude/settings*.json` was ever committed on any ref** |

**De-personalization: 450 pattern hits across 77 tracked files in 10 classes, plus 12
findings that no pattern could have caught** and that only a full read of the highest-risk
documents surfaced (§6). The pattern hits are almost all benign — the owner's own name, his
machine's dotfile layout, run ids from his own runs. The read-through findings are not:

| | |
|---|---|
| **Private individuals other than the owner, named** | **1** — a first name, in 2 files |
| **Organizations named that are not this project or its ancestors** | **3** — as abbreviated schema filenames, in 1 file |
| **Third-party PII described (counts, not values)** | **1 paragraph** — 38 emails, 6 phone numbers "two … third-party staff personal numbers", a Cloudflare account id |
| **Verbatim content lifted from the owner's live store** | **3** — a memory body, a config file, a conversation turn |
| **Real session UUID / machine path** | **1** |
| **Dated disclosures of the owner's emotional state** | **2** (same event, two files) |

Details and exact locations: §6. Verdicts: §4.2 and §5.

### Recommendation on history: **do not ship this history publicly. Publish from a fresh root.**

This reverses the obvious answer, and the reason is narrow and specific.

**The secrets scan found nothing to remove — that part is settled.** Zero credentials in
any blob on any ref. No third party named in any commit *message*. No `/Users/mlapeter` in
any commit body. On secrets alone, the history is clean and could ship as it stands.

**The blocker is in the blobs, at the root commit.** `docs/harvest/replay-baselines.md:276`
lists the eight schema files in the owner's live v1 store by name:

> `self.md`, `craft.md`, `person-mike.md`, **`person-katie.md`**, `entity-bansai.md`,
> **`entity-mspw.md`**, **`entity-marketing-agents.md`**, **`entity-the100.md`**

That line entered at `3d8f2f8` — **the first commit in the repository** ("Counterparts is
born"). It names a private individual who is one of exactly two people the owner's personal
memory system models, and three organizations. `test/migrate.test.ts` carries the same
persona with two belief statements (`0879c79`).

**And on GitHub, that cannot be removed.** This is the load-bearing fact:

- Squashing `master` does not help. `refs/pull/N/head` is created for every PR and **GitHub
  does not let a user delete it**. All 30 PR heads have `3d8f2f8` as an ancestor, so the
  root tree stays reachable and public after any amount of force-pushing.
- `git filter-repo` + `push --force --mirror` does not help either, for the same reason,
  and it additionally leaves 30 PR *bodies* and every review comment untouched.
- The only reliable removals are deleting the repository outright or a GitHub Support
  purge request — both after the fact, both slower than a crawler.

So the real choice is binary:

**(A) Flip this repo, fix the tip.** Cheapest. Keeps 183 commits and 30 reviewed PRs — real
evidence for the project's own line 11. Cost: `person-katie`, three org names, the Katie
belief lines and the PII-inventory paragraph stay browsable in the public history forever,
one `git log -S` away.

**(B) Publish from a fresh root.** Create the public repository from a single orphan commit
of the cleaned tree; keep `mlapeter/counterparts` private as the archive of receipts. Cost:
the commit trail is not public on day one. But it is not *destroyed* — it stays in the
private repo, and if the owner later decides the material is fine, he can publish it. The
reverse is not possible.

**Recommended: (B).** The asymmetry decides it: one direction is reversible and the other
is not, and the person whose name is at the root commit did not consent to any of it.

**(A) becomes viable if — and only if — the owner confirms two things:** that
`KATIE_BELIEF` and `KATIE_STATUS` in `test/migrate.test.ts:98–99` are invented rather than
lifted from the live store, and that he is content for a first name plus `mspw` / `the100` /
`marketing-agents` to sit permanently in a public git history. Both are one-line answers
only he can give. See §7 step 0.

**Separately, and only under (A):** every commit carries `mlapeter@gmail.com` in its author
field (183 commits; 30 also as `Mike LaPeter <mlapeter@gmail.com>`). That becomes
permanently public. Normal open-source practice, and already discoverable from the owner's
public site — but if he wants a `@users.noreply.github.com` address instead, the rewrite
must happen **before** the flip. Under (B) the question dissolves: the orphan commit gets
whatever identity he chooses.

---

## 2. Method, and how to re-run it

Two scripts, both read-only, both committed on this branch:

```
bun tools/audit/scan-history.ts              # every blob on every ref + dangling
bun tools/audit/scan-history.ts --worktree   # the checked-out tree only
bun tools/audit/scan-personal.ts             # de-personalization, tracked files
bun tools/audit/scan-personal.ts --commits   # de-personalization, commit messages + idents
bun tools/audit/scan-personal.ts --list <class>   # every hit line for one class
```

Neither `gitleaks` nor `trufflehog` is installed on this machine (`which` returns nothing
for both), so the scan is the repo's own gate plus the extra rules above. That is not a
downgrade for this repo specifically: `src/core/encode/secrets.ts` is a hardened,
adversarially-reviewed 16-family scanner that exists precisely because v1 leaked three
live Google API keys, and reusing it means the audit and the product agree about what a
credential looks like. It *is* a gap for exotic vendor prefixes neither list carries; the
entropy sweep is the backstop for those, and it fired on nothing unexplained.

**PR head refs matter and are easy to miss.** GitHub keeps `refs/pull/N/head` alive after a
source branch is deleted, so a scan of `origin/*` alone has a hole. This audit fetched all
30 read-only before scanning:

```
git fetch origin '+refs/pull/*/head:refs/remotes/origin/pr/*'   # already done, read-only
```

They contributed no blobs not already reachable — the merge commits kept them alive — but
the scan covered them and the claim is therefore whole.

**Scope note on "published".** The flip exposes what GitHub holds. Nine local `refs/heads/*`
(the agent worktree branches, `launch/w3-audit`, and three unpushed feature branches) and
32 dangling objects exist only in this clone and **do not ship**. The scanner labels every
blob `published` or `local-only`; every finding below is annotated. Nothing in the
local-only bucket differs in kind from the published bucket anyway — the dangling blobs are
older revisions of the same test files.

---

## 3. Secrets scan — every hit, classified

### 3.1 By family (all refs, all commits)

| detector / family | blobs | hits | where | verdict |
|---|---|---|---|---|
| `gate/model-provider-key` | 61 | 296 | `test/{claude-code,encode,mcp,parallel}.test.ts` | FALSE POSITIVE |
| `entropy/unclassified` | 91 | 267 | docs + tests | FALSE POSITIVE |
| `gate/assigned-credential` | 76 | 150 | 5 src files, 5 test files | FALSE POSITIVE |
| `gate/aws-access-key-id` | 67 | 146 | 6 test files | FALSE POSITIVE |
| `gate/github-token` | 25 | 90 | `test/{encode,mcp}.test.ts` | FALSE POSITIVE |
| `gate/google-api-key` | 35 | 70 | `test/{claude-code,encode,schemas}.test.ts` | FALSE POSITIVE |
| `gate/bearer-token` | 34 | 34 | `test/{claude-code,encode}.test.ts` | FALSE POSITIVE |
| `extra/x:api-key-envvar` | 27 | 27 | `test/{claude-code,parallel}.test.ts` | FALSE POSITIVE |
| `gate/url-path-token` | 4 | 16 | `test/encode.test.ts` | FALSE POSITIVE |
| `gate/gitlab-token` | 5 | 10 | `test/encode.test.ts` | FALSE POSITIVE |
| `gate/npm-token` | 5 | 10 | `test/encode.test.ts` | FALSE POSITIVE |
| `gate/slack-token` | 5 | 10 | `test/encode.test.ts` | FALSE POSITIVE |
| `gate/stripe-key` | 5 | 10 | `test/encode.test.ts` | FALSE POSITIVE |
| `extra/x:begin-block` | 5 | 10 | `test/encode.test.ts` | FALSE POSITIVE |
| `entropy/benign:sha512-integrity` | 1 | 5 | `bun.lock` | FALSE POSITIVE |
| `gate/private-key-block` | 5 | 5 | `test/encode.test.ts` | FALSE POSITIVE |
| `gate/private-key-header` | 5 | 5 | `test/encode.test.ts` | FALSE POSITIVE |
| `gate/jwt` | 5 | 5 | `test/encode.test.ts` | FALSE POSITIVE |
| `gate/url-credentials` | 5 | 5 | `test/encode.test.ts` | FALSE POSITIVE |
| `extra/x:voyage-key` | 0 | 0 | — | — |
| `extra/x:npmrc-auth` | 0 | 0 | — | — |
| `extra/x:ssh-pubkey` | 0 | 0 | — | — |

The "blobs" column is high because a fixture file is rewritten dozens of times across 183
commits and each revision is its own blob. There are **19 distinct fixture strings** behind
the 894 hits.

### 3.2 The distinct fixture values, and why each is not a credential

Every one is checked against the working tree; the historical revisions are the same
strings in earlier files.

| value (as committed) | site | why it is not a credential |
|---|---|---|
| `AIzaSyD-1234567890abcdefghijklmnopqrstuv` | `test/encode.test.ts:92`, `test/schemas.test.ts:1378` | Sequential digits then the alphabet in order. Not a key. |
| `AIzaSyA1B2C3D4E5F6G7H8I9J0K1L2M3N4O5P6Q` | `test/claude-code.test.ts:2288,2328` | `A1B2C3…` counting pattern. Not a key. |
| `AKIAIOSFODNN7EXAMPLE` | 6 test files, 17 sites | **AWS's own documentation example key**, published by Amazon in the IAM docs. |
| `ghp_abcdefghijklmnopqrstuvwxyz0123456789` | `test/encode.test.ts:102` | The alphabet then the digits. Not a token. |
| `ghp_ABCDEFGHIJKLMNOPQRSTUV0123456789` | `test/mcp.test.ts:583,587,590,989` | Same, uppercase. Not a token. |
| `sk-ant-api03-abcdefghijklmnopqrstuvwxyz` | `test/encode.test.ts:127` | Alphabet. Not a key. |
| `sk-ant-api03-AAAAAAAA…` (40×`A`) | `test/mcp.test.ts:341,348` | Forty `A`s. Not a key. |
| `sk-ant-test-not-a-real-key` | `test/claude-code.test.ts:118` | Says so. |
| `sk-ant-from-the-file` / `-from-the-environment` / `-DAY0-TOKEN` / `-yes` / `-loose` / `-x` / `-inherited-from-the-spawn` | `test/claude-code.test.ts`, 14 sites | Precedence-test labels; each names the source it is testing. |
| `sk-secret-do-not-print` | `test/parallel.test.ts:3193` | The assertion is that the value is never printed. |
| `pa-test-not-a-real-key`, `pa-DAY0-TOKEN`, `pa-env` | `test/claude-code.test.ts:1871,2544,2648` | Voyage-shaped, says so. |
| `ANTHROPIC_API_KEY=test-key-not-a-real-credential`, `VOYAGE_API_KEY=test-voyage-not-a-real-credential` | `test/parallel.test.ts:2549` | Written into a temp `credentials.env` by the test itself. Says so. |
| `OPENAI_API_KEY=sk-ignored` | `test/claude-code.test.ts:2592` | Asserts a foreign key name is *not* loaded. |
| `glpat-…`, `npm_…`, `xoxb-…`, `sk_live_…` | `test/encode.test.ts:107–122` | Alphabet/digit runs, one per family, all in the gate's own family table test. |
| `eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N` | `test/encode.test.ts:132` | The **jwt.io demo token** payload (`sub: 1234567890`). |
| `postgres://svc:hunter2secret@db.example.com/app` | `test/encode.test.ts:142` | `example.com`, and the password is the `hunter2` joke. |
| `-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA9\n-----END…` | `test/encode.test.ts:157` | A 17-character body. Not a key. |
| `const token = argv[i] ?? ""` etc. | `src/adapters/dashboard/bin/dashboard.ts:38`, `src/core/recall/cues.ts:107`, `src/core/store/cache.ts:354`, `src/adapters/claude-code/config.ts:471`, `src/adapters/claude-code/credentials.ts:54` | The gate's broadest family (`assigned-credential`) matching **TypeScript identifiers named `token`/`credential`**. No value attached. |
| `sha512-K+lZULY23vRgK/…` ×5 | `bun.lock:14–22` | npm subresource integrity for `typescript`, `@types/bun`, `bun-types`, `@types/node`, `undici-types`. Public hashes. |

`bun.lock` was read in full (24 lines, 4 packages): **no registry URL with credentials, no
`_authToken`, no scoped-registry auth.** Nothing to redact.

### 3.3 The one hit that deserved a second look

`docs/harvest/scar-list-v2.md` §7a describes v1's real incident — three **live** Google API
keys written into the store across 17 traces. The concern was whether the scar record
quotes the leaked keys. It does not: the section names the shape (`AIza…`), the count, and
the trace count, and the only `AIza`-shaped strings anywhere in the repo are the two
counting-pattern fixtures above. `src/core/encode/secrets.ts:87` carries the family's
regex, not a key. **Confirmed clean.**

### 3.4 What the scan cannot tell you

- It scans **content**, not GitHub metadata. PR review comments, commit statuses and
  workflow logs also become public at the flip; there are no Actions workflows in this repo
  (`git ls-files` has no `.github/`), and the PR bodies were read separately (§4.4).
- It cannot detect a credential that never had a recognizable shape (a bare word used as a
  password). The entropy sweep is the backstop and found nothing unexplained.
- Dangling objects are local; if the owner's *other* clones hold different dangling
  objects, they still do not ship — only what GitHub holds does.

---

## 4. De-personalization inventory

`bun tools/audit/scan-personal.ts` — **450 hits, 77 files, 10 classes** in tracked files;
plus commit messages and PR bodies below. Every class is over-broad by design: a false
positive costs a table row, a false negative ships someone's name.

### 4.1 By class

| class | hits | files | verdict | note |
|---|---|---|---|---|
| `tilde-path` | 163 | 53 | **SHIP** (mostly) | `~/.bansai`, `~/.counterparts`, `~/.claude-engram`, `~/.memory-ab`, `~/.bun/bin/bun`. Dotfile *names*, not machine layout. `~/.counterparts` is the product's own documented default data dir (`src/core/store/paths.ts:46`); the others are the migration source and the off-limits guards, which are load-bearing product behaviour. |
| `live-store-path` | 172 | 46 | **SHIP** (mostly) | Same set seen by the second, narrower rule. See 4.2 for the subset to rewrite. |
| `owner-name` | 78 | 22 | **SHIP** | 61 of 78 are the test/doc fixture identity `name: "Mike"` and the invented alias-collision pair `"Mike"` vs `"Mike Chen"` (`src/core/schemas/aliases.ts:142`). 4 are attributed owner rulings ("owner ruling, Mike, 2026-09-04"). The author's own first name in his own project. |
| `owner-handle` | 14 | 5 | **9 SHIP / 5 REWRITE** | See 4.2. |
| `run-id` | 8 | 6 | **SHIP** | `run_6530ad2ee770`, `run_6b037641d8aa` — record ids inside the owner's own instrument output. Meaningless to anyone else and they are the citation for real measurements. |
| `uuid-session-id` | 5 | 3 | **1 REWRITE / 4 SHIP** | 4 are one invented fixture UUID reused across tests. 1 is a real session UUID: see 4.2. |
| `absolute-home-path` | 4 | 3 | **SHIP** | `/Users/x`, `/Users/test`, `/Users/you` — placeholders, every one. **Zero `/Users/mlapeter` in any tracked file.** |
| `short-session-id` | 3 | 2 | **SHIP** | `c781252f`, an 8-hex session id, cited as the evidence for the 12-hour silence tunable (`src/core/remember/tunables.ts:39`). It indexes nothing a stranger can reach. |
| `scratchpad-path` | 2 | 1 | **REWRITE** | Both in `docs/live-verify-2026-08-25.md`. See 4.2. |
| `owner-site` | 1 | 1 | **SHIP** | `mikelapeter.com/lab/memory` in `CONSTITUTION.md:52` — the author's public site, cited as the reference shelf. Keep it; it is a credential for the project, not a leak. |

### 4.2 The pattern-found rewrites (small, mechanical; the serious ones are in §6)

| # | file:line | what is there | rewrite to |
|---|---|---|---|
| R1 | `docs/live-verify-2026-08-25.md:218` | `` `/private/tmp/claude-501/-Users-mlapeter-bansai/d2bbaf8c-179e-4e90-8362-45e62da8a384/scratchpad/live-verify/` `` — the username **and** a real Claude Code session UUID in one string | "a session scratchpad outside this repo" |
| R2 | `docs/live-verify-2026-08-25.md:25` | `` `/private/tmp/claude-501/.../scratchpad/live-verify/data/*` `` | "a temp dir outside this repo" |
| R3 | `src/adapters/claude-code/INTERFACE-GAPS.md:58–62` | "**Residue for the owner:** … It needs one `rm -rf ~/.bansai/x` from the owner." — a personal chore note about the owner's machine, and it reads as an unresolved mess in a document a stranger will read as the project's honesty artifact | Either delete the paragraph or restate as resolved: "The stray directory this created under v1's store was removed by hand; nothing of v1's was modified." **Verify it was actually removed before writing that.** |
| R4 | `test/claude-code.test.ts:1600,1622,1680,1681,1710,1718,1719` | `mlapeter-41` as the peer-session name in seven cross-session-message fixtures | `peer-41`. Mechanical; the assertions do not depend on the string. |
| R5 | `docs/replay-review-2026-08-26.md:37` | `aliases (Mike 386, "the user" 86, mlapeter 46, "the owner" 30, Michael 16, …)` — a real alias-frequency census over the owner's actual conversation history | Keep the numbers, they are the measurement; this is SHIP-with-eyes-open, not a defect. Listed here so the owner sees it before a stranger does. |

**R6–R12 are the read-through findings and are documented in full in §6**, because the
reasoning matters more than the location: `replay-baselines.md:276` (H-A, blocking),
`test/migrate.test.ts` Katie (H-B, blocking, NEEDS-OWNER),
`replay-review-2026-08-26.md:47–55` (H-C, blocking), `SYNTHESIS.md:49–51` (H1),
`replay-baselines.md:300–311` (H2), `tools/recall-bench/index.ts:365–366` (H3),
`behavioral-spec.md:917` (H4), the dated-affect lines (H5),
`PARALLEL-RUN-STATUS.md:10–11, 59` (H6).

One more that is a judgment call rather than a defect:

| # | file:line | issue | recommendation |
|---|---|---|---|
| R13 | `test/cli.test.ts:381`, `test/mcp.test.ts:829`, `test/migrate.test.ts:83` | Three differently-worded "clinic appointment" fixtures used as the *believably private* memory in encryption, recall and confidentiality tests | Ship. Three phrasings of one idea is the signature of invention, not transcription. Flagged because it is exactly the shape a real leaked memory would take. |

### 4.3 Commit messages and author identity

`bun tools/audit/scan-personal.ts --commits` over 183 commits:

| class | hits in bodies | verdict |
|---|---|---|
| `owner-handle` in bodies | 30, all of the form `Merge pull request #N from mlapeter/fix/…` | **SHIP.** GitHub writes these; the handle is the repo owner's. |
| `owner-name` in bodies | 1: *"The dispatch is by TARGET (owner ruling, Mike, 2026-09-04)"* | **SHIP.** An attributed decision by the author. |
| `tilde-path` in bodies | 4: `~/.zshrc`, `~/.bansai-2026-08-15`, `~/.memory-ab/assignment.json` ×2 | **SHIP.** Dotfile names. |
| `run-id` in bodies | 1: `run_6b037641d8aa` | **SHIP.** |
| `uuid-session-id` in bodies | **0** | — |
| `/Users/…` in bodies | **0** | — |
| Author identity | `mlapeter <mlapeter@gmail.com>` ×153, `Mike LaPeter <mlapeter@gmail.com>` ×30 | **Owner decision** — see §1 and §5 step 1. This is the *only* thing on this page that a rewrite could change and a post-flip edit could not. |
| Committer identity | `mlapeter` ×153, `GitHub <noreply@github.com>` ×30 | — |

No "Co-Authored-By: Claude" or "Generated with Claude Code" trailer appears in any commit
message on any ref — the project's own commit convention forbids them, and it held.

### 4.4 GitHub metadata (becomes public at the flip; not covered by any file scan)

- **30 PRs, 0 issues.** All 30 PR bodies were read.
- **17 PR bodies carry a "🤖 Generated with [Claude Code]" trailer.** Fine to ship if the
  owner is comfortable saying the work was agent-assisted — the README and the whole
  project premise say so anyway. Listed so it is a choice, not a surprise.
- **PR #19's body contains `/Users/mlapeter` and `/Users/mlapeter/counterparts`** (twice,
  quoting MCP server cwds). This is the only `/Users/mlapeter` that will be visible
  anywhere on the public repo. Editable in place — no history rewrite:
  `gh pr edit 19 --repo mlapeter/counterparts --body-file <edited>` (**owner executes**).
- PR #17's body quotes `from-name="mlapeter-41"`, the same peer-session name as R4.
- PR #29's body names `~/.counterparts/claude-code.json`. Ship.

---

## 5. Per-file ship list

`git ls-files` = **246 files**. Grouped where a group shares a verdict.

**SHIP** = goes public unchanged. **REWRITE** = goes public after the named edit.
**DROP** = do not include in the public tree.

### Root

| path | verdict | reason |
|---|---|---|
| `CONSTITUTION.md` | SHIP | The project's one authoritative page. `mikelapeter.com` citation stays. |
| `CLAUDE.md` | REWRITE | Ships fine as an artifact of how the project is built, but its "Status: pre-build skeleton" and "implementation only after the owner's skeleton check-in" are **22 PRs stale and now false**. A stranger reads this file. Update the Status section before the flip, or DROP it — do not ship a stale claim. |
| `README.md` | REWRITE | Owned by **W3 part 2** (another agent). Today it says "Status: pre-build", "Implementation starts after the owner's skeleton review", and "License: deliberately undecided… `UNLICENSED`". All three are now false. Do not flip with this README. |
| `package.json` | REWRITE | `"private": true` and `"license": "UNLICENSED"` must become `"license": "MIT"` with `private` removed; also needs `bin`/`files`/`main`/`exports`. **W1 owns this on another branch — do not duplicate the change here.** |
| `bun.lock` | SHIP | 4 dev packages, integrity hashes only, no auth. |
| `tsconfig.json` | SHIP | — |
| `.gitignore` | REWRITE | Four lines. Add `.env`, `credentials.env`, `*.pem`, `.npmrc`, `.claude/settings.local.json` — cheap insurance for a repo that will now take outside contributions. (Nothing of the sort was ever committed; this is forward-looking.) |
| `LICENSE` | **MISSING — must add** | MIT, decided by the owner 2026-09-03. **W1 is adding it on another branch.** Not created here to avoid a conflicting duplicate. |

### `docs/` (10 files)

| path | verdict | reason |
|---|---|---|
| `docs/ELI5.md` | SHIP | The best cold-reader document in the repo. Plain words, no personal content, no stale claims. Consider linking it from the README. |
| `docs/module-map.md` | SHIP | Architecture map. Clean. |
| `docs/SEAMS.md` | SHIP | One attributed owner ruling ("owner ruling, Mike"); otherwise design. |
| `docs/observer-mode.md` | SHIP | Design doc, clean. |
| `docs/BUILD-STATUS.md` | REWRITE **or** DROP | Honest and well-written, but 08-25 vintage and 22 merged PRs stale — the launch prompt itself says so. Shipping it invites a stranger to read a false inventory. Either date-stamp it hard at the top as a historical snapshot superseded by `LAUNCH-STATUS.md`, or leave it out. |
| `docs/PARALLEL-RUN-STATUS.md` | **REWRITE** | The single best honesty artifact in the repo — a live parallel run against v1, recorded daily with real numbers — and it should ship. But **H6**: lines 10–11 and 59 give a session id, "the conversation room at `~`", and a precise overnight working window (22:08 → 04:41 UTC, 13 turns, a 4 h 07 m idle gap) for a named individual. Strip those; keep every count. |
| `docs/live-verify-2026-08-25.md` | **REWRITE (required)** | **H-D / R1 / R2** — the only real session UUID and the only `-Users-mlapeter-` scratchpad path in the tracked tree. Two lines. Otherwise the best-disciplined document in the repo: written under an explicit no-memory-bodies rule and it verifies its own compliance. |
| `docs/replay-review-2026-08-26.md` | **REWRITE (required)** | **H-C** — lines 47–55 publish a third-party PII inventory (38 emails, 6 phone numbers, "two are third-party staff personal numbers", a Cloudflare account id) and a live magic-login token finding. The gate gap it names is already closed (`secrets.ts:159` cites this review); the PII disclosure is not. Reduce to "PII families found; policy call OPEN". The owner-alias census at line 37 is his own call (§6.4). |
| `docs/launch-prompt-2026-09-03.md` | **DROP** | 32 personal-scan hits, the most of any file after PARALLEL-RUN-STATUS. It is an *internal operating prompt*: it names the off-limits live stores and why, the API spend policy (`~$5`, `~$16–20`), the owner's model-seat economics ("conserve Fable tokens"), which agents run on which model, and the exact known-broken state of the install path. None of it is secret; all of it reads as backstage. A public repo that ships its own agent-orchestration prompt is making a choice — if the owner *wants* to make that choice (it is a genuinely interesting document and fits the project's radical-honesty posture) it is safe to ship after R-list. Default recommendation: keep it out of the public tree; it is not what a stranger came for. |
| `docs/preflight-prompt-2026-09-03.md` | **DROP** | Same reasoning, plus it points at `~/bansai/docs/DECISIONS.md` — a file in a **private donor repo the public cannot read**, which is a dead link that also advertises a private repo. |

### `docs/harvest/` (8 files)

**SHIP all eight, after four small redactions (H1–H4 in §6).** This is the lineage material
distilled from v1 and it is the most interesting reading in the repo for anyone evaluating
the project — 28 production scars as acceptance criteria, a behavioral spec, a decision
triage, a log audit of what actually fired in production. None of it needs to stay private.

The structural privacy question was answered when the harvest was produced, deliberately,
and the answer is recorded in `docs/harvest/README.md`:

> **Deliberately not copied here:** `store-design-memory.md` (the seventh harvest output)
> quotes content from the owner's live memory store and stays in the bansai repo
> (`~/bansai/docs/v2-harvest/`), which has a human-eye privacy pass on its flip checklist.
> **This repo is the one that goes public**; reference that file across repos, never copy
> it in.

That split held: `find` confirms neither `store-design-memory.md` nor `docs/v2-harvest/`
exists anywhere in this repo, on any ref. But "the file that quotes the store was held
back" is not the same as "nothing quotes the store," and a full read of the four largest
harvest files found four short strings that leaked through (§6). All four are one-line
fixes.

| path | verdict | reason |
|---|---|---|
| `docs/harvest/README.md` | SHIP | Records the privacy split above. Add one clause noting v1's repo is private, so `~/bansai/...` citations read as provenance rather than dead links. |
| `docs/harvest/SYNTHESIS.md` | **REWRITE** | **H1** — line 49–51 quotes a memory body verbatim out of the live store and says so. |
| `docs/harvest/behavioral-spec.md` | **REWRITE** | **H2** — line 917's episode handle. (H3, the Portland cluster, is NEEDS-OWNER and spans this file plus 10 others.) |
| `docs/harvest/scar-list-v2.md` | **REWRITE** | **H4** — two live-store paths (lines 83, 134). §7a's account of the live-key incident is exactly right and must **not** be softened: it is the reason `src/core/encode/secrets.ts` has no off switch. |
| `docs/harvest/log-audit.md` | **REWRITE** | Pure telemetry — event names and counts, no bodies. One fix: **H5**, line 128's dated `prior-session-high-affect` disclosure. One word. |
| `docs/harvest/replay-baselines.md` | **REWRITE (required, highest-risk file in the repo)** | **H-A** (line 276, the live schema filenames — a private individual and three organizations), **H2** (lines 300–311, the owner's verbatim live config and raw-transcript opt-in), **H5** (lines 169–170), **H7** (lines 22–31, the no-activity calendar), plus `person 2,000` / `aliases 24,732` at 284–285 and 297. Everything else in it is the distributional baseline the replay contract depends on and should ship. |
| `docs/harvest/decisions-triage.md`, `test-triage.md` | SHIP | Clean on every class. See §6.5. |

### `src/` (~150 files, 11 core modules + 4 adapters)

**SHIP, with one REWRITE.** Zero credentials, zero third-party names, zero
`/Users/mlapeter`. The `~/.bansai` / `~/.counterparts` / `~/.claude-engram` references in
`src/core/store/paths.ts`, `src/adapters/claude-code/primacy.ts`, `src/adapters/cli/*` and
the migration reader are **product behaviour** — the path guard that refuses to open a live
v1 store by name is a shipped safety feature and the scar it pays for is cited inline.

| path | verdict | reason |
|---|---|---|
| `src/adapters/claude-code/INTERFACE-GAPS.md` | **REWRITE** | **R3**, the `rm -rf ~/.bansai/x` residue note. Otherwise this file is excellent and should ship — a public list of the gaps a project found in itself is rare and persuasive. |
| `src/**/CONTRACT.md`, `NOTES.md`, `INTERFACE-GAPS.md` (all others) | SHIP | Design rationale, scar citations, honest gap lists. The best documentation in the repo. |
| `src/core/**/*.ts`, `src/adapters/**/*.ts` | SHIP | Clean. The five `assigned-credential` gate hits are identifiers named `token`/`credential`. |

### `test/` (24 files)

**SHIP, except the two below.** Credential fixtures are synthetic throughout (§3.2).
Fixture people are `Mike` (the owner as the fixture identity — correct, it is his memory
system), `Ada`, `Robin Fielding` / `Robin Chen` (a Roy Fielding pun), `Mike Chen`, `Atlas`,
`Paris` — and `Katie`, who is the exception and the reason item 1 of §8 exists.

| path | verdict | reason |
|---|---|---|
| `test/claude-code.test.ts` | REWRITE | **R4** — `mlapeter-41` ×7 → `peer-41`. |
| `test/migrate.test.ts` | **NEEDS-OWNER, then REWRITE** | **H-B** (§6.1) — the "Katie" persona and her two belief statements, in a fixture modeled file-for-file on the live store's layout including the real `schemas/person-katie.md` filename. Not a string swap: `:726` asserts `e.name === "Katie"`. |
| `test/README.md` | REWRITE | One line, and it is stale: "Tests land with implementation, after the skeleton check-in." 1,431 tests have landed. |
| all other `test/*.ts` | SHIP | Hermetic, synthetic, and the suite is a selling point. |

### `tools/` (45 files)

| path | verdict | reason |
|---|---|---|
| `tools/migrate/` (11) | SHIP | The v1→v2 migration, including the confidentiality mapping. Reads `~/.bansai` **as a parameter**; resolves nothing on its own. |
| `tools/replay/` (12) | SHIP | Corpus lives outside the repo; `README.md:12` uses `/Users/you/...` as the placeholder. No owner paths. |
| `tools/recall-bench/` (5) | **REWRITE** | Refuses `~/.counterparts`/`~/.bansai`/`~/.claude-engram` **by name** and documents `cp -R` to a copy — that refusal is the feature. One fix: **H3**, `index.ts:365–366` quotes a real turn from the owner's first live session verbatim. Paraphrase it. |
| `tools/parallel/` (15) | SHIP | The A/B instrument for the live run. Every real path is a CLI parameter with a `~/`-relative default (`readers.ts:13`: *"EVERY REAL PATH IS A PARAMETER. Nothing in this file resolves `~/.bansai` … on its own"*). No `/Users/mlapeter`, no run-directory contents, no owner data. It is bespoke to the owner's two-system comparison and useless to a stranger — but it is also the machinery behind the parallel-run claims, and dropping it would leave those claims unbacked. **Ship it.** |
| `tools/audit/scan-history.ts`, `scan-personal.ts` | SHIP | The scanners behind this document. A repo whose thesis is "evidence over ceremony" should ship the audit that let it go public. Neither embeds any finding. |

### `docs/launch/` — this document

| path | verdict | reason |
|---|---|---|
| `docs/launch/repo-public-audit.md` | **DROP** | **This file is itself a leak vector.** It names Katie, `mspw`, `the100`, `marketing-agents`, quotes the PII paragraph, and cites the session id and working window — i.e. it re-publishes, in one convenient place, everything §6 says to redact. It belongs in the private repo. If the owner wants a public version, ship it with the findings by reference ("one third-party first name, three organization names, one PII-inventory paragraph — see the private audit") and the §1–§3 secrets results intact, which are the part a stranger benefits from. |

### Summary

| verdict | count | files |
|---|---|---|
| SHIP | 229 | everything not listed below |
| REWRITE | 14 | `CLAUDE.md`, `README.md`\*, `package.json`\*, `.gitignore`, `test/README.md`, `docs/BUILD-STATUS.md`, `docs/PARALLEL-RUN-STATUS.md`, `docs/live-verify-2026-08-25.md`, `docs/replay-review-2026-08-26.md`, `docs/harvest/{SYNTHESIS,behavioral-spec,scar-list-v2,log-audit,replay-baselines}.md`, `src/adapters/claude-code/INTERFACE-GAPS.md`, `test/claude-code.test.ts`, `tools/recall-bench/index.ts` — \*owned by other workstreams |
| DROP | 3 | `docs/launch-prompt-2026-09-03.md`, `docs/preflight-prompt-2026-09-03.md`, `docs/launch/repo-public-audit.md` (this file) |
| ADD | 1 | `LICENSE` (MIT) — owned by W1 |
| NEEDS-OWNER | 3 | `test/migrate.test.ts` (Katie — blocking), the Portland/porch worked examples (15 files, probably fine), `docs/harvest/replay-baselines.md:276` org names |

---

## 6. Independent read of the highest-risk documents — the findings a pattern cannot catch

A regex cannot find a name nobody knew to look for. The eleven documents most likely to
quote live-store content were therefore **read end to end** (~2,700 lines) by two
independent readers: `docs/harvest/{behavioral-spec, scar-list-v2, log-audit, SYNTHESIS,
replay-baselines, decisions-triage, test-triage}.md`, `docs/{PARALLEL-RUN-STATUS,
replay-review-2026-08-26, live-verify-2026-08-25}.md`, `tools/parallel/README.md`. Every
finding below was then re-read and confirmed at the cited line by this audit directly.

The structural conclusion is good: the harvest's own privacy split held —
`store-design-memory.md`, the one harvest output that quotes trace content, is not in this
repo on any ref (`find` confirms; `docs/harvest/README.md` records the decision to keep it
in the private v1 repo). What leaked through is narrower than that file and, unhappily,
older: most of it sits in the root commit.

### 6.1 BLOCKING

**H-A. `docs/harvest/replay-baselines.md:276` — a private individual and three
organizations, named.** The live-store inventory table lists the eight schema files in
`~/.bansai/schemas/` by filename, including `person-katie.md`, `entity-mspw.md`,
`entity-marketing-agents.md`, `entity-the100.md`. On a repo owned by `mlapeter`, this reads
as "the owner keeps a person-model for Katie" — she is one of *two* people modeled, the
other being the owner — plus three organizations he tracks. `mspw` and `the100` are not
resolved here, deliberately: guessing is the wrong move and the owner can classify them in a
sentence. `marketing-agents` is corroborated as a real directory on his machine by
`docs/launch-prompt-2026-09-03.md:110` (`~/marketing-agents/BANSAI_MARKETING_PLAN.md`).
**Entered at the root commit `3d8f2f8`.** Redact the filename list to a count.

**H-B. `test/migrate.test.ts:98–99, 267–268, 275–285, 726–728` — the same persona, with
belief text.**
```
const KATIE_BELIEF = "She hears the shape of an argument before she hears its conclusion.";
const KATIE_STATUS = "She is between contracts and reading more than she is writing.";
```
`KATIE_STATUS` is an employment/financial statement about a named person. The evidence that
this may be real, rather than "it reads that way": the fixture writes
`schemas/person-katie.md` — **the exact filename in the live store per H-A** — with the same
frontmatter dialect and dates inside the real 2026-08 log window. Whoever wrote it modeled
the live layout file-for-file, which raises the prior that the *content* came along.
Counter-evidence, honestly: the sibling `self.md` fixture's statements
(`SELF_CORE`, `SELF_INDEX_*`, `SELF_PROTECTED` at lines 92–95) appear nowhere else in the
repo and read as written-to-be-plausible, and the "clinic appointment" sensitive-memory
fixture appears in three files with three different phrasings — a hallmark of invention, not
transcription. **This audit cannot settle it: verifying would mean reading `~/.bansai`,
which is off-limits, and it was not read.** One question to the owner settles it (§7 step 0).
Renaming requires changing the persona, not the strings — line 726 asserts `e.name === "Katie"`.
**Entered at `0879c79`.**

**H-C. `docs/replay-review-2026-08-26.md:47–55` — a third-party PII inventory.**
> "38 memories carry emails, 6 carry E.164 numbers (**two are third-party staff personal
> numbers**), plus a Cloudflare account id" … "a staff magic-login URL survived whole: a
> 16-char bearer token in the URL *path*".

No values are printed. But the paragraph publicly states that the owner's memory store holds
two third parties' personal mobile numbers and a live magic-login token, and it is the kind
of sentence that gets screenshotted. The *gate gap* it names has since been closed — the
`url-path-token` family exists in `src/core/encode/secrets.ts:159` and cites this very
review — so the security signpost is stale; the PII disclosure is not. Reduce to "PII
families found; policy call OPEN". **Entered at `fba4fc6`.**

**H-D. `docs/live-verify-2026-08-25.md:218` (and `:25`) — machine path + username + session
UUID.** `/private/tmp/claude-501/-Users-mlapeter-bansai/d2bbaf8c-…-45e62da8a384/scratchpad/`
— macOS uid, home directory, and a real Claude Code session UUID in one string. (This is R1
and R2 in §4.2.) Line 19's `macOS arm64, Darwin 23.1.0` host fingerprint is minor.

### 6.2 Verbatim live-store content

**H1. `docs/harvest/SYNTHESIS.md:49–51`** quotes a memory body out of the live store and
says so: *"the incident is recorded in the assistant's craft memory (\"Bun silently
auto-loaded real API keys into keyless failure drills…\"). Source: the store, not the
docs."* The content is a benign engineering lesson about the assistant. Un-quote it and
state the lesson in the document's own voice.

**H2. `docs/harvest/replay-baselines.md:300–311`** reproduces the owner's live
`~/.bansai/config.json` as a JSON block and annotates it: *"the owner's bake-in instance
opting in locally (shipped default is `keepRawSpans: false`)"* — i.e. it publishes that he
opted **in** to retaining 30 days of verbatim raw transcripts of his own conversations.
Redact, or state the shipped default without the instance.

**H3. `tools/recall-bench/index.ts:365–366`** quotes a real turn from the owner's first live
session verbatim in shipped source: *"thanks, as before interesting to chat with you. where
would you like to take the conversation from here?"* Benign content; wrong principle in a
file that ships. Paraphrase. (The directory ships no prompts fixture — `README.md:3` says
prompts are supplied at run time — so this comment is the whole exposure.)

**H4. `docs/harvest/behavioral-spec.md:917`** uses `"the porch conversation"` as the
exemplar episode handle, and §13 G9 of the same file says handles are minted from what the
episode itself says — so it is probably a real episode of the owner's. Trivial content, but
it also appears in `src/core/self/CONTRACT.md:72` and `tools/migrate/NOTES.md:64`. Cheap to
replace in three places.

### 6.3 Dated disclosures about the owner

**H5.** `docs/harvest/log-audit.md:128` and `replay-baselines.md:169–170` both record that
18 `prospective.suppressed` events fired **on 2026-08-25 with reason
`prior-session-high-affect`** — which publicly date-stamps an emotionally heavy session for
a real person. No content. The fix is one word: "a single day" instead of the date.

**H6.** `docs/PARALLEL-RUN-STATUS.md:10–11` gives session `c781252f`, *"the conversation
room at `~`"*, and the working window **2026-09-03 22:08 UTC → 2026-09-04 04:41 UTC, 13
owner turns**; `:59` adds *"the 4 h 07 m idle gap"*. A precise overnight working window for a
named individual. Strip the id and the window; the counts can stay.

**H7.** `docs/harvest/replay-baselines.md:22–31` lists the four calendar dates in the window
with no activity (2026-07-28, 08-02, 08-16, 08-20) — literally a calendar of the days a real
person did not work. `:193–201` of PARALLEL-RUN-STATUS is a seven-row per-day activity table
naming the heaviest day. Low severity; listed so it is a choice.

### 6.4 Owner-usage facts — inventory, not defects

Both documents are dense with real measurements of the owner's own store and spend: API
spend (`$16–20` actual vs `$25–40` estimated; a further `~$30` run), store sizes (13,653
traces, 89,008 archive files, 2.6 GB of backups, a 142.7 MB index, a 177.5 MB vector cache),
node counts by kind (**person 2,000**, **aliases 24,732**), the credential-redaction census
on the real store (**26 redactions, 19 of them Google-API-key-shaped**), the owner-alias
frequency table (`Mike 386, "the user" 86, mlapeter 46, "the owner" 30, Michael 16, Matt
15`), and *"41 restatements of one owner trait"*.

**None of it identifies anyone and none of it is recommended for removal.** It is the
evidence base the claims audit will want, and publishing it is exactly the honesty the
project sells. It is listed here so the owner sees the aggregate before a stranger does: read
together it is an unusually detailed activity, spend and behavior profile of one real person.
(For the record, `Matt` in the alias table is a **confabulation** the review itself
diagnoses — "'Matt' appears in zero corpus files and zero v1 traces" — not a third party.)

### 6.5 Confirmed clean

- **`docs/harvest/scar-list-v2.md` §7a** describes the three-live-Google-API-key incident by
  count, shape, blast radius and revocation date, and **prints no key material**. That is
  exactly right and must not be softened: it is the reason `src/core/encode/secrets.ts` has
  no off switch. Two minor path redactions only: `~/.bansai-env` (`:83`, names where the
  owner's API credentials sit on disk) and `~/.bansai/episodes/2026-08-04-5410d07e.md`
  (`:134`, a real journal filename — date and id, no content).
- **`docs/harvest/test-triage.md`** — nothing found in any class. The cleanest file audited.
- **`docs/harvest/decisions-triage.md`** — publishable as-is; every number is about the
  system's mechanics.
- **`tools/parallel/README.md`** — publishable as-is. Its own design forbids the classes this
  audit looks for (`:290` "the meter carries addresses, never lines"; `:95` "credential NAMES
  are reported present/absent — a value never enters a report") and the text holds to it.
- **`docs/live-verify-2026-08-25.md`** apart from H-D — it was written under an explicit
  redaction requirement (`:14–16` "No memory body text appears anywhere below") and verifies
  its own compliance at `:98–100`. Two fixture first names, `"Priya"` (`:47, :62`) and
  `"Jordan"` (`:55`), sit in a numbered seed table (`fact-1`, `person-1`, …) in a throwaway
  temp store and appear nowhere else in the repo — synthetic on the evidence; worth one
  glance from the owner.
- **`docs/harvest/behavioral-spec.md`** apart from H4 — genuinely abstract. One NEEDS-OWNER:
  the "Portland" / "June" / *"how did the move go?"* prospective-memory example (`:1070`,
  `:1091`, `:1117`). Read alone it correlates into "a move to Portland in June" beside §12
  G7's *"someone's hard week"* / *"the ashes"*. Read in context it is the project's
  **canonical worked example**, threaded through `src/core/prospective/{index.ts,CONTRACT.md,
  NOTES.md,INTERFACE-GAPS.md}`, `src/core/recall/{activate.ts,CONTRACT.md}`,
  `test/prospective.test.ts` and `test/seams.test.ts` — 15 files. This audit's read is that
  it is example-writing ("the truck is booked", "lands on the fourth"), not a memory.
  Changing it is a 15-file rename; **ask before paying that**. Same for `"Mike Chen"`
  (`:1326`, the alias-collision example, 5 files).

---

## 7. Flip checklist — **every step is owner-executed**

Nothing below was run. Commands are staged verbatim. Steps are ordered; 1 and 2 are the
only ones that are hard to undo.

### Step 0 — answer three questions. Everything else waits on them.

**(a) Are `KATIE_BELIEF` and `KATIE_STATUS` (`test/migrate.test.ts:98–99`) invented, or
lifted from the live store?** And: is a first name plus `mspw` / `the100` /
`marketing-agents` acceptable in a permanently public git history? *This audit did not and
must not check — verifying would mean reading `~/.bansai`.* Everything in (b) turns on it.

**(b) History: publish this repo, or publish from a fresh root?**
Recommendation: **fresh root (option B, §1)** unless (a) comes back clean. The reasoning is
in §1 and it rests on one fact worth repeating: **`refs/pull/N/head` cannot be deleted by a
user, so nothing removes the root commit's content from this repo once it is public** —
not squashing, not `filter-repo`, not `push --force --mirror`.

> **Option B — publish from a fresh root.** Not run by this audit.
> ```sh
> # OWNER EXECUTES. Order matters: the live hooks run ~/counterparts.
> # 1. Do the Step-1 rewrites and merge them to master FIRST.
> # 2. Build the public tree from the cleaned tip, in a temp dir — never in ~/counterparts:
> cd $(mktemp -d) && git clone ~/counterparts public-tree && cd public-tree
> git checkout --orphan public && git rm -r --cached docs/launch docs/launch-prompt-2026-09-03.md docs/preflight-prompt-2026-09-03.md
> git add -A && git commit -m "Counterparts 0.1.0"
> # 3. Create a NEW repository under a NEW name and push only that branch.
> #    Do NOT rename mlapeter/counterparts — see the hazard below.
> gh repo create mlapeter/<new-name> --public --source=. --push
> ```
>
> ⚠️ **Renaming hazard.** If instead the owner renames `mlapeter/counterparts` →
> `counterparts-private` and creates a fresh `mlapeter/counterparts`, the old name is
> immediately claimable and `~/counterparts`'s `origin` starts resolving to **unrelated
> history** — on the machine whose live hooks run that checkout. If he takes that route,
> `git -C ~/counterparts remote set-url origin <new-private-url>` runs **before** the new
> repo is created, not after.

> ⚠️ **Option A + email rewrite — the single most dangerous action in this document.**
> Only if (a) comes back clean AND the owner wants a noreply author address. `master` is
> LIVE: his Claude Code hooks run `~/counterparts` master directly, and a rewrite changes
> every SHA. Stop the hooks, back up, and work in a **fresh mirror clone** — never in the
> working repo, never in an agent worktree. Note it still does **not** clean
> `refs/pull/*` or the 30 PR bodies.
> ```sh
> # OWNER ONLY. NOT RUN BY THIS AUDIT. Requires `pipx install git-filter-repo`.
> cd $(mktemp -d) && git clone --mirror git@github.com:mlapeter/counterparts.git cp.git && cd cp.git
> git filter-repo --mailmap /path/to/mailmap   # Mike LaPeter <ID+mlapeter@users.noreply.github.com> <mlapeter@gmail.com>
> # inspect, then:
> git push --force --mirror git@github.com:mlapeter/counterparts.git
> # then re-clone ~/counterparts from scratch and restart the hooks.
> ```

**(c) Is the "Portland move" / "the porch conversation" worked example drawn from a real
event?** If yes it is a 15-file rename (`src/core/prospective/*`, `src/core/recall/*`,
`test/prospective.test.ts`, `test/seams.test.ts`, `src/core/self/CONTRACT.md`,
`tools/migrate/NOTES.md`, `docs/harvest/behavioral-spec.md`). This audit's read is that it
is example-writing and needs no change — but it is one question and the cost of being wrong
is a stranger reading a real person's move date.

### Step 1 — the content rewrites (§6 and §4.2), on a normal PR branch

Not master directly.

```sh
# owner executes
git checkout -b launch/w3-depersonalize

# BLOCKING (§6.1)
# H-A  docs/harvest/replay-baselines.md:276  — replace the 8 schema FILENAMES with a count
# H-B  test/migrate.test.ts:98-99,267-268,275-285,726-728 — rename the persona AND replace
#      both belief strings, if Step 0(a) says lifted. :726 asserts the name, so it is a
#      persona rename, not a string swap.
# H-C  docs/replay-review-2026-08-26.md:47-55 — reduce to "PII families found; policy OPEN"
# H-D  docs/live-verify-2026-08-25.md:25,218 — strip path, uid, username, session UUID  (=R1,R2)

# VERBATIM STORE CONTENT (§6.2)
# H1   docs/harvest/SYNTHESIS.md:49-51            — un-quote the craft memory
# H2   docs/harvest/replay-baselines.md:300-311   — drop the owner's live config block
# H3   tools/recall-bench/index.ts:365-366        — paraphrase the quoted turn
# H4   docs/harvest/behavioral-spec.md:917 (+ src/core/self/CONTRACT.md:72,
#      tools/migrate/NOTES.md:64)                 — replace "the porch conversation"

# DATED DISCLOSURES (§6.3)
# H5   docs/harvest/log-audit.md:128, replay-baselines.md:169-170 — "a single day", not the date
# H6   docs/PARALLEL-RUN-STATUS.md:10-11,59       — drop session id + the overnight window
# H7   docs/harvest/replay-baselines.md:22-31     — drop the no-activity calendar (optional)
#      docs/harvest/replay-baselines.md:284-285,297 — person 2,000 / aliases 24,732 (optional)

# SMALLER (§4.2)
# R3   src/adapters/claude-code/INTERFACE-GAPS.md:58-62 — the `rm -rf ~/.bansai/x` residue note
# R4   test/claude-code.test.ts  — s/mlapeter-41/peer-41/g  (7 sites)
#      docs/harvest/scar-list-v2.md:83,134 — generalize ~/.bansai-env and the episode filename
# plus CLAUDE.md status, test/README.md, .gitignore additions

~/.bun/bin/bun test && npx tsc --noEmit
gh pr create --fill
```

Docs and tests only — free under the parallel-run rule. But **H-B touches
`test/migrate.test.ts` assertions**, so run the suite; do not hand-edit and assume.

### Step 2 — remove the three DROP files from the public tree

```sh
# owner executes
#   docs/launch-prompt-2026-09-03.md      — internal operating prompt
#   docs/preflight-prompt-2026-09-03.md   — internal operating prompt, points at a private repo
#   docs/launch/repo-public-audit.md      — THIS FILE: it re-publishes every §6 finding
```
Under **option B** these simply never enter the orphan commit (the `git rm -r --cached` in
Step 0). Under **option A**, `git rm` removes them from the tip but **not from history** —
which for the two prompt files is fine (nothing in them is secret; the recommendation is
about what a stranger finds when they open the repo), and for this audit file is the whole
problem, which is another argument for B.

### Step 3 — licensing pack — **W1 owns this, do not duplicate**

W1 is adding `LICENSE` (MIT, owner decision 2026-09-03) and the `package.json` `license`
field on another branch. **No CLA** — decided. This audit did not create either file.
Verify before the flip:

```sh
# owner executes
test -f LICENSE && head -3 LICENSE                      # expect: MIT License / Copyright (c) 2026 Mike LaPeter
grep -E '"license"|"private"' package.json              # expect: "license": "MIT", no "private": true
```

### Step 4 — README — **W3 part 2 owns this**

Today's README says "Status: pre-build", "Implementation starts after the owner's skeleton
review", and "License: deliberately undecided". **Do not flip until all three are fixed.**

### Step 5 — the flip

**Under option B** the repository is created public in Step 0 and there is no flip; skip to
the PR-metadata note below (it does not apply either, since the PRs stay in the private
repo — which is one more thing option B buys).

**Under option A** — the point of no return for search engines, forks and archivers:

```sh
# owner executes
gh repo edit mlapeter/counterparts --visibility public --accept-visibility-change-consequences
```

Immediately after, fix the PR metadata that only becomes visible now:

```sh
# owner executes
gh pr edit 19 --repo mlapeter/counterparts --body-file /tmp/pr19-body.md   # strip /Users/mlapeter
```

### Step 6 — npm publish

```sh
# owner executes — only after W1's clean-room install loop is green
npm pack --dry-run          # inspect the file list FIRST; today package.json has no `files`
npm publish --access public
```
`npm publish` is irreversible in practice (unpublish is limited to 72 hours and burns the
name). Do not run it before `npm pack --dry-run` shows a runnable package.

### Step 7 — site deploy

```sh
# owner executes — W4 owns the site; staged here for ordering only
# deploy counterparts.ai only after the README and the public repo URL both resolve
```

### Step 8 — post-flip verification

```sh
# owner executes, on a clean machine or a fresh temp dir — NOT in ~/counterparts
cd $(mktemp -d)
git clone https://github.com/mlapeter/counterparts.git   # anonymous HTTPS, no auth
cd counterparts

# 8a. re-run this audit against what the public actually got
~/.bun/bin/bun tools/audit/scan-history.ts > /tmp/public-scan.json
~/.bun/bin/bun tools/audit/scan-personal.ts
# expect: same counts as this document, minus the rewritten sites

# 8b. the PR refs are public too — scan them
git fetch origin '+refs/pull/*/head:refs/remotes/origin/pr/*'
~/.bun/bin/bun tools/audit/scan-history.ts > /tmp/public-scan-with-prs.json

# 8c. every link in the README and CONSTITUTION resolves for a logged-out reader
#     (watch for ~/bansai/... citations — that repo is private)

# 8d. the stranger install path, from the README alone, in a fresh HOME
```

Also worth one manual pass, logged out, in a private window: the repo page, the 30 PRs, and
the commit list — that is exactly what a stranger sees.

---

## 8. Top 10 items that must change before the flip

1. **`test/migrate.test.ts:98–99` "Katie" — answer the one question** (§7 step 0a): invented,
   or lifted from the live store? A named private individual with an employment detail
   attached, in a fixture modeled file-for-file on the real store's layout. *Blocking, and
   it gates item 2.*
2. **Decide history: publish this repo, or from a fresh root** (§1, §7 step 0b). `person-katie`
   and three organization names enter at the **root commit**, and `refs/pull/N/head` makes
   them unremovable once public. Recommendation: fresh root. *Blocking, irreversible.*
3. **`docs/harvest/replay-baselines.md:276`** — redact the eight live schema filenames
   (H-A). One table cell. *Blocking.*
4. **`docs/replay-review-2026-08-26.md:47–55`** — the third-party PII inventory: 38 emails,
   6 phone numbers "two … third-party staff personal numbers", a Cloudflare account id
   (H-C). *Blocking.*
5. **`README.md`** still says "Status: pre-build" and "License: deliberately undecided";
   **`LICENSE` does not exist** and `package.json` says `"license": "UNLICENSED"`,
   `"private": true`. W3 part 2 and W1. *Blocking.*
6. **`docs/live-verify-2026-08-25.md:25, 218`** — real session UUID + `-Users-mlapeter-`
   machine path + uid (H-D / R1 / R2). *Blocking.*
7. **`docs/harvest/replay-baselines.md:300–311`** — the owner's verbatim live `config.json`,
   annotated as his opt-in to retaining 30 days of raw transcripts (H2).
8. **`docs/PARALLEL-RUN-STATUS.md:10–11, 59`** — session id plus a precise overnight
   working window for a named individual (H6); and **`log-audit.md:128` /
   `replay-baselines.md:169–170`**, the date-stamped high-affect session (H5).
9. **`tools/recall-bench/index.ts:365–366`** — a real conversation turn quoted verbatim in
   shipped source (H3). And `docs/harvest/SYNTHESIS.md:49–51`, a memory body quoted from
   the store (H1).
10. **`CLAUDE.md` "Status: pre-build skeleton"** is 22 PRs false and a stranger reads it;
    **drop the two prompt files and this audit** from the public tree; **`test/claude-code.test.ts`**
    `mlapeter-41` ×7 → `peer-41`; **PR #19's body** carries the only public `/Users/mlapeter`.

Runners-up, non-blocking: `docs/BUILD-STATUS.md` needs a stale-snapshot banner or removal;
`test/README.md` is one stale line; `.gitignore` should gain `.env`/`.npmrc`/`*.pem`;
`docs/harvest/scar-list-v2.md:83,134`; the Portland/porch worked-example question (§7 step 0c).

---

*Scans reproduced by: `bun tools/audit/scan-history.ts`, `bun tools/audit/scan-history.ts
--worktree`, `bun tools/audit/scan-personal.ts`, `bun tools/audit/scan-personal.ts
--commits`. Raw JSON was written to a session scratchpad outside this repo and is not
committed — re-run the scripts to regenerate it.*
