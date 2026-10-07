/**
 * @file Shared domain types for Tokenwatch.
 *
 * Everything under `src/domain/` is pure, with no I/O and no `vscode`, so it is unit-tested
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

/** The context size recorded by one main-thread reply in a session transcript. */
export interface ContextReply {
  /** Input, cache-write and cache-read tokens sent with the reply: the context size. */
  readonly tokens: number;
  /** Model that produced the reply, e.g. `claude-opus-5-5`. */
  readonly model?: string;
  /** When the reply was logged. */
  readonly at: Date;
}

/** One context-size reading. */
export interface ContextReading {
  /** Tokens in context at the last reply. */
  readonly tokens: number;
  /** Window size the percentage is relative to. */
  readonly windowTokens: number;
  /** Whether `windowTokens` was inferred rather than taken from settings. */
  readonly windowInferred: boolean;
  /** `tokens / windowTokens` as a percentage; can exceed 100 if the window is set too small. */
  readonly percent: number;
  /** Model that produced the last reply, e.g. `claude-opus-5-5`. */
  readonly model?: string;
  /** When the last reply was logged. */
  readonly at: Date;
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
  /** Show the context-window item for this workspace's Claude Code session. */
  readonly showContext: boolean;
  /** Context window per model id (exact, prefix, or `"*"`); unlisted models are inferred. */
  readonly contextWindowTokens: Readonly<Record<string, number>>;
}

/** Everything the status bar can display; one variant per outcome of a refresh. */
export type UsageState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'noCredentials' }
  | {
      readonly kind: 'live';
      readonly snapshot: UsageSnapshot;
      readonly fetchedAt: Date;
      /** Set when this is the last good snapshot, kept on screen because a refresh failed. */
      readonly staleReason?: string;
    }
  | {
      readonly kind: 'fallback';
      readonly estimate: LocalUsageEstimate;
      readonly reason: string;
      /** Seconds to wait before polling again, when the server asked to back off. */
      readonly retryAfterSeconds?: number;
    }
  | {
      readonly kind: 'error';
      readonly message: string;
      readonly retryAfterSeconds?: number;
    };
