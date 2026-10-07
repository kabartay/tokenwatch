/**
 * @file Locates the OAuth access token of the local Claude Code login.
 *
 * The token is read fresh on every call rather than cached, so a token that Claude Code
 * refreshes in the background is picked up on the next poll without a reload.
 */

import { execFile } from 'child_process';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';

/** A place a Claude Code access token may be stored. */
export interface TokenSource {
  /** Short label used in diagnostics. */
  readonly name: string;
  /**
   * Reads the raw stored credential.
   *
   * @returns The stored value (usually a JSON blob), or `undefined` when absent or unreadable.
   */
  read(): Promise<string | undefined>;
}

/** The macOS login Keychain, where Claude Code keeps credentials on macOS. */
export class KeychainTokenSource implements TokenSource {
  readonly name = 'macOS Keychain';

  /** @param service - Keychain service name of the generic-password item. */
  constructor(private readonly service = 'Claude Code-credentials') {}

  read(): Promise<string | undefined> {
    return new Promise((resolve) => {
      execFile(
        'security',
        ['find-generic-password', '-s', this.service, '-w'],
        { timeout: 5_000 },
        (err, stdout) => resolve(err ? undefined : stdout.trim() || undefined),
      );
    });
  }
}

/** The `~/.claude/.credentials.json` file Claude Code uses on Linux and Windows. */
export class CredentialsFileTokenSource implements TokenSource {
  readonly name = 'credentials file';

  /** @param filePath - Location of the credentials file. */
  constructor(
    private readonly filePath = path.join(os.homedir(), '.claude', '.credentials.json'),
  ) {}

  async read(): Promise<string | undefined> {
    try {
      return (await fs.readFile(this.filePath, 'utf8')).trim() || undefined;
    } catch {
      return undefined;
    }
  }
}

/**
 * Extracts the access token from a stored credential.
 *
 * Claude Code stores `{"claudeAiOauth": {"accessToken": "..."}}`; the flatter shapes are
 * accepted too in case the format changes. A non-JSON value is treated as a bare token.
 *
 * @param raw - The stored credential as read from a {@link TokenSource}.
 * @returns The access token, or `undefined` if none could be found.
 */
export function extractAccessToken(raw: string): string | undefined {
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  if (!trimmed.startsWith('{')) return trimmed;

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return undefined;
  }
  for (const container of [pick(parsed, 'claudeAiOauth'), pick(parsed, 'oauth'), parsed]) {
    const token = pick(container, 'accessToken') ?? pick(container, 'access_token');
    if (typeof token === 'string' && token) return token;
  }
  return undefined;
}

/** Safely reads `obj[key]` from an unknown JSON value. */
function pick(obj: unknown, key: string): unknown {
  return obj && typeof obj === 'object' ? (obj as Record<string, unknown>)[key] : undefined;
}

/** Tries each {@link TokenSource} in order and returns the first usable token. */
export class CredentialStore {
  /** @param sources - Sources in priority order. */
  constructor(private readonly sources: readonly TokenSource[]) {}

  /** Builds the platform-appropriate store: Keychain first on macOS, then the file. */
  static forPlatform(platform: NodeJS.Platform = process.platform): CredentialStore {
    const sources: TokenSource[] =
      platform === 'darwin'
        ? [new KeychainTokenSource(), new CredentialsFileTokenSource()]
        : [new CredentialsFileTokenSource()];
    return new CredentialStore(sources);
  }

  /** @returns The first access token found, or `undefined` if the user isn't logged in. */
  async getAccessToken(): Promise<string | undefined> {
    for (const source of this.sources) {
      const raw = await source.read();
      const token = raw === undefined ? undefined : extractAccessToken(raw);
      if (token) return token;
    }
    return undefined;
  }
}
