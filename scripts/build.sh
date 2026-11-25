#!/bin/sh
# Build everything the plugin runs: the keytap helper, and (when iTerm2 and
# python3 are available) a Python env for the optional iTerm2 effects bridge.
set -eu

root=$(cd "$(dirname "$0")/.." && pwd)

sh "$root/scripts/build-keytap.sh"

if [ -d /Applications/iTerm.app ] && command -v python3 >/dev/null 2>&1; then
  if [ ! -x "$root/bin/pyenv/bin/python" ]; then
    python3 -m venv "$root/bin/pyenv"
  fi
  "$root/bin/pyenv/bin/pip" install --quiet --disable-pip-version-check "iterm2==2.10"
  echo "built iTerm2 bridge env at $root/bin/pyenv"
else
  echo "skipping iTerm2 bridge (iTerm2 or python3 not found)"
fi
