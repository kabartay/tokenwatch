/**
 * @file Client for the server-side usage endpoint that Claude Code's `/usage` reads.
 *
 * The endpoint is undocumented. The response shape assumed here,
 * `{"five_hour": {"utilization": 42, "resets_at": "<ISO>"}, "seven_day": {...}}`, follows
 * community-documented usage of it; the parser also tolerates a few plausible renames and
 * keeps the raw body so an unexpected shape degrades to the local fallback instead of
 * showing wrong numbers.
 */

import * as https from 'https';
import { UsageApiError } from './errors';
import type { UsageSnapshot, UsageWindow } from './types';

const SESSION_KEYS = ['five_hour', 'fiveHour', 'session'] as const;
const WEEKLY_KEYS = ['seven_day', 'sevenDay', 'weekly'] as const;
const PERCENT_KEYS = ['utilization', 'percent', 'percentage'] as const;
const RESET_KEYS = ['resets_at', 'resetsAt', 'reset_at'] as const;

/** Connection settings for {@link UsageApiClient}. */
export interface UsageApiOptions {
  readonly hostname: string;
  readonly path: string;
  /** Value of the `anthropic-beta` header the OAuth endpoints require. */
  readonly betaHeader: string;
  readonly timeoutMs: number;
}

const DEFAULT_OPTIONS: UsageApiOptions = {
  hostname: 'api.anthropic.com',
  path: '/api/oauth/usage',
  betaHeader: 'oauth-2025-04-20',
  timeoutMs: 10_000,
};

/** Fetches and parses the account's quota utilization. */
export class UsageApiClient {
  private readonly options: UsageApiOptions;

  /** @param options - Overrides for the default endpoint settings. */
  constructor(options: Partial<UsageApiOptions> = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  /**
   * Requests the current usage.
   *
   * Uses Node's `https` module rather than `fetch` because VS Code patches `https` to honour
   * the user's `http.proxy` setting.
   *
   * @param accessToken - Claude Code OAuth access token; sent only to the configured host.
   * @returns The parsed snapshot. Windows the parser didn't recognise are left undefined.
   * @throws {UsageApiError} On network failure, timeout, non-2xx status, or invalid JSON.
   */
  fetchUsage(accessToken: string): Promise<UsageSnapshot> {
    const { hostname, path, betaHeader, timeoutMs } = this.options;
    return new Promise((resolve, reject) => {
      const req = https.request(
        {
          hostname,
          path,
          method: 'GET',
          timeout: timeoutMs,
          headers: {
            Authorization: `Bearer ${accessToken}`,
            Accept: 'application/json',
            'anthropic-beta': betaHeader,
          },
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (chunk: Buffer) => chunks.push(chunk));
          res.on('end', () => {
            const body = Buffer.concat(chunks).toString('utf8');
            const status = res.statusCode ?? 0;
            if (status < 200 || status >= 300) {
              reject(new UsageApiError(`HTTP ${status}: ${body.slice(0, 200)}`, status));
              return;
            }
            try {
              resolve(parseUsageResponse(JSON.parse(body)));
            } catch {
              reject(new UsageApiError('Response was not valid JSON', status));
            }
          });
        },
      );
      req.on('timeout', () => req.destroy(new UsageApiError(`Timed out after ${timeoutMs} ms`)));
      req.on('error', (err) =>
        reject(err instanceof UsageApiError ? err : new UsageApiError(err.message)),
      );
      req.end();
    });
  }
}

/**
 * Maps a raw response body onto a {@link UsageSnapshot}.
 *
 * @param body - Parsed JSON from the usage endpoint.
 * @returns A snapshot; `session`/`weekly` are undefined when not recognised.
 */
export function parseUsageResponse(body: unknown): UsageSnapshot {
  if (!isRecord(body)) return { raw: body };
  return {
    session: parseWindow(firstRecord(body, SESSION_KEYS)),
    weekly: parseWindow(firstRecord(body, WEEKLY_KEYS)),
    raw: body,
  };
}

/** @returns True if the snapshot carries at least one usable window. */
export function hasAnyWindow(snapshot: UsageSnapshot): boolean {
  return snapshot.session !== undefined || snapshot.weekly !== undefined;
}

function parseWindow(section: Record<string, unknown> | undefined): UsageWindow | undefined {
  if (!section) return undefined;
  const percentUsed = firstValue(section, PERCENT_KEYS, isFiniteNumber);
  if (percentUsed === undefined) return undefined;
  const resetRaw = firstValue(section, RESET_KEYS, (v): v is string => typeof v === 'string');
  const resetsAt = resetRaw === undefined ? undefined : new Date(resetRaw);
  return {
    percentUsed: Math.max(0, percentUsed),
    resetsAt: resetsAt && !Number.isNaN(resetsAt.getTime()) ? resetsAt : undefined,
  };
}

function firstRecord(
  obj: Record<string, unknown>,
  keys: readonly string[],
): Record<string, unknown> | undefined {
  return firstValue(obj, keys, isRecord);
}

function firstValue<T>(
  obj: Record<string, unknown>,
  keys: readonly string[],
  guard: (v: unknown) => v is T,
): T | undefined {
  for (const key of keys) {
    const value = obj[key];
    if (guard(value)) return value;
  }
  return undefined;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}
