# Tokitoki for Herdr

A mod for the [Herdr](https://herdr.dev) desktop app: today's coding time and
tokens from [tokitoki.dev](https://tokitoki.dev) as a slim bar under your
terminals. Click the bar for a short popup: today's two numbers, the week, and
a button to the dashboard.

## The Tokitoki CLI

The numbers come from the Tokitoki CLI, found the way the editor extensions
find it: `~/.tokitoki/bin/tokitoki`, the copy every Tokitoki client shares.

**If there is none, the mod installs it, once** — on macOS, Linux and Windows, the way
WakaTime's plugins fetch their CLI. What that does, exactly:

- macOS and Linux: downloads `https://tokitoki.dev/install.sh` to a temp file
  and runs it with `TOKITOKI_INSTALL=cli` — but only if the script says it
  supports that switch, so an older installer can never do a full setup here;
- Windows: runs `https://tokitoki.dev/install.ps1` in Windows PowerShell
  (`Invoke-WebRequest`, then `Invoke-Expression`);
- either way the script downloads the CLI for your platform, checks its
  SHA-256, confirms it runs, and moves it to `~/.tokitoki/bin/tokitoki`;
- that is all: no background service, no `PATH` or shell rc change, no key
  prompt. (Run without the switch, `install.sh` is the full Linux setup for
  people.)

A failed attempt is tried again an hour later, not on every refresh. Set
`AUTO_INSTALL = false` in `mods/tokitoki/env.js` to turn it off; the strip
then just says how to install the CLI.

## Time in the terminals

The mod reports the time you spend in Herdr's terminals the way the editor
plugins report time in a file: as heartbeats (`tokitoki heartbeat --editor
herdr`), for the focused terminal's folder, filed under the project around it.

Herdr gives mods no events, but redraws them whenever its live data changes,
so a heartbeat goes out when, in the focused terminal on this computer and
with Herdr in front:

- another terminal takes focus, or you `cd`;
- a program starts or finishes (its foreground process changes);
- an agent is given a turn;
- Herdr comes back to the front.

At most one per folder every two minutes, as in the editor plugins. A
terminal running an agent is filed as `ai coding`, any other as `coding`.

What it never reads: your keystrokes, the screen, the commands themselves.
So, like the VS Code extension's terminal, a long stretch inside one program
(an editor open for an hour) is only covered between such changes. Terminals
on other machines are not tracked.

The only other thing the mod writes is the API key you paste into its popup,
which it saves with `tokitoki set key` and does not keep, log or show.
Scanning AI logs and uploading is the job of whatever syncs on your machine
(an editor plugin, the desktop app, or `tokitoki service install`).

| You see | Because |
|---|---|
| time · project · tokens | CLI and API key are set. The figure is the account's today (every machine); the project is the focused terminal's folder, named by the CLI. |
| time · tokens | CLI is there, no key. The numbers are this machine's; paste a key into the popup, or follow its link to get one. |
| **Installing Tokitoki…** | No CLI found; the mod is fetching it. |
| **Set up Tokitoki** | No CLI, and it could not be installed (no network, or turned off). |

A terminal on another machine has no project in the strip: the CLI that names
projects runs here.

## Languages

English, Japanese and Chinese, following the system's language (macOS:
the first preferred language; Linux: `LANGUAGE`, `LC_ALL`, `LC_MESSAGES`,
`LANG`; Windows: the display language). Anything else is English. Herdr has
no language setting of its own.

## Install

Ask your agent in Herdr:

```text
Add the Herdr mod github.com/tokitoki-dev/tokitoki-herdr to my status bar
```

Or by hand, from a clone of this repository:

```sh
make install
herdr-app do mod.open '{"name":"tokitoki"}'
```

The first copies the mod into `~/.config/herdr-app/mods/tokitoki`, which
Herdr loads while it runs. The second opens its popup once, and the popup
puts the strip at the right end of Herdr's status line.

Herdr's own layouts (`main`, the one you start with, among them) are
read-only, so on one of them the popup first makes a copy, the way Herdr asks
for any change to its layouts (`layout.clone`, as `main-tokitoki`), switches
to it and says so. That is also why the mod cannot simply appear: Herdr docks
a new mod only into a layout of your own. It does this once; take the strip
out and it stays out.

The block it adds, should you want it elsewhere or in another layout:

```json
{ "id": "tokitoki", "type": "block", "size": { "px": 320 }, "content": { "mod": "tokitoki" } }
```

320 px holds the longest the strip gets (a project name is cut short past
120 px). Herdr sizes blocks in pixels or shares, not to their content, so the
block keeps its width; only the figures themselves react to the pointer.

To remove it, delete `~/.config/herdr-app/mods/tokitoki` and the block (or
switch back to `main` and delete `layouts/main-tokitoki.json`).

## Develop

```sh
make dev      # install against a local build
make check    # load the mod once and report what's wrong
```

`make dev` installs the mod the way the editor plugins' dev builds run: the
CLI from `~/.tokitoki-dev/bin` (what `make` in tokitoki-cli builds), the site
on `http://localhost:9093`, and no auto-install, so it never runs or fetches
the release CLI. `make install` switches back. Both are overridable like the
editor plugins' builds: `make dev TOKITOKI_BASE_URL=http://localhost:3000`.

Herdr reloads the mod in place whenever a file under
`~/.config/herdr-app/mods/tokitoki` is saved. The mod API is described in `~/.config/herdr-app/AGENTS.md`.
