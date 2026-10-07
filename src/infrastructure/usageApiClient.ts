/**
 * @file HTTP client for the undocumented usage endpoint that Claude Code's `/usage` reads.
 *
 * Only transport lives here: request, status handling, `Retry-After`. The body is mapped by
 * the pure `parseUsageResponse` in `domain/usageResponse.ts`.
 */

import type { ClientRequest, IncomingMessage, RequestOptions } from 'http';
import * as https from 'https';
import { UsageApiError } from '../application/errors';
import type { UsageFetcher } from '../application/ports';
import type { UsageSnapshot } from '../domain/types';
import { parseUsageResponse } from '../domain/usageResponse';

/** Signature shared by `https.request` and `http.request`. */
export type RequestFn = (
  options: RequestOptions,
  callback: (res: IncomingMessage) => void,
) => ClientRequest;


/** Connection settings for {@link UsageApiClient}. */
export interface UsageApiOptions {
  readonly hostname: string;
  /** Omitted in production (443); set by tests that run a local server. */
  readonly port?: number;
  readonly path: string;
  /** Value of the `anthropic-beta` header the OAuth endpoints require. */
  readonly betaHeader: string;
  readonly timeoutMs: number;
  /**
   * Transport. Defaults to `https.request`, which VS Code patches to honour the user's
   * `http.proxy` setting (global `fetch` is not patched). Tests substitute `http.request`.
   */
  readonly request: RequestFn;
}

const DEFAULT_OPTIONS: UsageApiOptions = {
  hostname: 'api.anthropic.com',
  path: '/api/oauth/usage',
  betaHeader: 'oauth-2025-04-20',
  timeoutMs: 10_000,
  request: https.request,
};

/** Fetches and parses the account's quota utilization. */
export class UsageApiClient implements UsageFetcher {
  private readonly options: UsageApiOptions;

  /** @param options - Overrides for the default endpoint settings. */
  constructor(options: Partial<UsageApiOptions> = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  /**
   * Requests the current usage.
   *
   * @param accessToken - Claude Code OAuth access token; sent only to the configured host.
   * @returns The parsed snapshot. Windows the parser didn't recognise are left undefined.
   * @throws {UsageApiError} On network failure, timeout, non-2xx status, or invalid JSON.
   *   Its message never contains the token.
   */
  fetchUsage(accessToken: string): Promise<UsageSnapshot> {
    const { hostname, port, path, betaHeader, timeoutMs, request } = this.options;
    return new Promise((resolve, reject) => {
      const req = request(
        {
          hostname,
          port,
          path,
          method: 'GET',
          timeout: timeoutMs,
          headers: {
            Authorization: `Bearer ${accessToken}`,
            Accept: 'application/json',
            'anthropic-beta': betaHeader,
            'User-Agent': 'tokenwatch',
          },
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (chunk: Buffer) => chunks.push(chunk));
          res.on('end', () => {
            const body = Buffer.concat(chunks).toString('utf8');
            const status = res.statusCode ?? 0;
            if (status < 200 || status >= 300) {
              reject(
                new UsageApiError(
                  `HTTP ${status}: ${body.slice(0, 200)}`,
                  status,
                  parseRetryAfter(res.headers['retry-after']),
                ),
              );
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
 * Parses a `Retry-After` header, which is seconds (`"30"`) or an HTTP date.
 *
 * @returns Seconds to wait, floored at 0, or `undefined` if absent or unparseable.
 */
function parseRetryAfter(header: string | string[] | undefined): number | undefined {
  const value = Array.isArray(header) ? header[0] : header;
  if (!value) return undefined;
  if (/^\d+$/.test(value)) return Number(value);
  const at = Date.parse(value);
  return Number.isNaN(at) ? undefined : Math.max(0, Math.round((at - Date.now()) / 1_000));
}
