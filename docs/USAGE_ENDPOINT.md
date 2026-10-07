# The usage endpoint

Tokenwatch reads the same data as Claude Code's `/usage` command. The endpoint is
**undocumented**. This page records what is known about it, so that when it changes the fix
is quick.

**Last confirmed working:** 2026-10-07, Tokenwatch 0.2.1, macOS.

## Request

```http
GET https://api.anthropic.com/api/oauth/usage
Authorization: Bearer <Claude Code OAuth access token>
anthropic-beta: oauth-2025-04-20
Accept: application/json
User-Agent: tokenwatch
```

The `anthropic-beta` header is required for OAuth-authenticated requests.

## Where the token comes from

Claude Code stores its login as JSON:

```json
{ "claudeAiOauth": { "accessToken": "…", "refreshToken": "…", "expiresAt": 0 } }
```

| Platform | Location |
| --- | --- |
| macOS | Keychain, generic password, service `Claude Code-credentials` |
| Linux, Windows | `~/.claude/.credentials.json` |

Tokenwatch only reads `accessToken`. It never uses the refresh token and never writes to
either location. When the access token expires, running any `claude` command refreshes it.

## Response

Fields Tokenwatch uses (other fields may be present and are ignored):

```json
{
  "five_hour": { "utilization": 9,  "resets_at": "2026-10-08T01:39:00Z" },
  "seven_day": { "utilization": 41, "resets_at": "2026-10-10T08:00:00Z" }
}
```

| Field | Meaning |
| --- | --- |
| `five_hour.utilization` | Percentage (0–100) of the rolling 5-hour session window used. |
| `seven_day.utilization` | Percentage (0–100) of the rolling 7-day window used. |
| `*.resets_at` | ISO-8601 time the window resets. May be missing. |

A window can be `null`, and a missing `resets_at` is allowed. The parser also accepts
`fiveHour`/`session`, `sevenDay`/`weekly`, `percent`/`percentage` and `resetsAt`/`reset_at`,
in case of renames.

## Status codes

| Status | Tokenwatch shows | Usual cause |
| --- | --- | --- |
| 200 with known fields | live quota | — |
| 200 with unknown fields | fallback, *unrecognised response* | The endpoint changed shape. |
| 401 / 403 | fallback, *login rejected* | Token expired or revoked. Run `claude`. |
| 429 | fallback, *rate-limited* | The endpoint's own limit is tighter than the poll interval. Tokenwatch backs off automatically (see below); no action needed unless it persists. |
| other / timeout (10 s) | fallback with the HTTP status or error | Outage or network problem. |

## Rate limits

A poll that gets a 429 backs off automatically: it honours a `Retry-After` header if the
server sends one, or waits 180s otherwise, before polling again. In practice, polling every
60s has drawn a 429 on roughly every other request, so the endpoint's own limit is tighter
than one request per minute.

Manual refreshes (clicking the item, or the command) are never blocked by this backoff, only
the automatic timer is.

## When it breaks

1. Run **Tokenwatch: Show Log**. An unrecognised shape is logged as
   `Unrecognised usage response: {…}`, with the first 1,000 characters of the body.
2. Compare that body with the response above, then add the new key names to the
   `*_KEYS` lists at the top of `src/core/usageApi.ts`.
3. Add a case for the new shape to `src/test/usageApi.test.ts`, and update this page and its
   *Last confirmed* date.
