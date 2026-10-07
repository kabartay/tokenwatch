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

- **`src/core/` must not import `vscode`.** Put logic there and keep `src/vscode/` thin. See
  [ARCHITECTURE.md](ARCHITECTURE.md).
- **Every file starts with a `@file` header, and every export has TSDoc.** Comments explain
  *why*; names explain *what*.
- **Depend on interfaces** (`core/contracts.ts`) and pass collaborators into constructors.
  Tests use in-memory fakes, not mocking libraries.
- **Never put the access token in a log message, an error message or a tooltip.** A test in
  `usageService.test.ts` checks this for every outcome. Extend it if you add a new one.
- **`@types/vscode` stays pinned to `engines.vscode`** (`~1.85.0`). A newer version would let
  code call APIs that older VS Code versions lack. Dependabot is told to ignore it.
- **No runtime dependencies.** If you think you need one, open an issue first.

## Tests

Tests live in `src/test/*.test.ts` and use only `node:test` and `node:assert`:

| File | Covers |
| --- | --- |
| `credentials.test.ts` | Token extraction from every credential shape; source fallback order. |
| `usageApi.test.ts` | Response parsing, including unrecognised and partial shapes. |
| `usageApiClient.test.ts` | Real HTTP against a local server: headers, status codes, timeouts, bad JSON. |
| `usageService.test.ts` | The live → fallback → error decision; the token never reaches the log. |
| `localUsage.test.ts` | Incremental log scanning, de-duplication, partial lines, rewritten files. |
| `format.test.ts` | Percentages, countdowns, token counts, summaries. |

The VS Code layer (`src/vscode/`) has no automated tests. Check it by hand with F5 before
a release.

## Releasing

1. Update `CHANGELOG.md`: move the *Unreleased* entries under the new version and date them.
2. Bump `version` in `package.json`.
3. Run `npm run check`, then commit and push to `main`.
4. Wait for CI to pass.
5. Tag and push:

   ```bash
   git tag v0.3.0 && git push origin v0.3.0
   ```

6. `release.yml` builds the `.vsix` and creates the GitHub Release. Replace the
   auto-generated notes with the CHANGELOG section (unwrapped Markdown).
7. Download the release asset and install it to make sure the published file works.
