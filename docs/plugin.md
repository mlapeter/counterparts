# Counterparts as a Claude Code plugin (2026-10-09)

Status: shipped since 0.3.13; 0.3.14 adds the single binary for computers with no Bun or
Node, 0.3.15 the sidebar mod, 0.3.16 brings back the first-run line, 0.3.17 the sidebar's
v0.2, and 0.3.18 the first meeting, `/counterparts:dashboard`, `/counterparts:meet`,
`/counterparts:uninstall` and the bundle for Anthropic's directory (below). It installs from
this repository's marketplace, at the tag the marketplace entry pins (`v0.3.18`), once that
tag is pushed (below, "Releasing: move the pin"). It is not submitted to the plugin
directory yet; that is the owner's call.

## What it is

The repository root is the plugin. Claude Code reads four things from it:

| File | What it does |
| :- | :- |
| `.claude-plugin/plugin.json` | The manifest: name `counterparts`, version (kept equal to `package.json`), and the MCP server, declared inline |
| `.claude-plugin/marketplace.json` | A one-plugin marketplace, so `mlapeter/counterparts` can be added as a marketplace. Since 0.3.22 its entry names the plugin's own repository, `counterparts-ai/counterparts-plugin` (generated from this one, below "The bundle"), at a release tag, not master (below, "Releases only") |
| `hooks/hooks.json` | The five events `counterparts install` wires: SessionStart, UserPromptSubmit, Stop, SessionEnd, PreCompact; and, under `"modules"`, the sidebar mod (`hooks/sidebar/`, see its `NOTES.md`) |
| `commands/doctor.md` | `/counterparts:doctor`, because a plugin install puts no `counterparts` on PATH |
| `commands/dashboard.md` | `/counterparts:dashboard`, for the same reason: `counterparts dashboard`, as a background task of the session |
| `commands/uninstall.md` | `/counterparts:uninstall`: shows `counterparts uninstall --json`'s plan, asks keep or delete, runs `--keep-memories --json` for a keep; a delete it hands to the person, as a command to type at a terminal with Claude Code closed. Its grant allows the plan and the keep call and nothing else |

Every hook and the server run `sh ${CLAUDE_PLUGIN_ROOT}/src/adapters/plugin-run.sh hook|mcp`.
That launcher finds a runtime (below) and runs the same entry points the npm bins run.

Why the root, and why it leaves npm alone:

- Claude Code copies only the plugin folder, and every path a plugin runs must be
  inside it. At the root, the sources are already inside it.
- None of `.claude-plugin/`, `hooks/` or `commands/` is in `package.json#files`, so
  none of the plugin's own files reaches the npm tarball. Its runtime code does,
  because it is under `src/`: `adapters/plugin.ts`, `adapters/host-wiring.ts`,
  `adapters/mcp/stood-down.ts` and the launcher `adapters/plugin-run.sh`, and the npm
  hook and server import the first two. On the npm path that costs one check (is
  `CLAUDE_PLUGIN_ROOT` this very package? Without the variable, no file is read) and
  about a millisecond of module load. `test/plugin.test.ts` runs the npm-wired hook
  and server with the plugin also installed, and with an inherited
  `CLAUDE_PLUGIN_ROOT`, and holds their output unchanged.
- There is no root `.mcp.json`. One would also be project-scope MCP config for every
  Claude Code session opened in this repository. The server is declared inline in
  `plugin.json` instead.
- There is no top-level `bin/`. Claude Code puts a plugin's `bin/` on PATH, but chat
  and Cowork refuse to install a plugin that has one.
- The sidebar mod is in the same `hooks/hooks.json`, as
  `"modules": ["./sidebar/hooks/register.tsx"]` beside `"hooks"`, and the manifest
  names its state contract (`"types"`). `claude plugin validate` accepts both
  together. A `-p` load registers the five command hooks and the module side by
  side. The mod draws even when the classic hooks and the server stand down for
  an npm install. Its checks are `sh hooks/sidebar/check.sh`; `bun test` skips
  its tests (`bunfig.toml`, `root = "./test"`).

