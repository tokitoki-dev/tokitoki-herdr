# Installs the mod into Herdr, which reloads it in place.
#
#   make install   as it ships: the release CLI in ~/.tokitoki, tokitoki.dev
#   make dev       a local build: the CLI tokitoki-cli's `make` builds into
#                  ~/.tokitoki-dev, the site on localhost:9093, no auto-install
#
# The two values are the ones the editor plugins stamp at build time
# (tokitoki-vscode/Makefile); override them the same way.

TOKITOKI_BASE_URL ?= http://localhost:9093
TOKITOKI_DATA_DIR ?= .tokitoki-dev

SRC := mods/tokitoki
DEST := $(HOME)/.config/herdr-app/mods/tokitoki
# Not env.js, which goes first: Herdr reloads on every file, and a copy must
# never run, even for a moment, against the other installation's settings.
FILES := data.js track.js i18n.js place.js main.js mod.json logo.svg

.PHONY: install dev check

install:
	mkdir -p $(DEST)
	cp $(SRC)/env.js $(DEST)/env.js
	cp $(addprefix $(SRC)/,$(FILES)) $(DEST)/

dev:
	mkdir -p $(DEST)
	printf '%s\n' \
	  '// Written by `make dev` in tokitoki-herdr; `make install` restores the release values.' \
	  'export const SITE = "$(TOKITOKI_BASE_URL)";' \
	  'export const DATA_DIR = "$(TOKITOKI_DATA_DIR)";' \
	  'export const AUTO_INSTALL = false;' > $(DEST)/env.js
	cp $(addprefix $(SRC)/,$(FILES)) $(DEST)/

check:
	herdr-app check $(SRC)
