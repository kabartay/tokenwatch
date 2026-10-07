/**
 * @file Tests for the backoff, stale-numbers and reload-restore decisions.
 */

import { strict as assert } from 'node:assert';
import { beforeEach, describe, it } from 'node:test';
import type { KeyValueStore } from '../../application/ports';
import {
  KEEP_LAST_LIVE_MS,
  PERSIST_KEY,
  RefreshPolicy,
  type PersistedQuota,
} from '../../application/refreshPolicy';
import type { UsageState } from '../../domain/types';
import { parseUsageResponse } from '../../domain/usageResponse';

const MIN = 60_000;
const POLL_MS = 3 * MIN;
const BODY = { five_hour: { utilization: 20, resets_at: '2026-10-07T23:39:00Z' }, seven_day: { utilization: 43 } };

class MemoryStore implements KeyValueStore {
  readonly data = new Map<string, unknown>();
  get<T>(key: string): T | undefined {
    return this.data.get(key) as T | undefined;
  }
  update(key: string, value: unknown): PromiseLike<void> {
    this.data.set(key, value);
    return Promise.resolve();
  }
}

class Clock {
  constructor(public ms = Date.parse('2026-10-07T21:00:00Z')) {}
  readonly now = (): number => this.ms;
  advance(ms: number): void {
    this.ms += ms;
  }
}

const live = (at: number): UsageState => ({ kind: 'live', snapshot: parseUsageResponse(BODY), fetchedAt: new Date(at) });
const rateLimited = (retryAfterSeconds = 180): UsageState => ({
  kind: 'fallback',
  reason: 'rate-limited by the usage endpoint',
  estimate: { tokensToday: 1_500_000, messageCount: 10 },
  retryAfterSeconds,
});

describe('RefreshPolicy', () => {
  let store: MemoryStore;
  let clock: Clock;
  let policy: RefreshPolicy;

  beforeEach(() => {
    store = new MemoryStore();
    clock = new Clock();
    policy = new RefreshPolicy(store, clock.now);
  });

  describe('record', () => {
    it('shows live results as they are and starts no backoff', () => {
      const state = live(clock.ms);
      assert.deepEqual(policy.record(state), { shown: state, backoffSeconds: undefined });
      assert.ok(policy.isPastBackoff());
    });

    it('starts a backoff on a rate limit and holds polls until it ends', () => {
      const { backoffSeconds } = policy.record(rateLimited(180));
      assert.equal(backoffSeconds, 180);
      assert.equal(policy.isPastBackoff(), false);
      assert.equal(policy.backoffRemainingMs(), 180_000);
      clock.advance(179_999);
      assert.equal(policy.isPastBackoff(), false);
      clock.advance(1);
      assert.ok(policy.isPastBackoff());
      assert.equal(policy.backoffRemainingMs(), 0);
    });

    it('keeps the last good numbers on screen, marked stale, while rate-limited', () => {
      policy.record(live(clock.ms));
      clock.advance(5 * MIN);
      const { shown } = policy.record(rateLimited());
      assert.equal(shown.kind, 'live');
      assert.equal(shown.kind === 'live' && shown.staleReason, 'rate-limited');
    });

    it('falls back once the last good numbers are too old', () => {
      policy.record(live(clock.ms));
      clock.advance(KEEP_LAST_LIVE_MS + 1);
      assert.equal(policy.record(rateLimited()).shown.kind, 'fallback');
    });

    it('shows other failures as they are; only rate limits keep old numbers', () => {
      policy.record(live(clock.ms));
      const failure: UsageState = { kind: 'error', message: 'HTTP 500' };
      assert.deepEqual(policy.record(failure), { shown: failure, backoffSeconds: undefined });
    });

    it('persists the raw body, its time and the backoff deadline, never more', () => {
      policy.record(live(clock.ms));
      policy.record(rateLimited(180));
      assert.deepEqual(store.get<PersistedQuota>(PERSIST_KEY), {
        raw: BODY,
        fetchedAt: new Date(clock.ms).toISOString(),
        backoffUntil: clock.ms + 180_000,
      });
    });
  });

  describe('isStale', () => {
    it('is stale until refreshed, then again after one poll interval', () => {
      assert.ok(policy.isStale(POLL_MS));
      policy.markRefreshed();
      assert.equal(policy.isStale(POLL_MS), false);
      clock.advance(POLL_MS);
      assert.ok(policy.isStale(POLL_MS));
    });
  });

  describe('restore', () => {
    const save = (value: PersistedQuota) => void store.update(PERSIST_KEY, value);

    it('returns nothing when nothing was saved', () => {
      assert.deepEqual(policy.restore(POLL_MS), {});
      assert.ok(policy.isPastBackoff());
    });

    it('shows fresh numbers as fresh and skips the startup request', () => {
      save({ raw: BODY, fetchedAt: new Date(clock.ms - 30_000).toISOString(), backoffUntil: 0 });
      const { state } = policy.restore(POLL_MS);
      assert.equal(state?.staleReason, undefined);
      assert.equal(state?.snapshot.session?.percentUsed, 20);
      assert.equal(policy.isStale(POLL_MS), false);
    });

    it('marks older numbers stale and lets a request go out', () => {
      save({ raw: BODY, fetchedAt: new Date(clock.ms - 10 * MIN).toISOString() });
      assert.equal(policy.restore(POLL_MS).state?.staleReason, 'from before reload');
      assert.ok(policy.isStale(POLL_MS));
    });

    it('drops numbers older than the keep limit', () => {
      save({ raw: BODY, fetchedAt: new Date(clock.ms - KEEP_LAST_LIVE_MS - 1).toISOString() });
      assert.equal(policy.restore(POLL_MS).state, undefined);
    });

    it('resumes a running backoff, and ignores one that has ended', () => {
      save({ backoffUntil: clock.ms + 90_000 });
      assert.equal(policy.restore(POLL_MS).backoffRemainingMs, 90_000);
      assert.equal(policy.isPastBackoff(), false);

      const fresh = new RefreshPolicy(store, clock.now);
      save({ backoffUntil: clock.ms - 1 });
      assert.equal(fresh.restore(POLL_MS).backoffRemainingMs, undefined);
      assert.ok(fresh.isPastBackoff());
    });

    it('ignores corrupt saved data', () => {
      save({ raw: 'not json', fetchedAt: 'yesterday-ish' });
      assert.equal(policy.restore(POLL_MS).state, undefined);
      save({ raw: { unknown: true }, fetchedAt: new Date(clock.ms).toISOString() });
      assert.equal(policy.restore(POLL_MS).state, undefined);
    });
  });
});
