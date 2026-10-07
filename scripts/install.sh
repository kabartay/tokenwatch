#!/usr/bin/env bash
# Downloads the latest Tokenwatch release and installs it into VS Code.
# Usage: scripts/install.sh [owner/repo]    Requires: gh (authenticated), code.
set -euo pipefail

REPO="${1:-kabartay/tokenwatchclaude}"

for cmd in gh code; do
  command -v "$cmd" >/dev/null || { echo "error: '$cmd' not found on PATH" >&2; exit 1; }
done

tmpdir="$(mktemp -d)"
trap 'rm -rf "$tmpdir"' EXIT

echo "Downloading latest release of $REPO ..."
gh release download -R "$REPO" -p '*.vsix' -D "$tmpdir"

vsix=("$tmpdir"/*.vsix)
code --install-extension "${vsix[0]}" --force
echo "Installed $(basename "${vsix[0]}"). Reload VS Code windows to pick it up."
