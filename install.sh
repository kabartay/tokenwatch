#!/usr/bin/env bash
# Downloads the latest release .vsix from GitHub and installs it into VS Code.
# Usage: ./install.sh [owner/repo]   (defaults to the origin remote)
set -euo pipefail

REPO="${1:-$(git config --get remote.origin.url | sed -E 's#.*github.com[:/](.+/.+?)(\.git)?$#\1#')}"

echo "Installing latest release from $REPO ..."
tmpdir="$(mktemp -d)"
trap 'rm -rf "$tmpdir"' EXIT

gh release download -R "$REPO" -p '*.vsix' -D "$tmpdir"
vsix="$(ls "$tmpdir"/*.vsix | head -n1)"
code --install-extension "$vsix"
echo "Installed $vsix"
