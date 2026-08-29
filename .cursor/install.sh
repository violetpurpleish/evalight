#!/usr/bin/env bash
set -euo pipefail

# Evalight uses Bun (package manager + JS runtime) and a JDK for
# shadow-cljs. The default Cloud Agent image already ships a JDK and
# Chrome (used by the layout / e2e tests), so we only need to add Bun.
# Pin the version the repo declares in package.json ("packageManager").
BUN_VERSION="bun-v1.4.0"
if ! command -v bun >/dev/null 2>&1; then
  curl -fsSL https://bun.sh/install | bash -s "$BUN_VERSION"
fi
export PATH="$HOME/.bun/bin:$PATH"

# Expose bun on the default PATH so terminals/start find it in any shell.
# Guarded because sudo may be unavailable on some base images.
if command -v sudo >/dev/null 2>&1; then
  sudo ln -sf "$HOME/.bun/bin/bun" /usr/local/bin/bun 2>/dev/null || true
  sudo ln -sf "$HOME/.bun/bin/bunx" /usr/local/bin/bunx 2>/dev/null || true
fi

# Install JS dependencies. The postinstall hook removes nested @codemirror
# copies; without it the editor fails with "multiple instances of
# @codemirror/state".
bun install

# Prime the Maven cache (shadow-cljs dependencies) and produce public/js so
# `bun run dev` and `bun run test` are ready on first use.
bun run release
