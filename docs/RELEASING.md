# Releasing (2026-10-10)

How a release has been cut so far, in the order it happens. It is a working record, not a
rule: change it when a release teaches something new. The plugin's pin and the single
binary each have their own detail, linked below rather than repeated.

## 1. The release commit

Branch `release/<version>` from master at the commit being released. The release commit
sets the version in four places, moves one example, and sets the release date in one
(`RELEASE_DATE`, below):

- `package.json` `"version"`;
- `SERVER_VERSION` in `src/adapters/mcp/server-words.ts` (the version the memory server reports;
  an open session compares it to say "Counterparts was updated");
- `"version"` in `.claude-plugin/plugin.json`;
- the marketplace entry's `"ref"` in `.claude-plugin/marketplace.json`, as `v<version>`.
  Since 0.3.22 the entry's `url` is the bundle repository,
  `https://github.com/counterparts-ai/counterparts-plugin.git` (3b), so the ref names
  that repository's tag; only the ref moves.

The example of that entry in [plugin.md](plugin.md#releases-only-the-marketplace-pins-a-tag)
(`"ref": "v<version>"`) moves with it.

**The split (two plugins, [plugin.md, "Two
plugins"](plugin.md#two-plugins-2026-10-20-our-own-marketplace-lightly-held)).** First
check whether this release is `FIRST_SPLIT_RELEASE` (`tools/plugin-bundle/build.ts`) or
later:

- **Not the split release, but the version reaches it?** Raise `FIRST_SPLIT_RELEASE` to the
  release the split will ship in, first. On purpose, `build.ts --flavor full` refuses at
  `FIRST_SPLIT_RELEASE` or later (a tripwire), and `test/plugin.test.ts` then wants the
  sidebar's entry in the marketplace.
- **The split release:** the release commit also adds the second marketplace entry,
  `counterparts-sidebar`, a `url` source at
  `https://github.com/counterparts-ai/counterparts-sidebar.git`, `"ref": "v<version>"`,
  with `"description": "A pane beside the chat that shows what your counterpart's memory is
  doing, with a fox. Installs counterparts with it."` and `"category": "memory"` (the words
  `tools/plugin-loop/split.sh`'s `market()` tests with).
  `test/plugin.test.ts` requires that entry exactly from `FIRST_SPLIT_RELEASE` on, with
  both pins at `v<version>`.

`test/mcp.test.ts` fails until `SERVER_VERSION` agrees with `package.json`, and
`test/plugin.test.ts` until the plugin's version and the pin do
([plugin.md, "Releasing: move the pin"](plugin.md#releasing-move-the-pin)).

In the same commit, or a second one:

- **CHANGELOG:** first run `bun tools/changelog/stitch.ts`, which appends every
  `changelog.d/` fragment to the end of `## Unreleased` (oldest first), and every
  `docs/decisions.d/` fragment to the end of "Decisions to review" in `docs/IMPROVEMENTS.md`
  (before its "Also noted", in merge order; [decisions.d/README.md](decisions.d/README.md)),
  and deletes them; commit all of it.
  Then fold `## Unreleased` into `## <version> — <YYYY-MM-DD>`, with a short plain
  paragraph on top: what changed for someone using it, and anything they have to do after
  upgrading. The empty Unreleased heading goes until the next change brings it back (the
  stitch puts it back when it is gone). A hotfix branched off a released tag can edit
  `CHANGELOG.md` directly; fragments are for pull requests against master
  ([changelog.d/README.md](../changelog.d/README.md)).
- **Store format:** check `SCHEMA_VERSION` (`src/core/store/operational.ts`) and
  `CACHE_SCHEMA_VERSION` (`src/core/store/cache.ts`) against the last release. When neither
  moved, the entry can say "no store-format change". When one did, the rollback below has
  to say what the older version does with the newer store. When one did, the CHANGELOG
  paragraph on top also says: after updating, run /reload-plugins in every open Claude Code
  window, or restart Claude Code.
- **Release date:** `RELEASE_DATE` in `src/adapters/update-check.ts` moves with
  `SERVER_VERSION`, to the date in the CHANGELOG heading (`test/update-check.test.ts` holds
  the two together). A copy that makes no update check says, 30 days after it, that a newer one may be out.
- **Who hears of this release** (U1b): `package.json` `"counterparts": { "updates": … }`,
  which npm's `/latest` returns to every install's daily check. Carry the floors forward;
  they only move up. Raise `tellBelow` to this version when everyone below it should hear
  once (a store-format change, a fix worth taking); raise `urgentBelow` for one they must
  take soon. `tellBehind` (3) is how many releases behind is worth a line on its own. Set
  `"plugin": false` when the plugin pin is not moving with this release, so plugin installs
  aren't sent to an update that isn't there. Then copy the floors into `PREVIOUS_FLOORS` in
  `test/update-check.test.ts`, which keeps the next release from lowering them.
- **The gate:** if this release ships or changes the update check, the live
  counterparts.ai/privacy page must already say so (check the page itself, not the site repo).
- **ROADMAP "Now":** the npm row names the new version, and "On master, not released" is
  emptied.

## 2. The checks

**In CI, on the exact release commit.** Pushing `release/<version>` runs
`.github/workflows/tests.yml` on that commit. A push is what gets the commit itself: the run
on the pull request tests a merge of the branch into master. Push once `binaries.json` is
committed (section 3). The push run is:

- the typecheck, the changelog check, the Node smokes on 22.15 and 24, and the hosted tests;
- the suite, on Linux in `America/Denver` and `Pacific/Kiritimati` and on macOS in Denver;
- then, once those pass, the `release` jobs, all on one tarball packed once in the run:
  - the package scan (`tools/audit/scan-personal.ts --tarball`), against the highest version
    below this one on npm. Its verdict is at the bottom of the step and in the summary. A new
    key, a new hit in a hard class (a mailbox, a home path, a session or run id, a scratchpad
    or transcript path) or a file that doesn't belong (`.claude-plugin/`, `.github/`,
    `hooks/`, `commands/`, `test/`, `hosted/`, `dist/`, `docs/harvest/`, tools other than the
    install loop, a scratch folder, a store, `.env`, `.npmrc`, an archive) fails the job,
    printing the class, the file and the line and never the text, then what to do about it.
    New and missing files, sizes, exports and new soft hits (the owner's name, `~/` paths) are
    listed, and reading them is the release agent's job: every new or missing file should
    have a reason;
  - the install loop on that file, on Linux and macOS (`INSTALL_LOOP_TARBALL`): a stranger's
    install in a throwaway HOME;
  - the live dashboard tests (`test/dashboard-*-live.test.ts`), with chromium installed. A
    skip here is a failure.

The run's logs are public, so nothing in it reads a store or a secret. A red job gets a look
at its log (`gh api repos/<owner>/<repo>/actions/jobs/<id>/logs`); a job that failed on a
timeout gets one rerun (`gh run rerun <id> --failed`), and a second failure gets a real look.
Report both numbers.

**Before the push, on the laptop, the release job's quick steps.** Nothing runs them on a pull
request, and in CI they come after about 15 minutes of suites, so whatever master has gathered
since the last release turns up here. Pack the commit (`npm pack`; it has matched CI's hash),
then:

```sh
bun tools/audit/scan-personal.ts --tarball <the pack> --against <the last release's tarball>
INSTALL_LOOP_TARBALL=<the pack> tools/install-loop/run.sh
```

A stop costs a minute this way. In 0.3.42 two stops from one merged PR (session ids in a
comment, a heading the install loop still read by its old words) cost a full run each. Settle
the changelog's words here too: `CHANGELOG.md` and `tools/install-loop/run.sh` ship, so a change
to either is a new tarball and a new run.

**On the laptop, on the commit CI passed.** `uptime` first; these run one at a time.

- the check against a copy of the owner's memories, which is private and can't go near a
  public log. The release brief says what to look at. A snapshot carries no cache, so run
  `counterparts verify --rebuild --keep-vectors` on the copy first, or recall finds nothing;
- the bundles (section 3b), then the plugin loop on the release head, which needs a real
  `claude` ([plugin.md, "The automated loop"](plugin.md#the-automated-loop)):
  `tools/plugin-loop/run.sh --bundle=core`, `--bundle=directory`, and `tools/plugin-loop/split.sh`.
  It installs the working tree under the pin's tag inside its own throwaway clone, so it passes
  before the tag is on GitHub; the one install in it that has to fail is the step naming a
  missing tag;
- the upgrade and the rollback, below, with the tarball from section 4, until they're
  automated;
- people's names other than the owner's: `grep` the tarball, against the last release's, with
  a list kept outside the repository. A list like that can't live in CI. None was kept before
  0.3.42, so that release made one from the person cards on the memory copy
  (`subject_kind = 'person'`) and kept it in the release folder. It's short, so also read the
  capitalized words new since the last release.

## 3. The single binaries

Before the branch is pushed, after the last change to `src/`, on macOS, in a clean clone of
the release branch, after `bun install --frozen-lockfile`:

```sh
bun tools/single-binary/build.ts --release
```

The branch isn't on GitHub yet, so clone it from the checkout that holds it. Commit the
`.claude-plugin/binaries.json` it writes on the release branch (the clone is left with that
file changed: `git checkout` it there before pulling the commit). Copy the `.gz`
files and `SHA256SUMS` from `dist/single-binary/<version>/` into `single-binary/` in a
release folder outside the clone. The builds aren't byte-reproducible, so the files uploaded at publish have to be
these ones. Any later change to `src/` means building again. Details:
[single-binary.md, "Releasing"](single-binary.md#releasing).

The binaries come before the push because of the commit, not the tarball: `.claude-plugin/`
isn't in the npm package, so CI's pack needs nothing from this step (0.3.41's tree packed
with `binaries.json` deleted gives the hash that was published). But the release commit is
the one that carries the manifest, and `test/plugin-bundle.test.ts` wants its version to
match, so a push before this step is a red suite on a commit that won't be released.

## 3b. The plugin bundle

The plugin as a folder of its own, for the bundle repository
(`counterparts-ai/counterparts-plugin`) and Anthropic's directory
([plugin.md, "The bundle"](plugin.md#the-bundle-for-anthropics-directory)). Since 0.3.22
the marketplace installs from it. Generate the bundles after `binaries.json` is
committed, since the build copies that file and refuses one that names another version;
it takes its version from `package.json`.

From the split release on (`FIRST_SPLIT_RELEASE`, [plugin.md, "Two
plugins"](plugin.md#two-plugins-2026-10-20-our-own-marketplace-lightly-held)), `main` of
the bundle repository takes `--flavor core`, and the sidebar has a repository of its own
(`counterparts-ai/counterparts-sidebar`). The full flavor ships nowhere then, and
`build.ts --flavor full` refuses:

```sh
bun tools/plugin-bundle/build.ts --flavor core <clone of counterparts-plugin, main>
bun tools/plugin-bundle/build.ts --flavor sidebar <clone of counterparts-sidebar, main>
```

Before the split release, `main` took the full flavor:

```sh
bun tools/plugin-bundle/build.ts <clone of the bundle repository>                     # full: main
```

The directory flavor (`--flavor directory`, the `directory` branch) is built only when
the directory steps say so; see the list below.

- Create `counterparts-ai/counterparts-sidebar` **empty** (no README, no licence): the
  build refuses a folder that holds anything but a previous bundle and `.git`.
- The build refuses any flavor but `directory` in a checkout on the `directory` branch,
  and the directory flavor in a checkout on any other branch. The guard reads the branch
  the checkout is on, so check out the `directory` branch itself (`git switch directory`),
  never a detached commit: a detached HEAD names no branch and skips it, as does a plain
  folder with no git (which `tools/plugin-loop/run.sh --bundle=directory` relies on). The
  directory flavor is only ever written into a checkout on the branch named exactly
  `directory`. The directory branch stays as it is until
  the directory steps say otherwise.
- The directory flavor master builds already differs from the held directory submission
  (v0.3.23, under review), and #547 adds to that: `commands/uninstall.md`,
  `src/adapters/host-wiring.js`, `src/adapters/plugin.js`, `src/adapters/cli/install.js`
  and `src/adapters/claude-code/doctor-host.js` (the keep-one advice and doctor's line
  beside the sidebar plugin), `src/adapters/mcp/server.js` and `src/core/onboarding.js`
  (the first meeting's close names `/counterparts` only beside a sidebar); its README is
  unchanged (compared 2026-10-22, master 35642c54 against #547's directory plan). Nobody pushes the `directory` branch while that submission is under review.
  Whoever next touches it rebuilds it on purpose, from the master of that day.
- `claude plugin validate <sidebar clone>` is required, every split release:
  `test/plugin-split.test.ts`'s check that runs Claude Code is skipped where `claude` isn't
  installed (CI).
- The install checks, from the split release on: `tools/plugin-loop/run.sh --bundle=core`
  (the launcher steps: Node fallback, dependency install, stand-down,
  against the `counterparts` plugin that ships; `--bundle`, the full flavor, is refused by
  the tripwire then), and `tools/plugin-loop/split.sh` (the two plugins together, and the
  upgrade from the one plugin). split.sh labels core and sidebar with this release's
  version and stands this checkout's full flavor for the release before the split: by
  default the newest `v*` tag below `FIRST_SPLIT_RELEASE` (`SPLIT_OLD=<version>`, or a
  second argument, names another). Before the split release, `--bundle` and split.sh.

Each empties its clone (keeping `.git`) and writes the bundle. Check each with
`claude plugin validate <clone>`, `tools/plugin-loop/run.sh --bundle` (`--bundle=core`
from the split on; and `--bundle=directory`), and `build.ts --check <clone>` against a
second build, with the flavor written there: `--flavor core` and `--flavor sidebar` from
the split on (no flavor means full, which the tripwire refuses then), no flavor before it,
and `--flavor directory` only when the directory steps call for it (the directory flavor's bytes depend on the Bun version), then commit them
there. When the sidebar changed, compare `validate`'s hooks, calls and env lines with the
README's "What it can reach" (`tools/plugin-bundle/bundle-readme.md`, one block per
flavor; `tools/plugin-bundle/sidebar-readme.md` for the sidebar plugin) and update both. At
publish, push core (the full flavor before the split) to `main` and tag it `v<version>`, and
the sidebar bundle to its repository's `main`, tagged `v<version>` (section 5, step 3). The
`directory` branch is not pushed while a submission is under review. The tags must be on
GitHub before the release PR merges: master's marketplace is read live, and it names them.

## 4. Pack

The tarball that gets published is the one CI tested. CI packs it, section 2's checks take
that file, and the run keeps it as an artifact with its sha256. Once the run on the release
head is green:

```sh
tools/release/fetch-tarball.sh <full commit sha> <release folder>
```

That writes `counterparts-<version>.tgz`, `SHA256` and `COMMIT` into the release folder. It
stops, writing nothing, unless the run is on a `release/` branch, every job in it passed, and
the branch is still at that commit, and the file's hash matches both the `SHA256` beside it
and the line the job printed in its log. A mismatch stops the release; find out why before
going on. There's no need to pack on the
laptop, since the file to publish is the tested one. A laptop pack of the same commit has
matched CI's hash (npm 10 and npm 11, 2026-10-30), so it can serve as a cross-check. Artifacts
last 30 days, and a rerun of the `release` job makes a new one.
Add a `release-notes.md` (the version's CHANGELOG entry), run the laptop checks from section
2, then open the release PR.

## 5. Publish

1. From the release folder, on the PUBLISH sheet as one line, so a changed file stops it:
   `shasum -a 256 -c SHA256 && npm publish ./counterparts-<version>.tgz --otp=<code>`.
2. Tag the commit the tarball was packed from (`COMMIT`), and push the tag:

   ```sh
   git tag -a v<version> <packed commit> -m "counterparts <version>"
   git push origin v<version>
   ```

   Use the packed commit rather than the PR's merge commit, unless their trees are identical.
3. Push the bundle (3b) to `counterparts-ai/counterparts-plugin`, tag it `v<version>`
   there, then merge the release PR. Once it's on master, master's marketplace entry names
   the bundle repository's new tag, so `/plugin install` fails at the clone until that tag
   is pushed: tag first, merge after, close together. From the split release on, also
   tag the same commit `counterparts--v<version>`, and push the sidebar bundle to
   `counterparts-ai/counterparts-sidebar` tagged `v<version>`: both entries' pins move in
   the release commit. The sidebar's dependency range (`>=FIRST_SPLIT_RELEASE`, no upper
   limit) resolves against those `counterparts--v*` tags, not the marketplace's pin: core
   installed through the dependency lands at `<version>-<sha>` and follows the highest such
   tag. So that tag only ever goes on a core-flavor commit (never a full or directory one,
   never a pre-release), and pushing it releases core to sidebar users on their next
   update, before the release PR merges.
4. Create the GitHub release with the binaries from section 3 (`<folder>` is the release
   folder):

   ```sh
   gh release create v<version> --verify-tag --title "counterparts <version>" \
     --notes-file <folder>/release-notes.md <folder>/single-binary/*.gz <folder>/single-binary/SHA256SUMS
   ```

   Until they're attached, a plugin user with neither Bun nor Node sees "download failed"
   and a retry ten minutes later. Nothing else breaks.
5. Verify. `bun tools/single-binary/verify-release.ts` downloads every asset and checks
   both checksums. It reads `.claude-plugin/binaries.json` from the checkout it runs in,
   so run it from a checkout (or a `git archive`) of the tag. Exit 0 means every released
   platform gets a program that matches. Then, from a throwaway home (both `HOME` and
   `CLAUDE_CONFIG_DIR` set to a new directory):
   `claude plugin marketplace add mlapeter/counterparts`,
   `claude plugin install counterparts@counterparts`, and `claude plugin list` shows the
   new version. From the split release on, also, in a second throwaway home:
   `claude plugin marketplace add mlapeter/counterparts`, then
   `claude plugin install counterparts-sidebar@counterparts` installs both plugins, and
   `claude plugin list` shows the sidebar at the new version and counterparts at
   `<version>-<sha>`. A missing `counterparts--v<version>` tag shows here as "has no git tag
   satisfying" (split.sh scenario 5).

## Upgrade and rollback, tested before publish

In a throwaway HOME and bun prefix, with `COUNTERPARTS_REQUIRE_EXPLICIT_DIR=1`, no real
`claude` on PATH (a stand-in that writes only inside the throwaway home), and the hooks and
servers driven over stdio:

1. Install the previous release from its tarball, make a store, connect it, and use it: a
   session, a note, recall both ways, doctor.
2. Install the new tarball (`bun remove -g counterparts` first; `bun add -g` over an
   installed copy has failed before) and use it the same way. Watch what a session and a
   memory server that were already open do across the upgrade.
3. Roll back, and use the same store on the older version: it opens, recalls and runs
   doctor without error.

**The plugin, from the split release on.** Sidebar users' core follows the highest
`counterparts--v*` tag on core's repository, not the marketplace's pin. To stop a bad
release reaching more of them, delete its `counterparts--v<version>` tag there and move the
marketplace pins back. Whether `claude plugin update` then takes an installed
`<version>-<sha>` back to the previous tag is unmeasured. For the split release itself
there is no earlier tag that meets `>=FIRST_SPLIT_RELEASE` and no earlier sidebar pin:
rolling it back means taking the sidebar's marketplace entry out (the one plugin comes back
with the previous release's pin), not deleting a tag.

Since 0.3.14 the rollback is **disconnect → reinstall → connect**: the newer version's
`counterparts disconnect`, then the older tarball, then the older version's
`counterparts connect`, and `counterparts install --host claude-desktop` if Claude Desktop
was connected. Reinstalling first leaves every hook pointing at a file the older package
doesn't have, while the older doctor reads green. QUICKSTART's "Going back to an earlier
version" is the user's copy of this; keep the two in step.

## When the launch wiring changes

When a release changes how the hooks or the memory server are started (the commands written
into Claude Code's settings, its MCP registration, or Claude Desktop's config), people who
installed from npm run `counterparts connect` once after upgrading. Say so in the
CHANGELOG entry's opening paragraph and in QUICKSTART's Upgrade section. Doctor's Runtime
line should be amber until it's done, and the upgrade test above should show it: amber
before `connect`, green after.
