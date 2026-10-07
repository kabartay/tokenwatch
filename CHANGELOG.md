# Changelog

All notable changes to Tokenwatch. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.5.1] — 2026-10-07

### Changed

- The log reads like the status bar: every entry is the one line, for example
  `5h 24% ↻2h 2m · wk 44% · ctx: 61%`. The detailed `Context: 61% (model, tokens, …)` entries
  every 15 seconds are gone; a line is written on each quota refresh and when `ctx` changes.

## [0.5.0] — 2026-10-07

### Changed

- Source reorganised into four layers, `domain/`, `application/`, `infrastructure/` and `ui/`,
  with dependencies pointing inward and enforced by ESLint. The backoff, stale-numbers and
  restore-after-reload logic moved out of the VS Code controller into a unit-tested
  `RefreshPolicy`. No change in behaviour.

## [0.4.2] — 2026-10-07

### Fixed

- **Tokenwatch: Refresh Claude Usage** now includes `ctx` in its notification, matching the
  status bar line. During a rate-limit backoff it shows your current numbers and when the next
  update is, instead of only "rate-limited".
- Clicking the item no longer blanks the line into a `Claude` spinner while it refreshes; the
  numbers stay and only the icon spins.

### Changed

- README: what each part of the line means, a colour legend, requirements, the recommended
  setting for 1M-context models, and an FAQ.

## [0.4.1] — 2026-10-07

### Fixed

- After a window reload the status bar shows your last numbers at once, instead of `~1.5M tok
  today` until the next successful poll. A reload no longer sends a request that's likely to be
  rate-limited, and no longer resets a running backoff. The last response and backoff deadline
  are kept in VS Code's extension storage (never the token).

## [0.4.0] — 2026-10-07

### Fixed

- Rate limits (429) no longer cause a loop of failed polls. Tokenwatch now backs off for at
  least 180 s, longer if `Retry-After` asks for it, and logs the header's value.
- While rate-limited, the status bar keeps the last good numbers (marked stale in the tooltip)
  instead of switching to today's local token count.
- A manual refresh during the backoff reports when the next attempt will be, instead of
  drawing another 429.

### Added

- Mini progress bars in the status bar: `5h ▰▱▱▱▱ 9% · wk ▰▰▱▱▱ 41%`.
- Session reset countdown in the status bar: `↻4h 8m`.
- Pace projection in the tooltip: "~45% at reset", or "runs out in 1h 20m".
- Pace-aware warnings: yellow text when a window will run out before it resets, amber when
  that's under an hour away.
- Settings `tokenwatch.statusBarStyle` (`bars` or `compact`) and `tokenwatch.showResetCountdown`.
- Context size, `· ctx: 29%` appended to the quota line: how full the context window is in
  the latest Claude Code session started in this window's folder, read from its transcript
  every 15 s. The tooltip adds "291k of 1M tokens", the model and the time of the last reply.
- Setting `tokenwatch.contextWindowTokens`: context window size per model (exact id, prefix
  or `"*"`), with 200k/1M inference for unlisted models. Setting `tokenwatch.showContext`.

### Changed

- The default quota poll interval is 3 minutes (was 1), and the minimum is 60 s (was 30). The
  endpoint's limit is shared with Claude Code itself. The reset countdown and `ctx` still
  update every 15 s.
- The tooltip is a table with a usage bar, pace and exact reset time for each window.
- Notifications and log lines use `↻4h 8m` instead of `(resets in 4h 8m)`.
- The ESLint config is written in TypeScript.
- Dev tooling updated: ESLint 10, `@vscode/vsce` 4, `@types/node` 26.

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

[Unreleased]: https://github.com/kabartay/tokenwatch/compare/v0.5.1...HEAD
[0.5.1]: https://github.com/kabartay/tokenwatch/compare/v0.5.0...v0.5.1
[0.5.0]: https://github.com/kabartay/tokenwatch/compare/v0.4.2...v0.5.0
[0.4.2]: https://github.com/kabartay/tokenwatch/compare/v0.4.1...v0.4.2
[0.4.1]: https://github.com/kabartay/tokenwatch/compare/v0.4.0...v0.4.1
[0.4.0]: https://github.com/kabartay/tokenwatch/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/kabartay/tokenwatch/compare/v0.2.1...v0.3.0
[0.2.1]: https://github.com/kabartay/tokenwatch/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/kabartay/tokenwatch/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/kabartay/tokenwatch/releases/tag/v0.1.0