## How it behaves

**Runtime.** The launcher tries these in order:

1. `COUNTERPARTS_RUNTIME`, if it is set.
2. Bun 1.3+ (PATH, `$BUN_INSTALL/bin`, `~/.bun/bin`, Homebrew).
3. Node 22.15+ (PATH, Homebrew, `/usr/local`, Volta, nvm, fnm, asdf, mise). An older
   Node is skipped.
4. **The single binary**: one prebuilt Counterparts program for this platform and
   version, kept at `$CLAUDE_PLUGIN_DATA/bin/<version>/counterparts`. macOS and Linux
   (glibc) only: not Windows yet.

Bun runs with `--no-env-file` and `--config=<the shipped empty-bunfig.toml>`, so a
project's `.env` can't redirect the memory and its `bunfig.toml` `preload` can't run
inside it. The single binary takes neither flag: it is built with both loads off.

**No runtime at all.** The plugin downloads that binary once, in the background, over
HTTPS, from this version's GitHub release. It checks the download against the sha256s
in `.claude-plugin/binaries.json`, which ship inside the plugin, and runs nothing until
both checks pass. It re-checks the kept program too: the whole file at each server
start, a stamp of it at every hook. Meanwhile:

- the first SessionStart says Counterparts is getting ready (about 55–75 MB, from
  github.com/mlapeter/counterparts releases) and that memory starts in the next session;
- every other hook exits 0 quietly;
- the server answers with no tools and says the same in its instructions.

A failed download gets one line and is retried at a later session start.
`COUNTERPARTS_BINARY_DOWNLOAD=off` forbids it. The person is then told what to install,
as before the binary existed, and the server exits 127 with that line on stderr. The whole
mechanism is in [single-binary.md](single-binary.md).

Claude Code's native binary can't stand in as a runtime: `BUN_BE_BUN=1` is ignored
(measured on 2.1.295).

**First run, no terminal.** If `~/.counterparts/claude-code.json` doesn't exist, the
first plugin process to start runs `counterparts install --no-connect` and drops its
output. That writes the store and its configuration and nothing of the host's. A lock
in the temp directory makes the hook and the server, which start together, produce
one install between them. Whichever one makes it also leaves a small notice beside
the lock, and the session's first SessionStart takes it: the wake then carries one
line, "Counterparts is set up: a memory that stays on this computer, in ~/.counterparts.
(Daily tidy-up, called dreaming, is on; say "no dreams" to turn it off.)", once. This matters
because the server is usually first: with the sidebar's hooks module, Claude Code
runs the SessionStart command after the server's install has finished. A plugin hook
that stands down for the npm install takes the notice without saying it. This is
skipped if a configuration was named, or if `COUNTERPARTS_REQUIRE_EXPLICIT_DIR` is set.

**The memory isn't in the plugin's data directory.** Claude Code deletes
`~/.claude/plugins/data/<id>/` on uninstall. The store lives where the npm install
puts it, `~/.counterparts/store`, so uninstalling the plugin leaves the memory alone.
It also means moving between the two installs moves nothing.

**Both installs at once.** Claude Code runs hooks from settings and from plugins
side by side. It drops a plugin's MCP server as a duplicate only when the command is
identical, and ours never is. So when the npm wiring is live, the plugin stands down:

- Hooks: if a live hook of ours is in user, project or local settings, the plugin's
  hooks exit at once. At the first SessionStart that finds both, the person sees one
  line about it. For a real install (under Claude Code's plugins directory, or the
  path `installed_plugins.json` records): "installed twice … Keeping one install is
  simpler, and nothing is lost either way: to keep only the plugin, run `counterparts
  disconnect` in a terminal and restart Claude Code; to keep only the npm install, run
  `/plugin uninstall counterparts@<marketplace>`" (the marketplace read off the
  install's path; `plugin.ts#keepOne`). The server's `instructions` carry the same two
  ways out, as something for the person, if it comes up. For a plugin run from a folder
  (`claude --plugin-dir <checkout>`): "running from a folder … as expected. Nothing to
  do." It never suggests `disconnect` there: that would leave the live memory wired to
  a development copy, and every session started without `--plugin-dir` memoryless.
