/**
 * @file Tests for presentation helpers.
 */

import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { formatPercent, formatTimeUntil, formatTokens, summarizeState } from '../core/format';

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
    assert.equal(text, '5h 42% (resets in 2h 13m) · wk 18%');
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
