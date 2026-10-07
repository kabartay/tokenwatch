# Tokenwatch

[![CI](https://github.com/kabartay/tokenwatch/actions/workflows/ci.yml/badge.svg)](https://github.com/kabartay/tokenwatch/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/kabartay/tokenwatch?color=blue)](https://github.com/kabartay/tokenwatch/releases/latest)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![VS Code](https://img.shields.io/badge/VS%20Code-%E2%89%A51.85-007ACC.svg?logo=visualstudiocode)](package.json)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6.svg?logo=typescript&logoColor=white)](tsconfig.json)
[![Dependencies](https://img.shields.io/badge/runtime%20deps-0-brightgreen.svg)](package.json)
[![Status](https://img.shields.io/badge/status-unofficial-orange.svg)](#caveats)

**Your Claude Code quota, live in the VS Code status bar.** Stop typing `/usage` mid-flow to
find out whether you're about to hit the wall.

```
5h 42% · wk 18%
```

Hover for reset times, click to refresh. The item turns **amber** past your warning threshold
and **red** at 100%.

## Features

- **Live session (5h) and weekly (7d) quota**, from the same source `/usage` reads.
- **Reset countdowns** in the tooltip, for example "resets in 2h 13m".
- **Zero setup.** Reuses your existing Claude Code login; nothing to paste, no API key.
- **Graceful fallback.** If live numbers are unavailable, shows today's token count from your
  local session logs instead of going stale or showing a wrong number.
- **Light on your machine and the endpoint.** Unfocused windows skip polls, the log fallback
  only reads newly appended bytes, and there are no runtime dependencies.

## Install

1. Download `tokenwatch-<version>.vsix` from the
   [latest release](https://github.com/kabartay/tokenwatch/releases/latest).
2. Install it:

   ```bash
   code --install-extension tokenwatch-*.vsix
   ```

   Or use **Extensions** → `…` → **Install from VSIX…**. If you have the `gh` CLI, `./install.sh`
   downloads and installs the latest release in one step.

> [!NOTE]
> **macOS:** on first run, macOS asks whether VS Code may read the `Claude Code-credentials`
> Keychain item. Choose **Always Allow** so you aren't asked on every poll.

There is no auto-update: re-run the install for each new release.

## Status bar states

| Shows | Meaning |
| --- | --- |
| `5h 42% · wk 18%` | Live quota. Amber at the warning threshold, red at 100%. |
| `~1.2M tok today` | Live quota unavailable; tokens logged locally today. The tooltip says why. |
| `Claude: log in` | No Claude Code login found. Run `claude` and log in. |
| `Claude usage` (red) | Nothing worked; the tooltip has the error. |

## Configuration

| Setting | Default | Description |
| --- | --- | --- |
| `tokenwatch.pollIntervalSeconds` | `60` | Seconds between refreshes (minimum 30). |
| `tokenwatch.warnThresholdPercent` | `80` | Amber at or above this percentage. |

Command palette: **Tokenwatch: Refresh Claude Usage**.

## How it works

```
CredentialStore ──token──▶ UsageApiClient ──snapshot──▶ UsageController ──state──▶ UsageStatusBar
 Keychain / file            GET /api/oauth/usage            │
                                                            └─ on failure ─▶ LocalUsageEstimator
                                                                             ~/.claude/projects/**/*.jsonl
```

1. **Credentials.** Reads the OAuth token Claude Code already stores: the macOS Keychain item
   `Claude Code-credentials`, or `~/.claude/.credentials.json` on Linux and Windows. It's
   re-read on every poll, so tokens Claude Code refreshes are picked up automatically.
2. **Live quota.** Calls `https://api.anthropic.com/api/oauth/usage`, the endpoint behind
   `/usage`, and reads the `five_hour` and `seven_day` utilization and reset times.
3. **Fallback.** If that fails, sums today's input and output tokens from your local session
   logs, de-duplicating streamed messages. This is consumption only, because plan limits are known
   only to the server.

### Privacy

Your token is held in memory for the duration of one request and sent **only** to
`api.anthropic.com`. Nothing is logged, cached to disk, or sent anywhere else, and there are no
runtime dependencies to audit. The whole extension is about 850 lines of documented TypeScript in
[`src/`](src).

## Caveats

**Tokenwatch is unofficial and not affiliated with Anthropic.** It relies on an undocumented
endpoint that can change or disappear without notice. If that happens, the status bar
switches to the local-log fallback, and the tooltip says why.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| `Claude: log in` although you are logged in | macOS: allow Keychain access (see above). Elsewhere: check `~/.claude/.credentials.json` exists. |
| Tooltip says *login rejected* | Your token expired. Run any `claude` command to refresh it, then click the item. |
| Tooltip says *unrecognised response* | The endpoint changed shape. Please [open an issue](https://github.com/kabartay/tokenwatch/issues). |
| Tooltip says *rate-limited* | Raise `tokenwatch.pollIntervalSeconds`. |

## Development

```bash
npm install
npm test          # compile + unit tests (node:test, no extra deps)
npm run watch     # recompile on save
```

Press `F5` in VS Code to launch an Extension Development Host with the extension loaded.

```
src/
├─ extension.ts         activate(): wires services together
├─ core/                pure logic, no `vscode` import, unit-tested
│  ├─ credentials.ts    TokenSource implementations + CredentialStore
│  ├─ usageApi.ts       UsageApiClient + response parser
│  ├─ localUsage.ts     incremental session-log estimator
│  ├─ format.ts         percent / countdown / token formatting
│  ├─ errors.ts, types.ts
├─ vscode/              VS Code integration
│  ├─ controller.ts     polling, focus handling, fallback orchestration
│  ├─ statusBar.ts      renders a UsageState
│  └─ config.ts         validated settings
└─ test/                *.test.ts
```

### Releasing

Bump `version` in `package.json`, then:

```bash
git tag v0.2.0 && git push origin v0.2.0
```

[`release.yml`](.github/workflows/release.yml) builds the `.vsix` and attaches it to a GitHub
Release.

## License

[MIT](LICENSE) © Mukharbek Organokov