- Server: if a live `counterparts` server is registered in user or local scope, the
  plugin's server answers the protocol with no tools. It puts the reason in
  `instructions`, so `/mcp` shows connected, not failed.
- An npm entry is dead when its runtime or script is gone. Nobody stands down for
  a dead entry; the plugin runs and names the stale lines.
- "A hook of ours" is read by the script it runs (`adapters/claude-code/bin/hook.ts`, its
  `.mjs` shim, `counterparts-hook`, or the single binary's `hook`), whatever flags
  come before or after `run`. A plugin from before 0.3.14 read only the flags it
  knew, missed the line 0.3.14's `connect` writes, and didn't stand down: two wakes,
  two recall blocks per prompt (seen 2026-10-09). A new flag must stay one token
  (`--name` or `--name=value`) so older readers still see the script.

The rule has to live on the plugin side because npm installs already out there
can't learn about the plugin.

**A claim per event, as the backstop.** Whatever the stand-down misses, each hook
claims its event before doing anything (one row in a small database of its own,
`sessions/claims/hook-claims.sqlite` in the store, keyed by the session, the event
and the host's `prompt_id`; only claims write it, so a busy store never holds a
claim up). The first claim does the whole job: the wake, the recall, the Stop's
question, the boundary, the worker. A hook with the same key that started before the
first one finished is its twin: it exits with no output and leaves an
`adapter.hook.claim.lost` row, and doctor's "Installed twice" line counts them. A
hook with the same key that starts after the first one finished is a new event and
runs. This holds between any two versions from this one on. If the claim can't be
written, the hook delivers anyway.

**Moving from npm to the plugin:** install the plugin, then run `counterparts
disconnect` (it removes the settings hooks and the `claude mcp` registration, with
a backup) and restart Claude Code. Same store, same memories.

**Moving from the plugin to npm:** `npm i -g counterparts`, then `counterparts
install`. Once its wiring is live, the plugin stands down by itself; uninstall the
plugin to tidy up.

**doctor knows the plugin.** `/counterparts:doctor` (or `counterparts doctor`) reads
Claude Code's own record of installed plugins (`installed_plugins.json` and
`enabledPlugins`). With the plugin alone, its Claude Code line is green: "connected as
the Claude Code plugin". With both installs, the line is amber and names both ways out.
Without this, a plugin user was told "no hook of ours is connected — run `counterparts
connect`", which would have wired the host twice.

**Tool names change.** Plugin tools are `mcp__plugin_counterparts_counterparts__<tool>`,
not `mcp__counterparts__<tool>`. Permission rules a person wrote for the old names
won't match. The nightly run is unaffected: it starts its own server under the old
name with `--strict-mcp-config`.

## Releases only: the marketplace pins a tag

Anyone can add `mlapeter/counterparts` as a marketplace once `marketplace.json` is on
master. Claude Code reads the catalog from the default branch, so with a `./` source
an install would get whatever master holds that day. The entry names a release tag
instead:

```json
"source": { "source": "url", "url": "https://github.com/counterparts-ai/counterparts-plugin.git", "ref": "v0.3.27" }
```

Claude Code clones the repository at that tag, so a plugin install only ever gets a
released version, and each release moves the pin (below). Up to 0.3.21 the `url` was
this repository (`https://github.com/mlapeter/counterparts.git`); since 0.3.22 it is the
generated bundle's repository (below, "The bundle"), whose `main` holds the full flavor
and whose tags match this repository's. Master's marketplace is read live by everyone
who adds it, so the bundle repository's tag has to exist before the release PR that
names it merges.

