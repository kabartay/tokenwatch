# The usage endpoint

Tokenwatch reads the same data as Claude Code's `/usage` command. The endpoint is
**undocumented**, so this page records what is known about it, to make the fix quick when it
changes.

**Last confirmed working:** 2026-10-07, Tokenwatch 0.5.1, macOS.

## Request

```http
GET https://api.anthropic.com/api/oauth/usage
Authorization: Bearer <Claude Code OAuth access token>
anthropic-beta: oauth-2025-04-20
Accept: application/json
User-Agent: tokenwatch
```

The `anthropic-beta` header marks the request as OAuth-authenticated; Claude Code sends the
same value, and Tokenwatch sends it to match. Requests time out after 10 seconds.

## Where the token comes from

Claude Code stores its login as JSON:

```json
{ "claudeAiOauth": { "accessToken": "…", "refreshToken": "…", "expiresAt": 0 } }
```

| Platform | Location |
| --- | --- |
| macOS | Keychain, generic password, service `Claude Code-credentials` (falls back to the file below) |
| Linux, Windows | `~/.claude/.credentials.json` |

Tokenwatch reads only `accessToken`. It never uses the refresh token and never writes to either
location. When the access token expires, running any `claude` command refreshes it.

## Response

The fields Tokenwatch uses, with example values; other fields may be present and are ignored:

```json
{
  "five_hour": { "utilization": 25, "resets_at": "2026-10-07T23:39:00Z" },
  "seven_day": { "utilization": 44, "resets_at": "2026-10-10T08:00:00Z" }
}
```

| Field | Meaning |
| --- | --- |
| `five_hour.utilization` | Percentage of the 5-hour session window used. |
| `seven_day.utilization` | Percentage of the 7-day window used. |
| `*.resets_at` | ISO 8601 time the window resets. May be missing. |

A window can be `null`, and `resets_at` can be missing. In case of renames, the parser also
accepts `fiveHour`/`session`, `sevenDay`/`weekly`, `percent`/`percentage` and
`resetsAt`/`reset_at`.

## Status codes

| Response | Tokenwatch shows | Usual cause |
| --- | --- | --- |
| 200, known fields | Live quota | — |
| 200, unknown fields | Fallback, *unrecognised response* | The endpoint changed shape. |
| 200, not JSON | Fallback, *Response was not valid JSON* | A proxy or captive portal answered instead of the API. |
| 401 / 403 | Fallback, *login rejected* | Token expired or revoked. Run `claude`. |
| 429 | The last good numbers, marked stale; the fallback if there are none from the last 30 minutes | The endpoint's own rate limit. Tokenwatch backs off automatically (see below). |
| Other status, or timeout | Fallback, with the status or error | An outage or a network problem. |

*Fallback* means today's token count from local logs, `~1.5M tok today`, with the reason in the
tooltip.

## Rate limits

Polling every 60 seconds drew a 429 on roughly every other request, so the limit is tighter
than one request a minute. It appears to be per account and shared with Claude Code itself,
which calls the same endpoint. Tokenwatch therefore polls every 180 seconds by default.

After a 429, Tokenwatch waits at least 180 seconds, longer if `Retry-After` asks for more. The
server sends `Retry-After: 0` with its 429s (confirmed 2026-10-07), so honouring the header
alone never backed off. The log line for each 429 includes the header value when there is one.

During the backoff:

- the status bar keeps the last good numbers if they are under 30 minutes old, and the tooltip
  says they are from an earlier time;
- a manual refresh doesn't send a request; it reports when the next attempt will be;
- a window reload carries the backoff over instead of starting a new request.

## Checking the endpoint yourself

To see the raw response when something looks wrong, call the endpoint with your own token. The
token grants access to your account, so don't paste it or the commands' output anywhere public.

```bash
# macOS: the token from the Keychain. Elsewhere, replace the security command with:
#   cat ~/.claude/.credentials.json
TOKEN=$(security find-generic-password -s "Claude Code-credentials" -w \
  | python3 -c 'import json, sys; print(json.load(sys.stdin)["claudeAiOauth"]["accessToken"])')

curl -s https://api.anthropic.com/api/oauth/usage \
  -H "Authorization: Bearer $TOKEN" \
  -H "anthropic-beta: oauth-2025-04-20"
```

Each call counts against the same rate limit as Tokenwatch and Claude Code.

## When it breaks

1. Run **Tokenwatch: Show Log**. An unrecognised shape is logged as
   `Unrecognised usage response: {…}`, with the first 1,000 characters of the body. Or fetch
   it yourself as shown above.
2. Compare that body with the response above, then add the new key names to the `*_KEYS` lists
   at the top of `src/domain/usageResponse.ts`.
3. Add a case for the new shape to `src/test/domain/usageResponse.test.ts`, and update this
   page and its *Last confirmed* date.
