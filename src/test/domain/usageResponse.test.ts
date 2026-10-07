/**
 * @file Tests for usage-response parsing.
 */

import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { hasAnyWindow, parseUsageResponse } from '../../domain/usageResponse';

describe('parseUsageResponse', () => {
  it('parses the five_hour / seven_day shape', () => {
    const snap = parseUsageResponse({
      five_hour: { utilization: 42.4, resets_at: '2026-10-07T20:00:00Z' },
      seven_day: { utilization: 18, resets_at: '2026-10-12T08:00:00Z' },
      seven_day_opus: null,
    });
    assert.equal(snap.session?.percentUsed, 42.4);
    assert.equal(snap.session?.resetsAt?.toISOString(), '2026-10-07T20:00:00.000Z');
    assert.equal(snap.weekly?.percentUsed, 18);
    assert.ok(hasAnyWindow(snap));
  });

  it('keeps a window whose reset time is missing or invalid', () => {
    const snap = parseUsageResponse({ five_hour: { utilization: 5, resets_at: 'garbage' } });
    assert.equal(snap.session?.percentUsed, 5);
    assert.equal(snap.session?.resetsAt, undefined);
    assert.equal(snap.weekly, undefined);
  });

  it('drops windows without a numeric utilization', () => {
    const snap = parseUsageResponse({ five_hour: { utilization: '42' }, seven_day: null });
    assert.equal(hasAnyWindow(snap), false);
  });

  it('clamps negative utilization to zero', () => {
    assert.equal(parseUsageResponse({ seven_day: { utilization: -3 } }).weekly?.percentUsed, 0);
  });

  it('keeps the raw body for unrecognised shapes', () => {
    const body = { something: 'else' };
    const snap = parseUsageResponse(body);
    assert.equal(hasAnyWindow(snap), false);
    assert.equal(snap.raw, body);
    assert.equal(hasAnyWindow(parseUsageResponse([1, 2])), false);
    assert.equal(hasAnyWindow(parseUsageResponse(null)), false);
  });
});