**HTTPS, not a `github` source.** Up to 0.3.20 the entry was
`{ "source": "github", "repo": "mlapeter/counterparts", "ref": … }`. Claude Code clones
that kind over SSH (`git@github.com:…`), so on a computer without an SSH key GitHub
accepts, the install failed with "Permission denied (publickey)", even though
`marketplace add` itself (HTTPS) had worked (seen on the owner's machine, 2026-10-13).
A `url` source with the `https://` address clones without any key; Anthropic's own
marketplace uses that form. Checked the same day: from a fresh Claude Code home on
that same computer, the `url` entry installed v0.3.20 at its tagged commit.

**Why v0.3.13 and not v0.3.12.** 0.3.12 has no plugin files: no
`.claude-plugin/plugin.json`, no `hooks/hooks.json`, no launcher. The pin names the
first release that carries them, which is the one this change ships in. That tag
doesn't exist yet. Until it does, `/plugin install counterparts@counterparts` fails
at the clone ("Remote branch v0.3.13 not found"; the loop checks this) and installs
nothing. That is the intended state: nothing untested installs. If this change
misses 0.3.13, the pin and `FIRST_PLUGIN_RELEASE` in `test/plugin.test.ts` move to
the release it ships in.

**Between a release merging and its tag going up**, master names a tag that isn't
there. A new install fails as above. An existing install that runs `/plugin update`
gets the same clone error and keeps its copy, which stays enabled and still wakes
(measured on 2.1.295 in a throwaway home).

**No `sha`.** The entry could also name the commit, which would survive a tag being
moved or deleted. The release commit can't contain its own sha, so that would mean a
second commit after every release. Tags are not moved here, so the tag alone is
enough for now.

**No `version` in the entry.** `plugin.json`'s `version` is the one Claude Code uses
to decide that an update exists. Setting it in the entry too would only add a third
number to keep in step.

**Developing.** `/plugin marketplace add <checkout>` reads the catalog from the
checkout but still fetches the plugin from GitHub at the tag. To run the working
tree as a plugin, use `claude --plugin-dir <checkout>` in a throwaway home, or the
loop below, which installs the working tree under the pin's name.

**The directory listing** (if submitted) tracks a branch or tag of its own, set in
the portal. Point it at the same release tag and update it at each release, or it
becomes a second way to get master.

**What the listing should disclose**, because the plugin can fetch an executable:

> Counterparts runs on Bun or Node.js when either is installed. On a Mac or Linux
> computer with neither, it downloads one prebuilt Counterparts program for that computer
> (55–75 MB, from this repository's GitHub releases, over HTTPS), checks it against a
> sha256 that ships inside the plugin, and keeps it in the plugin's data folder. Nothing else is downloaded, and
> your memories never leave your computer. Set `COUNTERPARTS_BINARY_DOWNLOAD=off` to
> forbid the download.

## Releasing: move the pin

The release as a whole, in order, is in [RELEASING.md](RELEASING.md). For the plugin it
adds one edit and one tag:

1. **In the release commit**, next to `package.json`'s version: set `"version"` in
   `.claude-plugin/plugin.json` to the same version, and the entry's `"ref"` in
   `.claude-plugin/marketplace.json` to `v<version>` (its `url` stays the bundle
   repository's). `test/plugin.test.ts` fails
   until all three agree, and its message names this section.

   Then, after the last change to `src/`, on macOS, in the clean clone: run
   `bun tools/single-binary/build.ts --release`. It builds the four released single
   binaries (not Windows yet) and writes `.claude-plugin/binaries.json`. Commit that on
   the release branch, before packing. `test/single-binary.test.ts` fails while it names
   another version. Copy `dist/single-binary/<version>/` into the release folder: the
   builds aren't reproducible, so step 2 must upload these very files. Put the upload
   commands below in the PUBLISH sheet, right after the tag push
   ([single-binary.md, "Releasing"](single-binary.md#releasing)).
2. **At publish, on the owner's word**, after `npm publish`: tag the commit the tarball
   was packed from (the release folder's `COMMIT` file) and push the tag.

   ```sh
   git tag -a v<version> <commit> -m "counterparts <version>"
   git push origin v<version>
   ```

   Tag the packed commit, not the merge commit, unless the two trees are identical.
   Then push the bundle built from that commit to `counterparts-ai/counterparts-plugin`
   and tag it `v<version>` there ([RELEASING.md, 3b](RELEASING.md)): that tag is the
   one master's pin names, so until it is pushed a new install fails as above. Merge
   the release PR only after it.

   **Right after the tag, attach the binaries** to that tag's release and check them
   (the owner runs these; a release agent writes them into the sheet):

   ```sh
   gh release create v<version> --verify-tag --title "counterparts <version>" --notes-file <folder>/release-notes.md \
     <folder>/single-binary/*.gz <folder>/single-binary/SHA256SUMS
   bun tools/single-binary/verify-release.ts
   ```

   Until they're attached, a plugin user with no runtime sees "download failed" and a
   retry ten minutes later; nothing else breaks.
3. **Check**, from a throwaway home (both `HOME` and `CLAUDE_CONFIG_DIR` set to a new
   directory): `claude plugin marketplace add mlapeter/counterparts`, then
   `claude plugin install counterparts@counterparts`; `claude plugin list` shows the
   new version.

## The automated loop

`tools/plugin-loop/run.sh [workdir]` runs everything below in a throwaway HOME and
refuses the real one. Before anything could fire a hook, it proves isolation three
ways: `plugin list` shows none of the real plugins, `auth status` names the throwaway
config directory, and a `--debug-file` names every settings path Claude Code looked
at. Then it:

1. snapshots the working tree into a git repository and validates it
   (`claude plugin validate`);
2. reads the pin from the repository's `marketplace.json` (our GitHub URL at a release tag),
   tags the snapshot with it inside its own throwaway clone, and adds one commit past
   the tag;
3. adds the repository's own `marketplace.json` from its path;
4. points an entry at a tag that doesn't exist and checks the install fails and
   installs nothing (master before the first plugin release);
5. installs through a git source at the pin, the same path a GitHub source takes:
   clone at the tag, copy into `~/.claude/plugins/cache`, dependency install from
   `bun.lock`. It checks the install is the tagged working tree and not the commit
   past the tag, that the cached copy has no `.git`, and that
   `counterparts-model-potion` was installed;
6. runs `claude --init-only`, which fires the plugin's SessionStart for real: first
   run, store created, wake delivered;
7. runs `claude mcp list`, where Claude Code starts the plugin's server from the
   plugin root and it connects;
8. writes a note and recalls it through the plugin's server, finds it again with the
   console, and captures a turn through the plugin's hook command into the store's
   buffer;
9. runs doctor the way `/counterparts:doctor` does: the plugin install reads as connected;
10. wires the npm hooks as well and checks there's one wake plus the stand-down line
    (`--bundle=directory`: no stand-down line, since that flavor reads no Claude Code
    file and its own entries, wired into settings, write no marker; it then also checks a
    live npm registration there stands nothing down, and that the hook, the server and
    doctor all finish with `~/.claude.json` a FIFO no read could get past); removes them
    and checks the plugin wakes on the same store;
11. uninstalls the plugin and checks `~/.counterparts` is intact.

Along the way it also checks that the sidebar's hooks module loads, `/counterparts:doctor`
is registered, and the server lists its tools.

So the loop tests the working tree, never the release the pin names. Last run: 23/23
on 2.1.296 (2026-10-11).

It never logs in. A model turn needs a login, and the loop copies no credential.

`tools/plugin-loop/run.sh --bundle [workdir]` runs the same loop on the generated bundle
(below) instead of the working tree, with npm on its PATH for the bundle's lockfile. It
also checks that the installed copy stays inside the directory's file limit with no tests
or module docs, that Bun finds the table npm installed, and what happens when the
dependency install didn't run (below). It needs a Node 22.15+ somewhere it looks (nvm,
Homebrew, `/usr/local`). Last run: 27/27 on 2.1.296 (2026-10-11).

## The bundle (for Anthropic's directory)

The directory reads the plugin folder, and here that folder is the whole repository: 800+
files against a limit of 512, with tests, docs and this repository's own `package.json`
and `bun.lock` (its dev dependencies too). So the plugin can also be generated as a folder of its own, for a
repository whose root is the plugin (planned name: `counterparts-ai/counterparts-plugin`):

```sh
bun tools/plugin-bundle/build.ts <out-dir>     # or --list to print the file set
```

The file set is traced from what Claude Code reads (`plugin.json`, `hooks/hooks.json`,
`commands/`) through the launcher and every import, and the dashboard's page from
`app.html`; no tests, no module docs, no dev tooling. It generates `plugin.json` (this
repository's, with the version from `package.json` and the directory listing fields), a
`package.json` and npm `package-lock.json` that name only `counterparts-model-potion` at
an exact version, and a README with the disclosure below. It refuses symlinks, system
files, a file over 5 MiB, or more than 512 files. `test/plugin-bundle.test.ts` holds
those rules. The listing icon is `.claude-plugin/icon.png`, carried to the bundle's root.

**Two flavors (2026-10-14).** `full` (the default) is the above: the TypeScript as it is,
started through `plugin-run.sh`; our own marketplace serves it. `--flavor directory` is
for Anthropic's directory, whose validator timed out on ~7 MB of commented TypeScript and
holds a manifest whose command is `bun` (a package manager, to it). It transpiles every
`src/**/*.ts` one for one to `.js` at the same path (Bun's transpiler: types and comments
stripped; the control and invisible characters it unescapes in strings are written back as
`\uXXXX`, since the validator holds a file with one), drops the launcher, the `.mjs` shims, Node's loader and `binaries.json`, and
generates `plugin.json`, `hooks/hooks.json` and `commands/*.md` that run the three entries
(`hook.js`, `serve.js`, `counterparts.js`) by their own path: each is written executable
and starts `#!/usr/bin/env -S bun --no-env-file --config=/dev/null --no-install`, the
shebang form of what `plugin-run.sh` passes Bun. So it needs Bun 1.3+ on the PATH Claude
Code starts with, and its README says so first. The code tells the trees apart by its own
URL (`runtime.ts#entryScript`, `#TRANSPILED`): a script it spawns is its `.js` sibling
there, and the console sets `CLAUDE_PLUGIN_ROOT` itself, as `plugin-run.sh cli` does. The
build also refuses any directory-flavor file over 256 KiB, a launcher left in the roots,
and a tree that does not mirror the sources; it warns from 490 files. It leaves out the
dashboard's 3D brain (`pages/home/brain.js`, the vendored three.js, ~670 KiB, and its
licence): the server finds no three.js on disk, says so in the page
(`<meta name="counterparts-brain" content="off">`, `server.ts#BRAIN_LIBRARY`), and the home
tab draws "Today" across the row with no request for the picture.

**The directory flavor never reads `~/.claude.json`** (owner's decision, 2026-10-14; the
validator read the file's name as a credential). One helper, `runtime.ts#readsHostUserConfig`
(false in the transpiled tree), gates every reader of it: `host-wiring.ts#npmWiring` (the
whole stand-down detection: hooks and server alike find no npm wiring, and doctor's
stood-down redirect never fires), `cli/install.ts#readHost` (doctor has no MCP clause;
`mcpRead: false`), `cli/desktop.ts#readDesktop` (no Code-tab clash) and `cli/wire.ts#readMcp`
(`notRead`: an uninstall that deletes or moves the memory asks `claude mcp remove` and
takes its answer, and with no `claude` says the line to run and counts the registration
unconfirmed, so it deletes and moves no memory; `/counterparts:uninstall`'s keep, which
removes only a registration whose program is gone, takes an npm install's `counterparts` on
PATH, or a Counterparts hook in `settings.json` that still runs, as that install still being
there, and leaves it). It still reads the settings files and
`installed_plugins.json` (doctor, uninstall, the sidebar).

**The directory flavor stands down by the npm install's marker** (2026-10-15). Until then,
with the npm install ALSO wired, it did not stand down: the per-event claim kept one wake
per event, but Claude was offered every memory tool twice (the owner, running both). Now
the npm install leaves `npm-live.json` beside the configuration (`adapters/npm-live.ts`),
and the directory flavor's hook and server read that file and nothing else:

- **What it holds:** a reading of the npm install's USER-level wiring, made by the side
  that may read Claude Code's files: the live hook's command and the settings file it is
  in, the live `-s user` server's program and script (either null when absent), the npm
  version, the writer's `CLAUDE_CONFIG_DIR`, and when it was written. Mode 0600, written to
  a temp file and renamed.
- **Who writes it:** `counterparts connect` (and `install`, which runs it) at once; the npm
  install's server at its start; the npm install's hook at every session start, and at other
  events only when it is missing, names another build, or is a day old (past the
  configuration refusals and an off or paused folder), so a prompt doesn't parse
  `~/.claude.json`. Never the plugin's processes, never a build that reads none of Claude
  Code's files. A project's wiring is not recorded: it must not stand the plugin down in
  every other project. Under a `CLAUDE_CONFIG_DIR` the file is `npm-live.<hash>.json`, one
  per Claude Code directory.
- **Who removes it:** `counterparts disconnect` and `uninstall` (first, so nothing stands
  down for wiring on its way out; if the wiring stays, the next npm hook writes it again).
  `/counterparts:uninstall`'s keep, which leaves a live npm install, leaves its marker.
- **When it stands the plugin down:** each half (hooks, server) as `hookGate` and `mcpGate`
  already decide, when the marker names that half, the program it names is still on disk
  (a stat: an npm install removed without `counterparts uninstall` stands nothing down),
  the marker is this Claude Code directory's, and it is under a week old (the hooks half:
  two days). The age bound is for npm wiring removed by hand (or a reset Claude Code)
  while the package stays: nothing refreshes the marker then, and the plugin must not stay
  silent and memoryless for good. While either npm half still runs, its next session start
  writes the truth, so a half removed by hand costs one session at most. The bound's cost:
  after a week without Claude Code, the first session may offer the tools twice (the server
  decides once, at start, and may start before the npm side refreshes it); after two days,
  the first hook events are delivered by the claim rather than a stand-down.
- An npm install from before this change writes no marker, so beside one both still run.

doctor's Claude Code line says which, from either side: npm's doctor tells the flavor by
the files at the plugin's `installPath` (`npm-live.js` there: it reads the marker) and
reads the marker itself; the bundle README says keeping one is simpler. The full flavor
keeps reading the real wiring and never looks at the marker. Not carried over: the full
flavor's `/counterparts:doctor` redirect to the npm install's doctor when standing down
(the directory flavor runs its own doctor, whose Claude Code line names both installs).
`build.ts --flavor directory --check <dir>`
rebuilds and names every file that differs from `<dir>`, with the Bun version (the
transpiled bytes depend on it). `tools/plugin-loop/run.sh --bundle=directory` installs it
through Claude Code from git and runs every step through the entries.

**Why npm's lockfile.** Claude Code installs a plugin's packages with the package
manager its lockfile names, from the user's PATH, and tries no other. Node users without
Bun far outnumber Bun users without npm, and the plugins docs recommend npm for reach.
Whichever runtime the launcher then picks reads the same `node_modules` (the loop runs
doctor under Bun on the table npm installed). A computer with neither runtime runs the
single binary, which carries its own table (`runtime.ts#bundledModelDir`,
`tools/single-binary/build.ts#embeddedFiles`).

**When the install didn't run** (no npm on PATH, the 60-second limit, offline), the plugin
still loads, and `/plugin` notes the missing packages. Then, measured by the loop:

- under Node, doctor's Recall by meaning line is amber: "its weights were not found —
  nothing will be embedded; recall still matches on words". Its fix line names
  the route for the install (`plugin.ts#installRoute`): for the plugin, `/plugin` →
  Installed → counterparts → Update now, with Node.js first where there is no npm, or
  `COUNTERPARTS_STATIC_WEIGHTS_DIR`; for the npm install, `bun add -g
  counterparts-model-potion`;
- under Bun, the same amber line. With no `node_modules` above the plugin, Bun's runtime
  auto-install would fetch the package from the npm registry into `~/.bun/install/cache`,
  unpinned and undisclosed. `src/adapters/empty-bunfig.toml`, which every Bun launch names
  (the launcher, and the runner and embedding worker the hooks start), sets
  `[install] auto = "disable"`, so nothing is fetched. It sets no registry or other package
  source. npm installs are unaffected, since their `node_modules` exists.

Since 0.3.22 installs are served from the bundle repository: the marketplace entry's
`url` is `https://github.com/counterparts-ai/counterparts-plugin.git`, with the same
`ref` (`v<version>`, tagged there). Nothing else in the entry changed, and the
marketplace keeps its name, so the plugin's data directory (`counterparts-counterparts`)
stays where it is. The full flavor is that repository's `main` and its tags; the
directory flavor sits on its `directory` branch.

## Manual checklist (needs a login or a GUI)

A. **A real session in a throwaway home.** Set both `HOME` and `CLAUDE_CONFIG_DIR`
to a new directory before `claude`, so the login lands in the throwaway config and
not the real one. Then:

- `/plugin marketplace add mlapeter/counterparts`, then
  `/plugin install counterparts@counterparts`, then restart. This installs the
  pinned release; it fails until the first plugin release is tagged. To try the
  working tree instead, start `claude --plugin-dir <checkout>`.
- The first prompt shows the "first run" line, and the reply shows the wake was read.
- Tell it something specific. Then `/counterparts:doctor` and `/mcp`: the server is
  connected, with nine tools.
- Quit, start again, and ask what it remembers.
- With the npm install also wired there, see one wake and the "installed twice" line
  (from a `--plugin-dir` checkout, the "running from a folder" line instead).

B. **Claude Desktop, Code tab.** Same plugin, installed with `/plugin` in the Code
tab or in the terminal on the same machine. This is the one to watch: a Desktop
app started from the Dock may not have the login shell's PATH. The launcher's
fixed-location search (`~/.bun/bin`, Homebrew, nvm…) is there for that case. Check
that the wake arrives and `/mcp` shows the server.

C. **Cowork.** Install from claude.ai (Customize > Plugins, adding the GitHub
marketplace), on a Cowork session that runs on this computer. Per the platform table,
Cowork loads hooks and local servers in that case. Open questions:

- Does Cowork run the `bun.lock` dependency install?
- What PATH do its hooks get?
- Does it fire all five events?

Chat (web, desktop, mobile) ignores both hooks and local servers, so Counterparts
does nothing there.

D. **`claude plugin eval`** calls the model with the user's credentials and costs
usage, so it isn't in the loop. A first case would be: seed a note through the
server, then ask about it. Grade with a `regex` grader on the noted detail, with a
no-plugin baseline arm.

E. **A machine with neither Bun nor Node** (the native installer only). Expect the
SessionStart line naming what to install. Also expect Claude Code's `/plugin` note
that the packages didn't install, because the dependency install needs `bun` on PATH
when the lockfile is `bun.lock`.

## Disclosure (draft text for the README, if this is listed)

> Counterparts runs on your computer. Its hooks read the transcript Claude Code
> keeps for each session and store memories in `~/.counterparts`. Counterparts
> itself sends nothing anywhere. Installing the plugin downloads one npm package,
> `counterparts-model-potion` (about 30 MB, a word-embedding table used to recall by
> meaning), from the npm registry. Dreaming, the nightly consolidation, asks first by
> default. If you choose `auto`, the first session of each day starts a background
> `claude -p` run: your own Claude Code and your own plan's usage, allowed only
> Counterparts' memory tools, with file, shell and web tools denied. It says so in
> one line when it starts. Saying "no dreams" in a session turns it off.
