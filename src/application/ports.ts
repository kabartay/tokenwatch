/**
 * @file Ports: the interfaces the application layer needs from the outside world.
 *
 * `infrastructure/` implements them (HTTP, Keychain, files) and `ui/` supplies VS Code's
 * pieces, so the application logic depends on nothing concrete and tests pass in-memory fakes.
 */

import type { ContextReading, LocalUsageEstimate, UsageSnapshot } from '../domain/types';

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

/** Reads context-window usage for a set of folders. Implemented by `ContextReader`. */
export interface ContextSource {
  /**
   * @param folders - Absolute paths of the workspace folders open in this window.
   * @param windowSizes - Context window per model id, from settings.
   * @returns The latest reading, or `undefined` if no session in these folders has replied.
   */
  read(
    folders: readonly string[],
    windowSizes: Readonly<Record<string, number>>,
  ): Promise<ContextReading | undefined>;
}

/**
 * Small persistent key-value store. VS Code's `Memento` (`globalState`) satisfies it.
 *
 * Implementations may write to disk, so callers must never store the token.
 */
export interface KeyValueStore {
  get<T>(key: string): T | undefined;
  update(key: string, value: unknown): PromiseLike<void>;
}
