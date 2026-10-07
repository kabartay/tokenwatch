/**
 * @file Tests for presentation helpers.
 */

import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import {
  formatClock,
  formatCountdown,
  formatDuration,
  formatPercent,
  formatTimeUntil,
  formatTokens,
  formatTokensRounded,
  summarizeState,
} from '../../domain/format';

describe('summarizeState', () => {
  const now = new Date('2026-10-07T12:00:00Z');

  it('summarises live quota with the session reset', () => {
    const text = summarizeState(
      {
        kind: 'live',
        fetchedAt: now,
        snapshot: {
          raw: {},
          session: { percentUsed: 42, resetsAt: new Date('2026-10-07T14:13:00Z') },
          weekly: { percentUsed: 18 },
        },
      },
      now,
    );
    assert.equal(text, '5h 42% ↻2h 13m · wk 18%');
  });

  it('marks kept-on-screen numbers as stale with their time', () => {
    const fetchedAt = new Date('2026-10-07T11:41:00Z');
    const text = summarizeState(
      {
        kind: 'live',
        fetchedAt,
        staleReason: 'rate-limited',
        snapshot: { raw: {}, session: { percentUsed: 16 }, weekly: { percentUsed: 43 } },
      },
      now,
    );
    assert.equal(text, `5h 16% · wk 43% (as of ${formatClock(fetchedAt)}; rate-limited)`);
  });

  it('names the reason when falling back', () => {
    const text = summarizeState({
      kind: 'fallback',
      reason: 'HTTP 500',
      estimate: { tokensToday: 1_250_000, messageCount: 3 },
    });
    assert.equal(text, 'live quota unavailable (HTTP 500); ~1.3M tokens today');
  });
});

describe('formatPercent', () => {
  it('rounds and handles unknown', () => {
    assert.equal(formatPercent(42.6), '43%');
    assert.equal(formatPercent(0), '0%');
    assert.equal(formatPercent(undefined), '–');
  });
});

describe('formatTimeUntil', () => {
  const now = new Date('2026-10-07T12:00:00Z');
  const after = (minutes: number) => new Date(now.getTime() + minutes * 60_000);

  it('uses the two largest units', () => {
    assert.equal(formatTimeUntil(after(7), now), 'in 7m');
    assert.equal(formatTimeUntil(after(133), now), 'in 2h 13m');
    assert.equal(formatTimeUntil(after(3 * 1_440 + 4 * 60 + 59), now), 'in 3d 4h');
  });

  it('says now once the time has passed', () => {
    assert.equal(formatTimeUntil(after(0), now), 'now');
    assert.equal(formatTimeUntil(after(-10), now), 'now');
  });
});

describe('formatTokens', () => {
  it('abbreviates thousands and millions', () => {
    assert.equal(formatTokens(950), '950');
    assert.equal(formatTokens(12_345), '12.3k');
    assert.equal(formatTokens(4_100_000), '4.1M');
  });
});

describe('formatDuration / formatCountdown', () => {
  const now = new Date('2026-10-07T12:00:00Z');

  it('formats durations without a prefix', () => {
    assert.equal(formatDuration(8 * 60_000), '8m');
    assert.equal(formatDuration((4 * 60 + 8) * 60_000), '4h 8m');
    assert.equal(formatDuration(0), 'now');
  });

  it('prefixes the countdown with the reset symbol', () => {
    assert.equal(formatCountdown(new Date(now.getTime() + 248 * 60_000), now), '↻4h 8m');
  });
});

describe('formatTokensRounded', () => {
  it('rounds to whole thousands and tidy millions', () => {
    assert.equal(formatTokensRounded(950), '950');
    assert.equal(formatTokensRounded(291_388), '291k');
    assert.equal(formatTokensRounded(999_700), '1M');
    assert.equal(formatTokensRounded(1_000_000), '1M');
    assert.equal(formatTokensRounded(1_520_000), '1.5M');
  });
});
