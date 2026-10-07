/**
 * @file Interfaces between the refresh logic and its collaborators.
 *
 * {@link UsageService} depends on these rather than on concrete classes, so tests can pass
 * in-memory fakes and the production classes stay swappable.
 */

import type { LocalUsageEstimate, UsageSnapshot } from './types';

/** Supplies the Claude Code OAuth access token. Implemented by `CredentialStore`. */
export interface AccessTokenProvider {
  /** @returns The token, or `undefined` if the user is not logged in. */
  getAccessToken(): Promise<string | undefined>;
}

/** Fetches server-side quota. Implemented by `UsageApiClient`. */
export interface UsageFetcher {
  /**
   * @param accessToken - Bearer token for the request.
   * @throws {UsageApiError} When the request fails or the response is unusable.
   */
  fetchUsage(accessToken: string): Promise<UsageSnapshot>;
}

/** Estimates consumption from local data. Implemented by `LocalUsageEstimator`. */
export interface UsageEstimator {
  /** @returns Today's estimate, or `undefined` if nothing was logged today. */
  estimateToday(now?: Date): Promise<LocalUsageEstimate | undefined>;
}

/**
 * Minimal diagnostics sink. VS Code's `LogOutputChannel` satisfies it structurally.
 *
 * Implementations may persist messages to disk, so callers must never pass the token.
 */
export interface Logger {
  info(message: string): void;
  warn(message: string): void;
}
