# Troubleshooting

Start with the log: `Cmd+Shift+P` → **Tokenwatch: Show Log**. Each quota refresh, and each
change in context, writes one line; when something fails, the line before it says why.

## What a healthy log looks like

Every line is the same one-line summary the status bar shows. A real log, right after a reload:

```text
2026-10-07 23:49:52.876 [info] Tokenwatch 0.5.1 activated
2026-10-07 23:49:52.903 [info] 5h 25% ↻1h 50m · wk 44% · ctx: 63%
2026-10-07 23:49:53.995 [info] 5h 25% ↻1h 50m · wk 44% · ctx: 63%
```

How to read it:

- `activated` appears once per window load. Numbers saved before a reload are shown straight
  away; to see the restore itself, run **Developer: Set Log Level…** → **Tokenwatch** →
  **Debug**.
- A line appears on every quota refresh, about every 3 minutes
  (`tokenwatch.pollIntervalSeconds`), and whenever `ctx` changes, which happens after a Claude
  reply. In the example, the two lines a second apart are the context read and then a quota
  refresh, usually a manual one. They match because nothing changed in between.
- `Backing off polling for 180s after a rate limit` follows a 429, and the line before it gives
  the server's reply.
- **Gaps are normal.** Polls are skipped while the window isn't focused, and the next line
  appears when you come back.

The same log is saved on disk, so you can read it without opening VS Code:

```text
~/Library/Application Support/Code/logs/<session>/window<N>/exthost/kabartay.tokenwatch/Tokenwatch.log
```

On Linux the base folder is `~/.config/Code/logs`, and on Windows it's `%APPDATA%\Code\logs`.

## Symptoms

### I can't see the item in the status bar

- Right-click the status bar and make sure **Tokenwatch** is ticked.
- A crowded status bar can push items out of view. Run **Tokenwatch: Refresh Claude Usage**
  from the command palette: it shows the same line in a notification.
- Check that the extension is installed and enabled: Extensions → *Installed* → **Tokenwatch**.

### A spinner and `Claude usage` that doesn't go away

No quota numbers have arrived yet. Usually the first request is still running; it takes under
a second and times out after 10 seconds. It can also last up to 3 minutes when a window is
reloaded during a rate-limit backoff and no recent numbers were saved: Tokenwatch waits for the
backoff to end rather than drawing another 429. The log says which.

### `ctx` is missing from the line

`ctx` appears only for a Claude Code session that was **started in a folder open in this
window**. Claude Code files each session under the folder you ran `claude` in, so a session
started in a parent folder or a subfolder belongs to that folder instead. The log says
`Context: no Claude Code session found for [<folders>]` when this is the case. `ctx` is also
hidden when `tokenwatch.showContext` is off.

### `ctx` looks too high or too low

Transcripts don't record the model's context window, so Tokenwatch assumes 200k, or 1M once a
session passes 200k. If your model has a different window, set it in
`tokenwatch.contextWindowTokens`, for example `{ "claude-opus": 1000000 }`. Hover over the item
to see the model and the window used, for example "608k of 1M tokens".

`ctx` updates after each Claude reply, not while one is being written.

### `Claude: log in`, though you're logged in

The log says `No access token in the macOS Keychain or ~/.claude/.credentials.json`.

- **macOS:** Tokenwatch reads the Keychain through the system `security` tool, the same way
  Claude Code does, so there's usually no prompt. If macOS asked and you clicked **Deny**,
  open **Keychain Access**, find `Claude Code-credentials`, and on the **Access Control** tab
  allow `security`. Or log out of `claude` and log in again, which recreates the item.
- **Linux and Windows:** check that `~/.claude/.credentials.json` exists. Logging in with
  `claude` creates it.

### The tooltip says "Showing numbers from 23:41"

The numbers on screen are from an earlier request, and the tooltip says why:

- **(rate-limited)**: the endpoint rejected the last request, so Tokenwatch shows the last good
  numbers while it waits at least 3 minutes before trying again.
- **(from before reload)**: the window was reloaded, and the saved numbers are shown until the
  next refresh.

Nothing to do in either case; the item updates on its own.

### `~1.5M tok today` instead of percentages

Live quota failed and there were no recent numbers to show, so the item shows how many tokens
your local Claude Code logs recorded today. That's consumption, not remaining quota. The
tooltip and the log give the reason:

| Log says | Do this |
| --- | --- |
| `HTTP 401` or `403` / *login rejected* | Run any `claude` command to refresh the token, then click the item. |
| `HTTP 429` / *rate-limited* | Nothing; Tokenwatch backs off for at least 3 minutes. If it keeps happening, raise `tokenwatch.pollIntervalSeconds` or close extra VS Code windows: the limit is shared across them and with Claude Code itself. |
| `HTTP 5xx` | A server problem on Anthropic's side. Tokenwatch retries at the next poll. |
| `Timed out after 10000 ms` | A network or proxy problem. Check VS Code's `http.proxy` setting. |
| `Response was not valid JSON` | Usually a proxy or captive portal answering instead of the API. |
| `Unrecognised usage response: {…}` | The endpoint changed. See [USAGE_ENDPOINT.md](USAGE_ENDPOINT.md#when-it-breaks) and open an issue with that line. |

### Red `Claude usage`

Live quota failed and there were no local logs for today either, so there's nothing to show.
The tooltip has the error. This usually means a network failure before you've used Claude Code
today.

### A refresh says "next update in 2m"

A rate-limit backoff is running, so the click didn't send a request; another 429 would only
extend the wait. The notification still shows your current numbers.

### The numbers differ from `/usage`

Both come from the same endpoint, so any difference is timing. Tokenwatch's numbers can be up
to one poll interval old (3 minutes by default), or older during a rate-limit backoff; the
tooltip shows when they were fetched. Outside a backoff, clicking the item refreshes them.

## Reporting a bug

Use the [bug report form](https://github.com/kabartay/tokenwatch/issues/new?template=bug_report.yml)
and paste the last few log lines. The log never contains your token, but it can contain folder
paths and, for an unrecognised response, the endpoint's reply, so check it before you post.
For security issues, see [SECURITY.md](SECURITY.md#reporting-a-vulnerability) instead.
