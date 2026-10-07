# Tokenwatch

[![CI](https://github.com/kabartay/tokenwatch/actions/workflows/ci.yml/badge.svg)](https://github.com/kabartay/tokenwatch/actions/workflows/ci.yml)
[![Release](https://github.com/kabartay/tokenwatch/actions/workflows/release.yml/badge.svg)](https://github.com/kabartay/tokenwatch/actions/workflows/release.yml)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![VS Code](https://img.shields.io/badge/VS%20Code-%5E1.85.0-blue.svg)](package.json)
[![Status](https://img.shields.io/badge/status-unofficial-orange.svg)](#how-it-works)

**Your Claude Code session and weekly quota, live in the VS Code status bar.**

```
5h 42% · wk 18%
```

No more typing `/usage` mid-flow to find out if you're about to get rate-limited.

## How it works

- Reads your existing Claude Code login — the macOS Keychain item `Claude Code-credentials`,
  or `~/.claude/.credentials.json` on other platforms. No separate sign-in.
- Polls the same endpoint `/usage` reads inside Claude Code
  (`https://api.anthropic.com/api/oauth/usage`), on an interval (default 60s).
- Your token never leaves your machine except in requests to `api.anthropic.com`.
- If that endpoint is unreachable, or its response shape doesn't match what this extension
  expects, it falls back to an estimate of tokens used today from your local
  `~/.claude/projects/**/*.jsonl` session logs. That fallback shows *consumption*, not
  *remaining quota* — the plan limits themselves are only known server-side.
- The status bar item turns to a warning color once either quota crosses a configurable
  threshold (default 80%).

**This is unofficial and relies on an undocumented endpoint.** Anthropic can change or remove
it without notice, which would break live quota numbers (Tokenwatch falls back to the local
estimate, or shows a clear error, rather than silently going stale).

## Install

Grab the latest `.vsix` from [Releases](https://github.com/kabartay/tokenwatch/releases) and
either:

```bash
code --install-extension tokenwatch-*.vsix
```

or run `./install.sh` to download and install the latest release in one step, or use the
Extensions panel → `…` → **Install from VSIX…**.

## Configuration

| Setting | Default | Description |
| --- | --- | --- |
| `claudeUsage.pollIntervalSeconds` | `60` | How often to poll usage |
| `claudeUsage.warnThresholdPercent` | `80` | Status bar turns to a warning color at/above this percent |

## Develop

```bash
npm install
npm run compile
```

Press `F5` in VS Code to launch an Extension Development Host with it loaded. `npm run watch`
recompiles on save.

## Release

```bash
git tag v0.1.0
git push --tags
```

The `release.yml` workflow builds the `.vsix` and attaches it to a GitHub Release.

## License

MIT
