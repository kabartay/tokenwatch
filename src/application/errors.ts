/**
 * @file Error types raised by the core layer.
 */

/** Raised when the usage endpoint cannot be reached or returns an unusable response. */
export class UsageApiError extends Error {
  /**
   * @param message - Human-readable description, safe to show in the UI (never contains the token).
   * @param status - HTTP status code, when the server responded at all.
   */
  constructor(
    message: string,
    readonly status?: number,
    /** Seconds the server asked to wait before retrying, from a `Retry-After` header. */
    readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = 'UsageApiError';
  }

  /** True when the server rejected the credentials, i.e. the user should re-login. */
  get isAuthFailure(): boolean {
    return this.status === 401 || this.status === 403;
  }

  /** True when the server asked to slow down (429), whether or not it gave a wait time. */
  get isRateLimited(): boolean {
    return this.status === 429;
  }
}
