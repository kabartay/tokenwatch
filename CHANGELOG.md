# Changelog

All notable changes to Tokenwatch. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Fixed

- A 429 from the usage endpoint no longer retries on the normal poll interval, which could
  draw another 429 immediately. It now backs off, honouring a `Retry-After` header when the
  server sends one and otherwise waiting 180s. Manual refreshes are unaffected.

### Added

- Mini progress bars in the status bar: `5h ▰▱▱▱▱ 9% · wk ▰▰▱▱▱ 41%`.
- Session reset countdown in the status bar: `↻4h 8m`.
- Pace projection in the tooltip: "~45% at reset", or "runs out in 1h 20m".
- Pace-aware warnings: yellow text when a window will run out before it resets, amber when
  that's under an hour away.
- Settings `tokenwatch.statusBarStyle` (`bars` or `compact`) and `tokenwatch.showResetCountdown`.
- Context size item, `ctx ▰▰▱▱▱ 29%`: how full the context window is in the latest Claude Code
  session started in this window's folder, read from its transcript every 15 s. The tooltip
  shows "291k of 1M tokens", the model and the time of the last reply.
- Setting `tokenwatch.contextWindowTokens`: context window size per model (exact id, prefix
  or `"*"`), with 200k/1M inference for unlisted models. Setting `tokenwatch.showContext`.

### Changed

- The tooltip is a table with a usage bar, pace and exact reset time for each window.
- Notifications and log lines use `↻4h 8m` instead of `(resets in 4h 8m)`.
- The ESLint config is written in TypeScript.

## [0.3.0] — 2026-10-07

### Added

- Extension icon.
- Documentation in `docs/`: architecture, the usage endpoint, troubleshooting and development.
- `SECURITY.md` describing exactly what data is read, sent and logged.
- ESLint with type-aware rules, a coverage script, Dependabot and a bug report form.

### Changed

- The refresh decision moved into a VS Code-independent `UsageService`, so every branch is
  now unit-tested. Tests went from 22 to 35, including real HTTP tests of the usage client.
- Requests send `User-Agent: tokenwatch`.

### Fixed

- In the local fallback, log entries with non-string ids could all be counted as one
  duplicate.

## [0.2.1] — 2026-10-07

### Added

- **Tokenwatch: Show Log** command, and a log of each refresh outcome. The token is never
  logged.

### Changed

- **Tokenwatch: Refresh Claude Usage** shows the result in a notification. Clicking the
  status bar item still refreshes quietly.

### Fixed

- The Keychain read waits up to 60 s, so answering a macOS access prompt no longer times out
  into a false "log in".

## [0.2.0] — 2026-10-07

### Changed

- **Breaking:** settings renamed from `claudeUsage.*` to `tokenwatch.*`.
- Code split into a tested core and a thin VS Code layer.

### Fixed

- The access token is read from `claudeAiOauth`, where Claude Code stores it.
- The weekly window (`seven_day`, `resets_at`) is parsed.
- Requests send the required `anthropic-beta` header.
- The local fallback is incremental and de-duplicated: about 4 s per poll down to about 40 ms.

## [0.1.0] — 2026-10-07

- Initial release.

[Unreleased]: https://github.com/kabartay/tokenwatch/compare/v0.3.0...HEAD
[0.3.0]: https://github.com/kabartay/tokenwatch/compare/v0.2.1...v0.3.0
[0.2.1]: https://github.com/kabartay/tokenwatch/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/kabartay/tokenwatch/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/kabartay/tokenwatch/releases/tag/v0.1.0
