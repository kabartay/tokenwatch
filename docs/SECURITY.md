# Security and privacy

Tokenwatch handles your Claude Code login, so this page states exactly what it reads, sends,
stores and logs.

## What it reads

| Data | Where from | Used for |
| --- | --- | --- |
| Claude Code credentials | **macOS:** the Keychain item `Claude Code-credentials`, read by running `security find-generic-password -s "Claude Code-credentials" -w` (no shell). **Elsewhere, or if that fails:** `~/.claude/.credentials.json`. | Only the access token is used. The stored record also holds the refresh token, which is read along with it but never used. |
| Quota utilization and reset times | `GET https://api.anthropic.com/api/oauth/usage` | The quota part of the status bar. |
| Session transcripts | `~/.claude/projects/**/*.jsonl` | These files contain your conversations. Tokenwatch extracts only token counts, model ids, timestamps, message and request ids, and whether a reply came from a subagent. It uses them for `ctx` (the newest session in this window's folders, read every 15 seconds) and, when live quota is unavailable, to count today's tokens. |

## Where data goes

- The access token is sent **only** to `api.anthropic.com`, over HTTPS, in the
  `Authorization` header. If you set VS Code's `http.proxy`, the request goes through that
  proxy like any other VS Code extension traffic.
- The token is read again for every request and kept in memory only while that request runs.
- Nothing from your transcripts leaves your machine.
- There is no telemetry or analytics, and no other network call.

## What it stores

Besides the log (below), Tokenwatch stores one small record in VS Code's extension storage
(`globalState`, key `tokenwatch.lastQuota`):

- the last usage response (percentages and reset times),
- when it was fetched,
- the time a rate-limit backoff ends.

This lets a reloaded window show your numbers at once without sending a request. It never
contains the token.

## What the log contains

The **Tokenwatch** output channel, which VS Code also saves under its logs folder, records:

- the status bar's one-line summary, on each quota refresh and whenever `ctx` changes;
- request errors, with the HTTP status, up to 200 characters of the server's error response,
  and the `Retry-After` value when there is one;
- when the endpoint's reply isn't recognised, up to 1,000 characters of that reply;
- rate-limit notes (`Backing off polling for 180s…`, `Manual refresh skipped…`);
- when no session is found, the paths of the folders open in the window
  (`Context: no Claude Code session found for [/Users/you/project]`);
- at Debug level only, what was restored after a reload.

It **never** contains the access token or the refresh token. A unit test
(`src/test/application/usageService.test.ts`) checks this for every refresh outcome. Before
pasting log lines into an issue, check them for folder paths or response bodies you'd rather
not share.

## What it doesn't do

- It doesn't use the refresh token, and never writes to the Keychain or the credentials file.
- It doesn't send anything anywhere except the one request above.
- It has no runtime dependencies. All the code that runs is in [`src/`](../src), compiled.

## Reporting a vulnerability

Please report security issues privately through
[GitHub's private vulnerability reporting](https://github.com/kabartay/tokenwatch/security/advisories/new),
not as a public issue.
