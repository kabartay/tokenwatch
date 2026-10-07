/**
 * @file Decides when the usage endpoint may be called and what to show between calls.
 *
 * Covers the rate-limit backoff, keeping the last good numbers on screen through a 429, and
 * carrying both across a window reload. Every decision runs over an injected clock and store,
 * so each branch is unit-tested; the UI controller only owns timers and VS Code events.
 */

import type { UsageState } from '../domain/types';
import { hasAnyWindow, parseUsageResponse } from '../domain/usageResponse';
import type { KeyValueStore } from './ports';

/** Recent live numbers are shown (marked stale) instead of the fallback for this long. */
export const KEEP_LAST_LIVE_MS = 30 * 60 * 1_000;

/** Store key for the last good response and the backoff deadline. */
export const PERSIST_KEY = 'tokenwatch.lastQuota';

type LiveState = Extract<UsageState, { kind: 'live' }>;

/**
 * What survives a reload. The raw response body is stored rather than the parsed snapshot,
 * so dates round-trip through the same parser. Never contains the token.
 */
export interface PersistedQuota {
  readonly raw?: unknown;
  readonly fetchedAt?: string;
  readonly backoffUntil?: number;
}

/** Outcome of {@link RefreshPolicy.restore}. */
export interface RestoreResult {
  /** State to show straight away, when recent enough numbers were saved. */
  readonly state?: LiveState;
  /** Milliseconds left on a backoff that was running before the reload. */
  readonly backoffRemainingMs?: number;
}

/** Outcome of {@link RefreshPolicy.record}. */
export interface RecordResult {
  /** What to display: the refresh result, or the last good numbers if it was rate-limited. */
  readonly shown: UsageState;
  /** Seconds of backoff this result started, if it was a rate limit. */
  readonly backoffSeconds?: number;
}

/** Holds backoff and last-good-snapshot state, and persists it across reloads. */
export class RefreshPolicy {
  private backoffUntil = 0;
  private lastRefreshAt = 0;
  private lastLive: LiveState | undefined;

  /**
   * @param store - Where the last response and backoff deadline are kept between reloads.
   * @param now - Clock in epoch milliseconds; injectable for tests.
   */
  constructor(
    private readonly store: KeyValueStore,
    private readonly now: () => number = Date.now,
  ) {}

  /**
   * Loads what was saved before a reload.
   *
   * A running backoff is resumed. Saved numbers are shown if under {@link KEEP_LAST_LIVE_MS}
   * old: as fresh when newer than the poll interval (so no request is needed yet), otherwise
   * marked stale until the next refresh.
   *
   * @param pollIntervalMs - Current poll interval.
   */
  restore(pollIntervalMs: number): RestoreResult {
    const saved = this.store.get<PersistedQuota>(PERSIST_KEY);
    if (!saved) return {};
    const now = this.now();

    let backoffRemainingMs: number | undefined;
    if (typeof saved.backoffUntil === 'number' && saved.backoffUntil > now) {
      this.backoffUntil = saved.backoffUntil;
      backoffRemainingMs = saved.backoffUntil - now;
    }

    const fetchedAt = saved.fetchedAt ? new Date(saved.fetchedAt) : undefined;
    if (!fetchedAt || Number.isNaN(fetchedAt.getTime())) return { backoffRemainingMs };
    const age = now - fetchedAt.getTime();
    if (age > KEEP_LAST_LIVE_MS) return { backoffRemainingMs };
    const snapshot = parseUsageResponse(saved.raw);
    if (!hasAnyWindow(snapshot)) return { backoffRemainingMs };

    this.lastLive = { kind: 'live', snapshot, fetchedAt };
    this.lastRefreshAt = fetchedAt.getTime();
    const state = age < pollIntervalMs ? this.lastLive : { ...this.lastLive, staleReason: 'from before reload' };
    return { state, backoffRemainingMs };
  }

  /**
   * Records the outcome of a refresh: starts a backoff on a rate limit, remembers live numbers,
   * persists both, and picks what to display.
   */
  record(state: UsageState): RecordResult {
    const retryAfterSeconds =
      state.kind === 'fallback' || state.kind === 'error' ? state.retryAfterSeconds : undefined;
    if (retryAfterSeconds) this.backoffUntil = this.now() + retryAfterSeconds * 1_000;
    if (state.kind === 'live') this.lastLive = state;
    void this.store.update(PERSIST_KEY, this.persisted());
    return {
      shown: retryAfterSeconds ? this.lastLiveOr(state) : state,
      backoffSeconds: retryAfterSeconds || undefined,
    };
  }

  /** Notes that a refresh just finished, for {@link isStale}. */
  markRefreshed(): void {
    this.lastRefreshAt = this.now();
  }

  /** @returns True when no backoff is running, so a request may be sent. */
  isPastBackoff(): boolean {
    return this.now() >= this.backoffUntil;
  }

  /** @returns Milliseconds until the running backoff ends; 0 when none is running. */
  backoffRemainingMs(): number {
    return Math.max(0, this.backoffUntil - this.now());
  }

  /** @returns True when the last refresh is at least one poll interval old. */
  isStale(pollIntervalMs: number): boolean {
    return this.now() - this.lastRefreshAt >= pollIntervalMs;
  }

  /** While rate-limited, recent real numbers beat today's local token count. */
  private lastLiveOr(state: UsageState): UsageState {
    if (!this.lastLive) return state;
    if (this.now() - this.lastLive.fetchedAt.getTime() > KEEP_LAST_LIVE_MS) return state;
    return { ...this.lastLive, staleReason: 'rate-limited' };
  }

  private persisted(): PersistedQuota {
    return {
      raw: this.lastLive?.snapshot.raw,
      fetchedAt: this.lastLive?.fetchedAt.toISOString(),
      backoffUntil: this.backoffUntil,
    };
  }
}
