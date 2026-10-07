# Troubleshooting

Start with the log: `Cmd+Shift+P` → **Tokenwatch: Show Log**. Every refresh writes one line
saying what was shown and, if it fell back, why.

## What a healthy log looks like

```text
2026-10-07 21:30:42.492 [info] Tokenwatch 0.2.1 activated
2026-10-07 21:30:42.752 [info] 5h 9% (resets in 4h 9m) · wk 41%
2026-10-07 21:31:05.343 [info] Tokenwatch 0.2.1 activated
2026-10-07 21:31:05.683 [info] 5h 9% (resets in 4h 8m) · wk 41%
2026-10-07 21:31:16.255 [info] 5h 9% (resets in 4h 8m) · wk 41%
2026-10-07 21:32:05.631 [info] 5h 9% (resets in 4h 7m) · wk 41%
2026-10-07 21:33:05.704 [info] 5h 9% (resets in 4h 6m) · wk 41%
2026-10-07 21:34:05.627 [info] 5h 9% (resets in 4h 5m) · wk 41%
2026-10-07 21:35:05.693 [info] 5h 9% (resets in 4h 4m) · wk 41%
```

How to read it:

- `activated` appears once per window load. Two lines close together mean the window was
  reloaded.
- A line appears about every 60 s (`tokenwatch.pollIntervalSeconds`). An off-cycle line,
  like 21:31:16 above, is a manual refresh.
- **Gaps are normal.** Polls are skipped while the window isn't focused, and the next line
  appears when you come back.

The same log is on disk, so you can read it without opening VS Code:

```text
~/Library/Application Support/Code/logs/<session>/window<N>/exthost/kabartay.tokenwatch/Tokenwatch.log
```

On Linux the base folder is `~/.config/Code/logs`, and on Windows it's `%APPDATA%\Code\logs`.

## Symptoms

### I can't see the item in the status bar

- Right-click the status bar and make sure **Tokenwatch** is ticked.
- A crowded status bar can push items out of view. Run **Tokenwatch: Refresh Claude Usage**
  from the command palette: it shows the result in a notification wherever the item is.
- Check the extension is installed and enabled: Extensions → *Installed* → **Tokenwatch**.

### No `ctx %` item

The context item appears only when a Claude Code session was **started in a folder open in
this window**. Claude Code files sessions under the folder you ran `claude` in, so a session
started in a parent or sub-folder belongs to that folder instead. The item also hides if
`tokenwatch.showContext` is off.

### `ctx %` looks too high or too low

Transcripts don't record the model's context window, so Tokenwatch assumes 200k, or 1M once
a session passes 200k. If your model has a different window, set it in
`tokenwatch.contextWindowTokens`, for example `{ "claude-opus": 1000000 }`. Hover over the
item to see which model and window size it used.

### `Claude: log in`, though you're logged in

The log says `No access token in the macOS Keychain or ~/.claude/.credentials.json`.

- **macOS:** Tokenwatch reads the Keychain through the system `security` tool, the same way
  Claude Code does, so there's usually no prompt. If macOS did ask and you clicked **Deny**,
  open **Keychain Access**, find `Claude Code-credentials`, and on the **Access Control** tab
  allow `security`. Alternatively, log out of `claude` and log in again, which recreates the
  item.
- **Linux / Windows:** check that `~/.claude/.credentials.json` exists. Running `claude` and
  logging in creates it.

### `~1.2M tok today` instead of percentages

Live quota failed, so the item is showing local consumption. The tooltip and log give the
reason:

| Log says | Do this |
| --- | --- |
| `HTTP 401` / *login rejected* | Run any `claude` command to refresh the token, then click the item. |
| `HTTP 429` / *rate-limited* | Tokenwatch backs off automatically (180s, or the server's `Retry-After`). If it keeps happening, close extra VS Code windows, since each polls independently. |
| `Timed out after 10000 ms` | Network or proxy problem. Check VS Code's `http.proxy` setting. |
| `Unrecognised usage response: {…}` | The endpoint changed. See [USAGE_ENDPOINT.md](USAGE_ENDPOINT.md#when-it-breaks) and open an issue with that line. |

### Red `Claude usage`

Both live quota and the fallback failed, and the tooltip has the error. This usually means a
network failure on a day with no local Claude Code activity yet.

### The numbers differ from `/usage`

They come from the same endpoint, so differences are timing: Tokenwatch's value can be up to
one poll interval old. Click the item to refresh.

## Reporting a bug

Use the [bug report form](https://github.com/kabartay/tokenwatch/issues/new?template=bug_report.yml)
and paste the last few log lines. The log never contains your token. An
`Unrecognised usage response` line does include the endpoint's reply, so check it before you post.
