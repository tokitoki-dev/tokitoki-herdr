// Which Tokitoki this copy talks to: a release's, as it ships. `make dev`
// installs a copy that talks to a local build instead — the same two values
// the editor plugins stamp at build time (tokitoki-vscode/Makefile).

// The site the links open.
export const SITE = "https://tokitoki.dev";

// The CLI's directory under the home directory; the CLI is <it>/bin/tokitoki.
export const DATA_DIR = ".tokitoki";

// Fetch the CLI on its own when there is none. Set to false to leave the
// machine alone: the strip then only says how to install it. Off for a local
// build, whose CLI comes from tokitoki-cli's `make`, not from an installer.
export const AUTO_INSTALL = true;
