# Development

## Setup

Requirements: Node.js 22 (the version CI uses), VS Code 1.85 or newer, and, for releases, the
GitHub CLI (`gh`).

```bash
git clone https://github.com/kabartay/tokenwatch.git
cd tokenwatch
npm ci
```

Open the folder in VS Code and press **F5**. This compiles once and opens an *Extension
Development Host*, a second VS Code window with your build of Tokenwatch loaded. To iterate,
keep `npm run watch` running in a terminal so every save recompiles, then reload the host
window with `Cmd+R` (macOS) or `Ctrl+R`.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run check` | Typecheck, lint and test. Run it before every push; CI runs the same steps. |
| `npm test` | Compile, then run all unit tests with `node --test`. |
| `npm run test:coverage` | The tests plus a per-file coverage table. |
| `npm run lint` | ESLint with type-aware rules and the layer boundaries. |
| `npm run typecheck` | `tsc --noEmit` under strict settings. |
| `npm run watch` | Recompile on every save. |
| `npm run package` | Build `tokenwatch-<version>.vsix` locally. |

To try a local build in your everyday VS Code:

```bash
npm run package
code --install-extension tokenwatch-*.vsix --force
```

If `code` isn't found, run **Shell Command: Install 'code' command in PATH** from the command
palette, or use Extensions → `···` → **Install from VSIX…**.

## Conventions

- **Respect the layers.** Pure logic goes in `src/domain/`, use cases and ports in
  `src/application/`, I/O adapters in `src/infrastructure/`, and VS Code code in `src/ui/`.
  Dependencies point inward, and `npm run lint` fails on an import that crosses a boundary.
  See [ARCHITECTURE.md](ARCHITECTURE.md#layers).
- **Every file starts with a `@file` header, and every export has TSDoc.** Comments explain
  *why*; names explain *what*.
- **Depend on interfaces** in `application/ports.ts` and pass collaborators into constructors.
  Tests use in-memory fakes, not mocking libraries.
- **Never put the access token in a log message, an error message or a tooltip.** A test in
  `src/test/application/usageService.test.ts` checks this for every outcome; extend it when you
  add a new one.
- **Keep `@types/vscode` pinned to `engines.vscode`** (`~1.85.0`). A newer version would let the
  code call APIs that older VS Code versions lack. Dependabot is configured to ignore it.
- **No runtime dependencies.** If you think you need one, open an issue first.
- **Commits carry no bot or AI attribution**, so only the owner appears as a contributor. See
  [Dependency updates](#dependency-updates) and the repository's `CLAUDE.md`.

## Tests

Tests live in `src/test/<layer>/*.test.ts`, mirroring `src/`, and use only `node:test` and
`node:assert`:

| File | Covers |
| --- | --- |
| `domain/usageResponse.test.ts` | Response parsing, including unrecognised and partial shapes. |
| `domain/transcript.test.ts` | Transcript lines: context size, token counts, de-duplication keys, folder names. |
| `domain/contextWindow.test.ts` | Window size per model: exact id, prefix, `*`, 200k/1M inference. |
| `domain/insights.test.ts` | Progress bars, pace projection, alert levels. |
| `domain/format.test.ts` | Percentages, countdowns, token counts, summaries. |
| `application/usageService.test.ts` | The live → fallback → error decision and the backoff it implies; the token never reaches the log. |
| `application/refreshPolicy.test.ts` | Backoff timing, stale numbers during a rate limit, what is saved, restore after a reload. |
| `infrastructure/usageApiClient.test.ts` | Real HTTP against a local server: headers, status codes, `Retry-After`, timeouts, bad JSON. |
| `infrastructure/credentials.test.ts` | Token extraction from every credential shape; the order sources are tried in. |
| `infrastructure/localUsageEstimator.test.ts` | Incremental log scanning, partial lines, rewritten files. |
| `infrastructure/contextReader.test.ts` | Picking the newest transcript, skipping subagent replies, long tails. |

### Checking the UI by hand

`src/ui/` has no automated tests, so it is kept thin. Before a release, run the build in the
Extension Development Host (F5) and check:

1. The status bar shows one line, `5h … ↻… · wk … · ctx: N%`, within a few seconds.
2. Hovering shows the quota table and, below it, the context section.
3. Clicking the item spins only its icon and keeps the numbers.
4. **Tokenwatch: Refresh Claude Usage** shows a notification with the same line.
5. **Tokenwatch: Show Log** shows `activated` followed by one-line summaries.
6. Changing `tokenwatch.statusBarStyle` to `compact` updates the line without a reload.

## Debugging

- **The log.** `Cmd+Shift+P` → **Tokenwatch: Show Log**. Every quota refresh and every context
  change writes one line. To also see what was restored after a reload, run **Developer: Set
  Log Level…** → **Tokenwatch** → **Debug**.
- **The log on disk.**
  `~/Library/Application Support/Code/logs/<session>/window<N>/exthost/kabartay.tokenwatch/Tokenwatch.log`
  on macOS; the base folder is `~/.config/Code/logs` on Linux and `%APPDATA%\Code\logs` on
  Windows.
- **Breakpoints.** F5 attaches the debugger to the Extension Development Host, so breakpoints
  in `src/` work, using the source maps `tsc` emits.

## Dependency updates

Dependabot opens monthly pull requests for GitHub Actions and dev dependencies. Don't merge
them on GitHub: a squash merge makes `dependabot[bot]` the commit author, and it then appears
in the repository's contributors. Instead:

```bash
gh pr diff <N> | git apply   # apply the version changes
npm install                  # refresh package-lock.json
npm run check
git commit -am "Bump <what>"  # committed as you, with no bot trailers
git push
gh pr close <N> --comment "Applied in <commit>."
```

## Releasing

1. Update `CHANGELOG.md`: move the *Unreleased* entries under the new version and date them.
2. Bump `version` in `package.json`, then run `npm install --package-lock-only` so the lockfile
   matches.
3. Run `npm run check`, then commit and push to `main`.
4. Wait for CI to pass.
5. Tag the version from `package.json` and push the tag:

   ```bash
   v="v$(node -p "require('./package.json').version")" && git tag "$v" && git push origin "$v"
   ```

6. `release.yml` builds the `.vsix` and creates the GitHub Release. Replace its auto-generated
   notes with the CHANGELOG section, written as unwrapped Markdown (one line per paragraph or
   bullet):

   ```bash
   gh release edit "$v" --notes-file notes.md
   ```

7. Download the release asset and install it, to make sure the published file works:

   ```bash
   gh release download "$v" -p '*.vsix' -D /tmp/tw && code --install-extension /tmp/tw/*.vsix --force
   ```

8. Publish the same `.vsix` to the Marketplace: on
   [the publisher page](https://marketplace.visualstudio.com/manage/publishers/kabartay), open
   **Tokenwatch** → `···` → **Update**, and upload it. Installs made from the Marketplace then
   update automatically.
