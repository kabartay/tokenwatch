# Changelog

All notable changes to Tokenwatch. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/).

## [Unreleased]

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

[Unreleased]: https://github.com/kabartay/tokenwatch/compare/v0.2.1...HEAD
[0.2.1]: https://github.com/kabartay/tokenwatch/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/kabartay/tokenwatch/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/kabartay/tokenwatch/releases/tag/v0.1.0
