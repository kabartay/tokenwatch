/**
 * @file Shared domain types for Tokenwatch.
 *
 * Everything under `src/core/` is free of any `vscode` import so it can be unit-tested
 * with the plain Node test runner.
 */

/** One rate-limit window (for example the rolling 5-hour session or the 7-day week). */
export interface UsageWindow {
  /** Share of the window's allowance already consumed, as a percentage in `[0, 100]`. */
  readonly percentUsed: number;
  /** When the window resets, if the server reported it. */
  readonly resetsAt?: Date;
}

/** A point-in-time reading of the account's server-side quota. */
export interface UsageSnapshot {
  /** The rolling 5-hour session window. */
  readonly session?: UsageWindow;
  /** The rolling 7-day window across all models. */
  readonly weekly?: UsageWindow;
  /** The untouched response body, kept for diagnostics when parsing finds nothing. */
  readonly raw: unknown;
}

/** Locally observed consumption, used only when the server-side quota is unavailable. */
export interface LocalUsageEstimate {
  /** Input plus output tokens recorded in today's session logs (local time). */
  readonly tokensToday: number;
  /** Number of distinct assistant messages those tokens came from. */
  readonly messageCount: number;
}

/** User-tunable settings, already validated and clamped. */
export interface TokenwatchConfig {
  /** Seconds between automatic refreshes. */
  readonly pollIntervalSeconds: number;
  /** Percentage at or above which the status bar shows a warning. */
  readonly warnThresholdPercent: number;
  /** `bars` draws a mini progress bar per window; `compact` shows percentages only. */
  readonly statusBarStyle: 'bars' | 'compact';
  /** Append the session reset countdown (`↻4h 8m`) to the status bar text. */
  readonly showResetCountdown: boolean;
}

/** Everything the status bar can display; one variant per outcome of a refresh. */
export type UsageState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'noCredentials' }
  | { readonly kind: 'live'; readonly snapshot: UsageSnapshot; readonly fetchedAt: Date }
  | { readonly kind: 'fallback'; readonly estimate: LocalUsageEstimate; readonly reason: string }
  | { readonly kind: 'error'; readonly message: string };
