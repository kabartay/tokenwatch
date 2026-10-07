/**
 * @file Tests for the refresh decision: live → fallback → error, and log hygiene.
 */

import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { UsageApiError } from '../../application/errors';
import type { AccessTokenProvider, Logger, UsageEstimator, UsageFetcher } from '../../application/ports';
import { describeFailure, rateLimitBackoffSeconds, UsageService } from '../../application/usageService';
import type { LocalUsageEstimate, UsageSnapshot } from '../../domain/types';
import { parseUsageResponse } from '../../domain/usageResponse';

const TOKEN = 'sk-ant-oat01-SECRET';
const NOW = new Date('2026-10-07T12:00:00Z');
const LIVE: UsageSnapshot = parseUsageResponse({
  five_hour: { utilization: 9, resets_at: '2026-10-07T16:00:00Z' },
  seven_day: { utilization: 41, resets_at: '2026-10-10T08:00:00Z' },
});
const ESTIMATE: LocalUsageEstimate = { tokensToday: 1_200, messageCount: 4 };

class RecordingLogger implements Logger {
  readonly lines: string[] = [];
  info(message: string): void {
    this.lines.push(message);
  }
  warn(message: string): void {
    this.lines.push(message);
  }
}

interface Scenario {
  token?: string;
  fetch: () => Promise<UsageSnapshot>;
  estimate?: LocalUsageEstimate;
}

function setup({ token = TOKEN, fetch, estimate }: Scenario) {
  const log = new RecordingLogger();
  const credentials: AccessTokenProvider = { getAccessToken: async () => token || undefined };
  const api: UsageFetcher = { fetchUsage: fetch };
  const estimator: UsageEstimator = { estimateToday: async () => estimate };
  return { log, service: new UsageService({ credentials, api, estimator, log }) };
}

describe('UsageService.resolve', () => {
  it('returns live quota when the endpoint answers', async () => {
    const { service } = setup({ fetch: async () => LIVE });
    const state = await service.resolve(NOW);
    assert.equal(state.kind, 'live');
    assert.equal(state.kind === 'live' && state.snapshot.weekly?.percentUsed, 41);
    assert.equal(state.kind === 'live' && state.fetchedAt, NOW);
  });

  it('reports missing credentials without trying the network or the fallback', async () => {
    let fetched = false;
    const { service } = setup({
      token: '',
      fetch: async () => {
        fetched = true;
        return LIVE;
      },
      estimate: ESTIMATE,
    });
    assert.deepEqual(await service.resolve(NOW), { kind: 'noCredentials' });
    assert.equal(fetched, false);
  });

  it('falls back with an actionable reason on 401, and no backoff', async () => {
    const { service } = setup({
      fetch: async () => {
        throw new UsageApiError('HTTP 401: unauthorized', 401);
      },
      estimate: ESTIMATE,
    });
    assert.deepEqual(await service.resolve(NOW), {
      kind: 'fallback',
      estimate: ESTIMATE,
      reason: 'login rejected — run `claude` to refresh it',
      retryAfterSeconds: undefined,
    });
  });

  it('honours a server Retry-After longer than the minimum', async () => {
    const { service, log } = setup({
      fetch: async () => {
        throw new UsageApiError('HTTP 429: slow down', 429, 600);
      },
      estimate: ESTIMATE,
    });
    const state = await service.resolve(NOW);
    assert.equal(state.kind, 'fallback');
    assert.equal(state.kind === 'fallback' && state.retryAfterSeconds, 600);
    assert.ok(log.lines.some((l) => l.includes('(Retry-After: 600s)')), 'logs the header value');
  });

  it('never backs off less than the minimum, even if the server says Retry-After: 0', async () => {
    const { service } = setup({
      fetch: async () => {
        throw new UsageApiError('HTTP 429: slow down', 429, 0);
      },
      estimate: ESTIMATE,
    });
    const state = await service.resolve(NOW);
    assert.equal(state.kind === 'fallback' && state.retryAfterSeconds, 180);
  });

  it('falls back to a default backoff on 429 without a Retry-After header', async () => {
    const { service } = setup({
      fetch: async () => {
        throw new UsageApiError('HTTP 429: slow down', 429);
      },
      estimate: ESTIMATE,
    });
    const state = await service.resolve(NOW);
    assert.equal(state.kind === 'fallback' && state.retryAfterSeconds, 180);
  });

  it('falls back and logs the body when the response shape is unrecognised', async () => {
    const { service, log } = setup({
      fetch: async () => parseUsageResponse({ renamed: { pct: 9 } }),
      estimate: ESTIMATE,
    });
    const state = await service.resolve(NOW);
    assert.equal(state.kind, 'fallback');
    assert.ok(log.lines.some((l) => l.includes('{"renamed":{"pct":9}}')));
  });

  it('returns an error when both live and fallback are unavailable', async () => {
    const { service } = setup({
      fetch: async () => {
        throw new UsageApiError('Timed out after 10000 ms');
      },
    });
    assert.deepEqual(await service.resolve(NOW), {
      kind: 'error',
      message: 'Timed out after 10000 ms',
      retryAfterSeconds: undefined,
    });
  });

  it('never writes the access token to the log', async () => {
    const outcomes: Array<() => Promise<UsageSnapshot>> = [
      async () => LIVE,
      async () => parseUsageResponse({}),
      async () => {
        throw new UsageApiError('HTTP 500: oops', 500);
      },
      async () => {
        throw new Error('socket hang up');
      },
    ];
    for (const fetch of outcomes) {
      const { service, log } = setup({ fetch, estimate: ESTIMATE });
      await service.resolve(NOW);
      assert.ok(log.lines.every((l) => !l.includes(TOKEN)), log.lines.join('\n'));
    }
  });
});

describe('describeFailure', () => {
  it('maps auth failures, rate limits and other errors', () => {
    assert.match(describeFailure(new UsageApiError('x', 403)), /login rejected/);
    assert.equal(describeFailure(new UsageApiError('x', 429)), 'rate-limited by the usage endpoint');
    assert.equal(describeFailure(new UsageApiError('HTTP 502: bad gateway', 502)), 'HTTP 502: bad gateway');
    assert.equal(describeFailure(new Error('boom')), 'boom');
    assert.equal(describeFailure('plain'), 'plain');
  });
});

describe('rateLimitBackoffSeconds', () => {
  it('uses the longer of the server value and 180s, and nothing for other failures', () => {
    assert.equal(rateLimitBackoffSeconds(new UsageApiError('x', 429, 600)), 600);
    assert.equal(rateLimitBackoffSeconds(new UsageApiError('x', 429, 5)), 180);
    assert.equal(rateLimitBackoffSeconds(new UsageApiError('x', 429, 0)), 180);
    assert.equal(rateLimitBackoffSeconds(new UsageApiError('x', 429)), 180);
    assert.equal(rateLimitBackoffSeconds(new UsageApiError('x', 500)), undefined);
    assert.equal(rateLimitBackoffSeconds(new Error('boom')), undefined);
  });
});
