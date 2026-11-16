// Time spent in Herdr's terminals, as heartbeats: what the editor plugins
// send for a file, sent here for the folder of the terminal someone is using.
//
// Herdr raises no events; a mod is drawn again whenever its live data
// changes, and that data includes each terminal's foreground program. So
// activity is a change in the footprint of the focused terminal:
//
//   · another terminal took focus,
//   · its folder changed (cd),
//   · a program started or finished in it (the foreground pid),
//   · an agent in it was given a turn (the core counts them),
//   · Herdr came back to the front.
//
// Keystrokes and what is on screen are never seen; the mod cannot see them,
// and should not. Time spent typing into one long-running program (an editor
// open for an hour) is therefore only covered between such changes — the
// same gap the VS Code extension has for its terminal.
//
// Only terminals on this computer count: the CLI that names projects runs
// here, and a folder on another machine means nothing to it.

import { focused, spaces, terminals, window } from "herdr";
import { heartbeat } from "./data.js";

// One heartbeat per folder and category per interval, unless either changes:
// the VS Code extension's rule (tokitoki-vscode/src/throttler.ts).
const THROTTLE_MS = 2 * 60 * 1000;

// The folder of the focused terminal, when it is on this computer.
export function localFolder() {
  const f = focused();
  if (!f?.cwd) return null;
  return spaces().find((s) => s.id === f.space)?.machine ? null : f.cwd;
}

// What someone at the focused terminal leaves behind, or null when nobody is
// at a terminal here (Herdr in the back, a mod pane focused, another machine).
function footprint() {
  const cwd = localFolder();
  const address = focused()?.terminal;
  if (!cwd || !address || !window()?.active) return null;
  const t = terminals().find((x) => x.address === address);
  return {
    key: [address, cwd, t?.foreground?.pid ?? "", t?.turn ?? 0].join("\0"),
    cwd,
    // An agent's terminal is time spent with the agent; anything else is the
    // same coding an editor reports.
    category: t?.status ? "ai coding" : "coding",
  };
}

// Module state, shared by every copy of the mod: two strips on screen still
// see one person, and send one heartbeat.
let seen = null;
let sent = { key: "", at: 0 };

// Called on every render of the strip. Cheap when nothing changed.
export function track(cmd) {
  const now = footprint();
  const moved = now && now.key !== seen;
  seen = now?.key ?? null;
  if (!moved) return;

  const at = Date.now();
  const key = `${now.category}\0${now.cwd}`;
  if (key === sent.key && at - sent.at < THROTTLE_MS) return;
  sent = { key, at };
  heartbeat(cmd, { folder: now.cwd, category: now.category, at });
}
