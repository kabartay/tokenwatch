import { execFile } from 'child_process';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';

export interface Credentials {
  accessToken: string;
}

function execFileAsync(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: 5000 }, (err, stdout) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(stdout.trim());
    });
  });
}

async function readFromMacKeychain(): Promise<string | undefined> {
  try {
    const out = await execFileAsync('security', [
      'find-generic-password',
      '-s',
      'Claude Code-credentials',
      '-w',
    ]);
    return out || undefined;
  } catch {
    return undefined;
  }
}

async function readFromCredentialsFile(): Promise<string | undefined> {
  try {
    const filePath = path.join(os.homedir(), '.claude', '.credentials.json');
    const raw = await fs.readFile(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    return (
      parsed?.accessToken ??
      parsed?.access_token ??
      parsed?.oauth?.accessToken ??
      parsed?.oauth?.access_token ??
      undefined
    );
  } catch {
    return undefined;
  }
}

/**
 * The stored value may itself be JSON (macOS Keychain stores the whole
 * credentials blob, not a bare token) or a plain bearer token string.
 */
function extractToken(raw: string): string | undefined {
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  if (trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed);
      return (
        parsed?.accessToken ??
        parsed?.access_token ??
        parsed?.oauth?.accessToken ??
        parsed?.oauth?.access_token
      );
    } catch {
      return undefined;
    }
  }
  return trimmed;
}

export async function getAccessToken(): Promise<string | undefined> {
  if (process.platform === 'darwin') {
    const fromKeychain = await readFromMacKeychain();
    if (fromKeychain) {
      const token = extractToken(fromKeychain);
      if (token) return token;
    }
  }
  const fromFile = await readFromCredentialsFile();
  if (fromFile) return extractToken(fromFile) ?? fromFile;
  return undefined;
}
