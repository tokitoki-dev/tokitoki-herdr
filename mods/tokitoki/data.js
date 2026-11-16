// Where the numbers come from: the Tokitoki CLI, the same way the VS Code
// extension uses it (tokitoki-vscode/src/tokitokiCli.ts).
//
//   · The CLI is the one every Tokitoki client on this machine shares,
//     ~/.tokitoki/bin/tokitoki — a contract documented in tokitoki-cli's
//     README (~/.tokitoki-dev for a local build, see env.js). Nowhere else:
//     `tokitoki` on PATH is a release's, which a local build must never run.
//     Not found, the mod fetches it once (installCli below), on every
//     platform Herdr runs on, the way WakaTime's plugins do; it does not
//     bundle one (six platform binaries do not belong in a folder people
//     copy), and it never updates it.
//   · This mod writes two things: heartbeats for time spent in its terminals
//     (`heartbeat`, see track.js), and the key someone pastes into the popup
//     (`set key`). The rest is read: `get key` says whether an account is
//     connected, `today` is the figure the server computes (every machine,
//     shared with the status bar of the other clients), `stats` is this
//     machine's local history for the week, `project` names a folder the
//     way heartbeats do. Scanning AI logs belongs to the clients that sync:
//     the editor plugins, the desktop apps, `tokitoki service`.
//   · Which state a reader is looking at comes from the CLI's own answers:
//     no CLI, or a CLI that says there is no key (exit 3, which it reserves
//     for exactly that).

import { exec, home, window } from "herdr";
import { SITE, DATA_DIR, AUTO_INSTALL } from "./env.js";

// How often the strip asks again. Same floor as the editor extension's.
export const REFRESH_MS = 60 * 1000;

// The exit code the CLI reserves for "no API key" (cmd/tokitoki exitNoAPIKey).
const EXIT_NO_API_KEY = 3;

// One call has no business running longer than this. `today` is the slow one:
// it gives the server 30 s (runToday) before it answers from its cache, so the
// limit sits past that — cut it off sooner and the cached account figure is
// never reached.
const TIMEOUT_MS = 40 * 1000;
const STATS_DAYS = 7;

// The download is ~11 MB over whatever connection this is: as long as Herdr
// lets an exec run (10 minutes).
const INSTALL_TIMEOUT_MS = 10 * 60 * 1000;
// A failed install is tried again after this, not on every refresh.
export const INSTALL_RETRY_MS = 60 * 60 * 1000;

// A sample, for iterating on the look without touching the account:
// "ready" | "nokey" | "nocli". Anything else runs the real thing.
export const PREVIEW = null;

export class CliError extends Error {
  constructor(what, code) {
    super(`tokitoki ${what} failed (${code})`);
    this.code = code;
  }
}

function windows() {
  return window()?.platform === "windows";
}

// The shared CLI. `home()` already carries the platform's separators.
function sharedCli() {
  const sep = windows() ? "\\" : "/";
  return [home(), DATA_DIR, "bin", windows() ? "tokitoki.exe" : "tokitoki"].join(sep);
}

function call(cmd, args) {
  return exec(cmd, args, { timeout: TIMEOUT_MS });
}

function parse(result, what) {
  if (result.code !== 0) throw new CliError(what, result.code);
  try {
    return JSON.parse(result.stdout);
  } catch {
    throw new CliError(what, "unreadable output");
  }
}

// The installers, asked for the CLI alone: verified, into ~/.tokitoki/bin, no
// service, no PATH or shell rc change (site: app/install.sh, app/install.ps1).
//
// macOS and Linux: install.sh with TOKITOKI_INSTALL=cli. The script is saved
// to a file first, for two reasons. `curl -f | sh` reports success when curl
// fails (the shell reads nothing and exits 0). And it has to be read before it
// runs: an install.sh from before the switch would ignore it and do a
// person's full setup — a service, an rc edit — so it only runs when it says,
// on a line of its own, that it knows the switch.
const INSTALLER = `${SITE}/install.sh`;
const CLI_ONLY_MARKER = "# supports: TOKITOKI_INSTALL=cli";
const FETCH_AND_RUN = [
  "set -eu",
  'f="$(mktemp)"',
  "trap 'rm -f \"$f\"' EXIT",
  'curl -fsSL "$1" -o "$f"',
  'grep -qxF "$2" "$f" || { echo "this install.sh cannot install the CLI alone" >&2; exit 3; }',
  'TOKITOKI_INSTALL=cli sh "$f"',
].join("; ");
// Windows: Windows PowerShell 5.1, which every Windows 10 and 11 has. A 404
// makes Invoke-WebRequest throw, so a missing script runs nothing. TLS 1.2 is
// switched on first for older systems that do not offer it by default.
const WINDOWS_INSTALLER = `${SITE}/install.ps1`;
const WINDOWS_FETCH_AND_RUN = [
  "$ErrorActionPreference = 'Stop'",
  "$ProgressPreference = 'SilentlyContinue'",
  "[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12",
  `Invoke-Expression (Invoke-WebRequest -UseBasicParsing -Uri '${WINDOWS_INSTALLER}').Content`,
].join("; ");

// Whether this mod may install the CLI here.
export function canInstall() {
  return AUTO_INSTALL;
}

function installCommand() {
  return windows()
    ? ["powershell", ["-NoProfile", "-NonInteractive", "-Command", WINDOWS_FETCH_AND_RUN]]
    : ["sh", ["-c", FETCH_AND_RUN, "sh", INSTALLER, CLI_ONLY_MARKER]];
}

