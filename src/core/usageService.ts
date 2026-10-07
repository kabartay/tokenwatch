/**
 * @file Decides what to show: live quota, the local fallback, or an error.
 *
 * This is the whole refresh decision, kept free of `vscode` so every branch is unit-tested.
 * The VS Code controller only schedules calls to {@link UsageService.resolve} and renders
 * the result.
 */

import type { AccessTokenProvider, Logger, UsageEstimator, UsageFetcher } from './contracts';
import { UsageApiError } from './errors';
import { hasAnyWindow } from './usageApi';
import type { UsageState } from './types';

/** Upper bound on how much of an unrecognised response body is written to the log. */
const MAX_LOGGED_BODY_CHARS = 1_000;

/**
 * Backoff used on a 429 when the server didn't send `Retry-After`.
 *
 * Observed in practice: polling `/usage` every 60s drew a 429 on roughly every other request,
 * so the endpoint's own limit is tighter than one request per minute. This waits well past
 * that before trying again.
 */
const DEFAULT_RATE_LIMIT_BACKOFF_SECONDS = 180;

/** Collaborators of {@link UsageService}. */
export interface UsageServiceDeps {
  readonly credentials: AccessTokenProvider;
  readonly api: UsageFetcher;
  readonly estimator: UsageEstimator;
  readonly log: Logger;
}

/** Turns credentials, the usage endpoint and local logs into a single {@link UsageState}. */
export class UsageService {
  constructor(private readonly deps: UsageServiceDeps) {}

  /**
   * Resolves the state to display.
   *
   * Order of preference: live quota → local estimate (with the reason live failed) →
   * error. A missing login short-circuits to `noCredentials`, since the fallback would only
   * hide the real problem.
   *
   * @param now - Reference time for `fetchedAt` and the local estimate; injectable for tests.
   */
  async resolve(now: Date = new Date()): Promise<UsageState> {
    const { credentials, api, estimator, log } = this.deps;

    const token = await credentials.getAccessToken();
    if (!token) {
      log.warn('No access token in the macOS Keychain or ~/.claude/.credentials.json');
      return { kind: 'noCredentials' };
    }

    let reason: string;
    let retryAfterSeconds: number | undefined;
    try {
      const snapshot = await api.fetchUsage(token);
      if (hasAnyWindow(snapshot)) return { kind: 'live', snapshot, fetchedAt: now };
      reason = 'usage endpoint returned an unrecognised response';
      log.warn(
        `Unrecognised usage response: ${JSON.stringify(snapshot.raw).slice(0, MAX_LOGGED_BODY_CHARS)}`,
      );
    } catch (err) {
      reason = describeFailure(err);
      retryAfterSeconds = rateLimitBackoffSeconds(err);
      log.warn(`Usage request failed: ${err instanceof Error ? err.message : String(err)}`);
    }

    const estimate = await estimator.estimateToday(now);
    return estimate
      ? { kind: 'fallback', estimate, reason, retryAfterSeconds }
      : { kind: 'error', message: reason, retryAfterSeconds };
  }
}

/**
 * How long to back off after a failure, if it was a rate limit.
 *
 * @returns Seconds to wait, or `undefined` for a failure that isn't a rate limit, which the
 *   normal poll interval already handles.
 */
export function rateLimitBackoffSeconds(err: unknown): number | undefined {
  if (!(err instanceof UsageApiError) || !err.isRateLimited) return undefined;
  return err.retryAfterSeconds ?? DEFAULT_RATE_LIMIT_BACKOFF_SECONDS;
}

/**
 * Turns a refresh failure into a short, actionable message for the tooltip.
 *
 * @param err - Whatever the fetch rejected with.
 * @returns A message that never contains the token.
 */
export function describeFailure(err: unknown): string {
  if (err instanceof UsageApiError) {
    if (err.isAuthFailure) return 'login rejected — run `claude` to refresh it';
    if (err.status === 429) return 'rate-limited by the usage endpoint';
    return err.message;
  }
  return err instanceof Error ? err.message : String(err);
}
