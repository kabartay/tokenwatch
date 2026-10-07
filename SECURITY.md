# Security and privacy

Tokenwatch handles your Claude Code login, so this page states exactly what it touches.

## What it reads

| Data | Where from | Used for |
| --- | --- | --- |
| Claude Code credentials (access and refresh token) | macOS Keychain item `Claude Code-credentials`, or `~/.claude/.credentials.json` | Only the access token is extracted. The refresh token is read along with it but never used. |
| Quota utilization and reset times | `api.anthropic.com/api/oauth/usage` | The status bar. |
| Session transcripts | `~/.claude/projects/**/*.jsonl` | These files contain your conversations. Tokenwatch extracts only the `usage` token counts, model id, timestamps and message ids: to show context size (`ctx %`, the latest session in this window's folder, read every 15 s), and to count today's tokens when live quota is unavailable. |

## Where data goes

- The access token is sent **only** to `api.anthropic.com`, over HTTPS, in the
  `Authorization` header. If you set VS Code's `http.proxy`, the request goes through that
  proxy like any other VS Code extension traffic.
- The token is re-read for each poll and is held in memory only while that request runs.
- **Nothing is written to disk except the Tokenwatch log and one small record in VS Code's
  extension storage**: the last usage response (percentages and reset times), when it was
  fetched, and the rate-limit backoff deadline. It lets a reloaded window show your numbers
  at once without sending a request. It never contains the token.

## What the log contains

The **Tokenwatch** output channel, which VS Code also saves under its logs folder, records:

- one line per refresh: the quota shown, or why it fell back;
- request errors, including the HTTP status and up to 200 characters of the server's error
  response;
- if the endpoint's reply isn't recognised, up to 1,000 characters of that reply.

It **never** contains the access token or the refresh token. A unit test
(`src/test/usageService.test.ts`) checks this for every refresh outcome.

## What it doesn't do

- It doesn't use the refresh token or modify your credentials.
- It doesn't send telemetry or analytics, and makes no network calls besides the one above.
- It has no runtime dependencies. All the code that runs is in [`src/`](src).

## Reporting a vulnerability

Please report security issues privately via
[GitHub security advisories](https://github.com/kabartay/tokenwatch/security/advisories/new),
not as a public issue.