// Installs the CLI and returns it, or null when that did not work. Whether it
// did is decided by looking for it afterwards, not by the exit code alone.
export async function installCli() {
  const [cmd, args] = installCommand();
  try {
    const { code } = await exec(cmd, args, { timeout: INSTALL_TIMEOUT_MS });
    if (code !== 0) return null;
  } catch {
    return null;
  }
  return findCli();
}

// The CLI to run, or null when there is none. `exec` rejects only when the
// program cannot start, which is exactly "not installed here".
export async function findCli() {
  const cmd = sharedCli();
  try {
    if ((await call(cmd, ["version"])).code === 0) return cmd;
  } catch {
    // Not installed.
  }
  return null;
}

// Whether an account is connected. `get key` prints the key itself, so its
// output is never looked at, kept or logged: only the exit code is.
// Any other failure is not an answer; it throws so the caller keeps what it had.
async function hasKey(cmd) {
  const { code } = await call(cmd, ["get", "key"]);
  if (code === 0) return true;
  if (code === EXIT_NO_API_KEY) return false;
  throw new CliError("get key", code);
}

// Connects the account: `set key`, as someone would run it in a terminal.
// Whether it worked is the exit code; the key itself is handed over and
// dropped, never kept, logged or shown.
export async function setKey(cmd, key) {
  try {
    return (await call(cmd, ["set", "key", key])).code === 0;
  } catch {
    return false;
  }
}

// How this mod names itself in a heartbeat, as the editor plugins do
// (`--editor` the host, `--plugin` this code).
const EDITOR = "herdr";
const PLUGIN = "tokitoki-herdr/0.0.1";

// One heartbeat for a terminal's folder. The folder is the entity: a terminal
// has no file, and the CLI files the folder under the project around it the
// way it does an editor's file. Fire and forget, like the editor plugins: the
// CLI queues what it cannot upload, and a heartbeat that fails is one sample
// of many.
export function heartbeat(cmd, { folder, category, at }) {
  call(cmd, [
    "heartbeat",
    "--entity", folder,
    "--project-folder", folder,
    "--time", (at / 1000).toFixed(3),
    "--editor", EDITOR,
    "--plugin", PLUGIN,
    "--category", category,
  ]).catch(() => {});
}

// The project the CLI files a folder's heartbeats under: a pinned `.tokitoki`
// name, the repository around the folder, or the folder itself.
export async function projectOf(cmd, folder) {
  const { project } = parse(await call(cmd, ["project", "--project-folder", folder]), "project");
  if (!project) throw new CliError("project", "empty");
  return project;
}

const lastOf = (daily) => daily[daily.length - 1];

function figures(day) {
  return { active_seconds: day?.active_seconds ?? 0, total_tokens: day?.total_tokens ?? 0 };
}

// Everything the strip and the popup show, from a handful of CLI calls.
// `project` is the focused terminal's, already named, or null.
//
// Shape: { state, date, totals, project, daily, stale } where `state` is
// "ready" (a key: today is the server's figure) or "nokey" (local figure
// only), and `date` is the day the figures are for. Failures that are not an
// answer throw.
export async function snapshot(cmd, project) {
  const scope = project ? ["--project", project] : [];
  // Independent of each other, so neither waits for the other to start.
  const [keyed, stats] = await Promise.all([
    hasKey(cmd),
    call(cmd, ["stats", "--days", String(STATS_DAYS), ...scope]),
  ]);
  const report = parse(stats, "stats");

  const local = figures(lastOf(report.daily));
  const out = {
    state: keyed ? "ready" : "nokey",
    date: report.to,
    totals: local,
    // On this machine only, and only worth showing next to the account's
    // figure: without a key the strip has nothing to put it beside.
    project: null,
    daily: report.daily.map(({ date, active_seconds }) => ({ date, active_seconds })),
    stale: false,
  };
  if (!keyed) return out;

  try {
    const today = parse(await call(cmd, ["today", ...scope]), "today");
    out.date = today.date;
    out.totals = figures(today);
    out.stale = today.stale === true;
    if (today.project) out.project = { name: today.project.name, ...figures(today.project) };
  } catch (error) {
    if (error.code === EXIT_NO_API_KEY) return { ...out, state: "nokey" };
    // The server and the CLI's cache are both out of reach: this machine's
    // own figure, marked as such.
    out.stale = true;
    if (report.project) out.project = { name: project, ...figures(lastOf(report.project.daily)) };
  }
  return out;
}

// The dashboard, signed in when the CLI can get a login link, the plain site
// otherwise (the key exists; the site can take it from there). The link
// carries a login token: it is opened and dropped, never stored or logged.
// Only a link into SITE is opened, whatever else the CLI prints.
export async function dashboardUrl(cmd) {
  if (cmd) {
    try {
      const { code, stdout } = await call(cmd, ["get", "dashboard-url"]);
      const url = stdout.trim();
      if (code === 0 && url.startsWith(`${SITE}/`)) return url;
    } catch {
      // Fall through to the site.
    }
  }
  return SITE;
}

// A made-up week for the states above, so the look can be worked on without
// connecting or disconnecting anything.
export function preview(state) {
  if (state === "nocli") return { state };
  const hours = [2.6, 4.2, 0.8, 0, 4.8, 3.6, 3.4];
  const daily = hours.map((h, i) => ({ date: `2026-11-0${i + 5}`, active_seconds: Math.round(h * 3600) }));
  return {
    state,
    totals: { active_seconds: 12204, total_tokens: 1830000 },
    project: state === "ready" ? { name: "tracklm", active_seconds: 5400, total_tokens: 900000 } : null,
    daily,
    stale: false,
  };
}
