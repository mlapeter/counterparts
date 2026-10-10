# Releasing (2026-10-10)

How a release has been cut so far, in the order it happens. It is a working record, not a
rule: change it when a release teaches something new. The plugin's pin and the single
binary each have their own detail, linked below rather than repeated.

## 1. The release commit

Branch `release/<version>` from master at the commit being released. The release commit
sets the version in four places:

- `package.json` `"version"`;
- `SERVER_VERSION` in `src/adapters/mcp/server.ts` (the version the memory server reports;
  an open session compares it to say "Counterparts was updated");
- `"version"` in `.claude-plugin/plugin.json`;
- the marketplace entry's `"ref"` in `.claude-plugin/marketplace.json`, as `v<version>`.

`test/mcp.test.ts` fails until `SERVER_VERSION` agrees with `package.json`, and
`test/plugin.test.ts` until the plugin's version and the pin do
([plugin.md, "Releasing: move the pin"](plugin.md#releasing-move-the-pin)).

In the same commit, or a second one:

- **CHANGELOG:** fold `## Unreleased` into `## <version> — <YYYY-MM-DD>`, with a short plain
  paragraph on top: what changed for someone using it, and anything they have to do after
  upgrading. The empty Unreleased heading goes until the next change brings it back.
- **Store format:** check `SCHEMA_VERSION` (`src/core/store/operational.ts`) and
  `CACHE_SCHEMA_VERSION` (`src/core/store/cache.ts`) against the last release. When neither
  moved, the entry can say "no store-format change". When one did, the rollback below has
  to say what the older version does with the newer store.
- **ROADMAP "Now":** the npm row names the new version, and "On master, not released" is
  emptied.

## 2. The checks

On a clean clone of the release branch, after `bun install --frozen-lockfile`, on a quiet
machine (hook tests have timed out under load; rerun a timed-out file alone and report both
numbers):

- `bun run typecheck`;
- the suite in three time zones, `bun test --timeout 30000` under `TZ=UTC`,
  `TZ=America/Denver` and `TZ=Pacific/Kiritimati`, with the live dashboard browser tests
  (`test/dashboard-*-live.test.ts`) run on their own;
- `bun run test:node` on the lowest supported Node (22.15) and the current one;
- the install loop, `tools/install-loop/run.sh`: a stranger's install from the packed
  tarball, in a throwaway HOME;
- the plugin loop, `tools/plugin-loop/run.sh`, on the release head
  ([plugin.md, "The automated loop"](plugin.md#the-automated-loop)). It installs the
  working tree under the pin's tag inside its own throwaway clone, so it passes before the
  tag is on GitHub; the one install in it that has to fail is the step naming a missing tag;
- the package scan: `npm pack`, then compare the tarball with the previous release's.
  Every new or missing file should have a reason. Nothing from `.claude-plugin/`, `hooks/`,
  `commands/`, `test/`, `dist/`, a scratch folder or a store should be in it. Search it for
  keys, email addresses, home-directory paths and people's names
  (`tools/audit/scan-personal.ts` does the same for the tracked tree);
- the upgrade and the rollback, below.

## 3. The single binaries

After the last change to `src/`, on macOS, in the clean clone:

```sh
bun tools/single-binary/build.ts --release
```

Commit the `.claude-plugin/binaries.json` it writes on the release branch. Copy the `.gz`
files and `SHA256SUMS` from `dist/single-binary/<version>/` into `single-binary/` in a
release folder outside the clone. The builds aren't byte-reproducible, so the files uploaded at publish have to be
these ones. Any later change to `src/` means building again. Details:
[single-binary.md, "Releasing"](single-binary.md#releasing).

## 4. Pack

`npm pack` from a clean clone at the release head, after `binaries.json` is committed. Keep
the tarball in the release folder with the commit it was packed from, its sha256, and a
`release-notes.md` (the version's CHANGELOG entry). Packing the same commit twice gives the
same hash. Then open the release PR.

## 5. Publish

1. `npm publish <tarball> --otp=<code>`.
2. Tag the commit the tarball was packed from, and push the tag:

   ```sh
   git tag -a v<version> <packed commit> -m "counterparts <version>"
   git push origin v<version>
   ```

   Use the packed commit rather than the PR's merge commit, unless their trees are identical.
3. Merge the release PR. Once it's on master, master's marketplace entry names the new tag,
   so `/plugin install` fails at the clone until the tag is pushed. Push the tag and merge
   the release PR close together, tag first.
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
   new version.

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
