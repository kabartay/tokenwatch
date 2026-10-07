# Tokenwatch

Shows your Claude Code session (5h) and weekly usage quota in the VS Code status bar, e.g.:

```
5h 42% · wk 18%
```

## How it works

- Reads your existing Claude Code login: the macOS Keychain item `Claude Code-credentials`
  on macOS, or `~/.claude/.credentials.json` elsewhere.
- Polls the same (undocumented) usage endpoint that `/usage` in Claude Code uses,
  `https://api.anthropic.com/api/oauth/usage`, on an interval (default 60s).
- The token never leaves your machine except in requests to `api.anthropic.com`.
- If the endpoint is unreachable or its response shape doesn't match what this
  extension expects, it falls back to an estimate of tokens used today from
  your local `~/.claude/projects/**/*.jsonl` session logs. That fallback shows
  *consumption*, not *remaining quota* — the plan limits are only known server-side.

**This is unofficial and uses an undocumented endpoint.** Anthropic can change or
remove it without notice, which would break the status bar display (it will fall
back to the local-log estimate, or show an error).

## Install

Download the latest `.vsix` from [Releases](../../releases) and either:

```bash
code --install-extension tokenwatch-*.vsix
```

or use `./install.sh` to grab the latest release and install it in one step, or
use the Extensions panel → `…` → "Install from VSIX…".

## Develop

```bash
npm install
npm run compile
```

Then press F5 in VS Code to launch an Extension Development Host with it loaded.

## Configuration

| Setting | Default | Description |
|---|---|---|
| `claudeUsage.pollIntervalSeconds` | `60` | How often to poll usage |
| `claudeUsage.warnThresholdPercent` | `80` | Status bar turns to a warning color at/above this percent |

## Release

```bash
git tag v0.1.0
git push --tags
```

The `release.yml` workflow builds the `.vsix` and attaches it to a GitHub Release.

## License

MIT
