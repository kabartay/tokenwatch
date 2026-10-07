# Development

## Setup

Requirements: Node.js 22 (CI uses 22) and VS Code 1.85 or newer.

```bash
git clone https://github.com/kabartay/tokenwatch.git
cd tokenwatch
npm ci
```

Open the folder in VS Code and press **F5**. This compiles and launches an *Extension
Development Host* window with Tokenwatch loaded. After you change code, reload that window
with `Cmd+R` (macOS) or `Ctrl+R`.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run check` | Typecheck, lint and test. Run this before every push. |
| `npm test` | Compile, then run all unit tests with `node --test`. |
| `npm run test:coverage` | Tests plus a per-file coverage table. |
| `npm run lint` | ESLint with type-aware rules. |
| `npm run typecheck` | `tsc --noEmit` under strict settings. |
| `npm run watch` | Recompile on save. |
| `npm run package` | Build `tokenwatch-<version>.vsix` locally. |

To try a local build in your everyday VS Code:

```bash
npm run package
code --install-extension tokenwatch-*.vsix --force
```

## Conventions

- **Respect the layers.** Pure logic goes in `src/domain/`, use cases and ports in
  `src/application/`, I/O adapters in `src/infrastructure/`, VS Code code in `src/ui/`.
  Dependencies point inward, and `npm run lint` fails on an import across a boundary. See
  [ARCHITECTURE.md](ARCHITECTURE.md#layers).
- **Every file starts with a `@file` header, and every export has TSDoc.** Comments explain
  *why*; names explain *what*.
- **Depend on interfaces** (`application/ports.ts`) and pass collaborators into constructors.
  Tests use in-memory fakes, not mocking libraries.
- **Never put the access token in a log message, an error message or a tooltip.** A test in
  `usageService.test.ts` checks this for every outcome. Extend it if you add a new one.
- **`@types/vscode` stays pinned to `engines.vscode`** (`~1.85.0`). A newer version would let
  code call APIs that older VS Code versions lack. Dependabot is told to ignore it.
- **No runtime dependencies.** If you think you need one, open an issue first.

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
| `application/usageService.test.ts` | The live → fallback → error decision and backoff mapping; the token never reaches the log. |
| `application/refreshPolicy.test.ts` | Backoff timing, stale numbers during a rate limit, what's saved, restore after reload. |
| `infrastructure/usageApiClient.test.ts` | Real HTTP against a local server: headers, status codes, `Retry-After`, timeouts, bad JSON. |
| `infrastructure/credentials.test.ts` | Token extraction from every credential shape; source fallback order. |
| `infrastructure/localUsageEstimator.test.ts` | Incremental log scanning, partial lines, rewritten files. |
| `infrastructure/contextReader.test.ts` | Newest transcript, subagent entries skipped, long tails. |

The VS Code layer (`src/ui/`) has no automated tests; it is kept thin for that reason. Check it by hand with F5 before
a release.

## Releasing

1. Update `CHANGELOG.md`: move the *Unreleased* entries under the new version and date them.
2. Bump `version` in `package.json`.
3. Run `npm run check`, then commit and push to `main`.
4. Wait for CI to pass.
5. Tag the version from `package.json` and push the tag:

   ```bash
   v="v$(node -p "require('./package.json').version")" && git tag "$v" && git push origin "$v"
   ```

6. `release.yml` builds the `.vsix` and creates the GitHub Release. Replace the
   auto-generated notes with the CHANGELOG section (unwrapped Markdown).
7. Download the release asset and install it to make sure the published file works.
