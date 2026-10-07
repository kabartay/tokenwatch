/**
 * @file Tests for progress bars, pace projection and alert levels.
 */

import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { assess, describePace, paceOf, progressBar, WINDOW_LENGTH_MS } from '../../domain/insights';
import type { UsageSnapshot, UsageWindow } from '../../domain/types';

const HOUR = 3_600_000;
const NOW = new Date('2026-10-07T12:00:00Z');
const at = (msFromNow: number) => new Date(NOW.getTime() + msFromNow);

/** A 5-hour window that started `elapsedHours` ago and is `percent` used. */
const session = (percent: number, elapsedHours: number): UsageWindow => ({
  percentUsed: percent,
  resetsAt: at((5 - elapsedHours) * HOUR),
});

describe('progressBar', () => {
  it('fills proportionally and clamps', () => {
    assert.equal(progressBar(0), '▱▱▱▱▱');
    assert.equal(progressBar(41), '▰▰▱▱▱');
    assert.equal(progressBar(100), '▰▰▰▰▰');
    assert.equal(progressBar(250), '▰▰▰▰▰');
    assert.equal(progressBar(-5), '▱▱▱▱▱');
  });

  it('shows at least one segment for any non-zero usage', () => {
    assert.equal(progressBar(1), '▰▱▱▱▱');
    assert.equal(progressBar(4, 10), '▰▱▱▱▱▱▱▱▱▱');
  });
});

describe('paceOf', () => {
  it('projects linearly from the window start', () => {
    // 10% after 1h of a 5h window: 10%/h, so 50% by the reset in 4h.
    const pace = paceOf(session(10, 1), WINDOW_LENGTH_MS.session, NOW);
    assert.ok(pace);
    assert.equal(Math.round(pace.percentPerHour), 10);
    assert.equal(Math.round(pace.projectedAtReset), 50);
    assert.equal(pace.limitAt, undefined);
  });

  it('predicts when a fast window runs out', () => {
    // 40% after 1h: 40%/h, so 100% after another 1.5h, before the reset in 4h.
    const pace = paceOf(session(40, 1), WINDOW_LENGTH_MS.session, NOW);
    assert.ok(pace);
    assert.equal(pace.limitAt?.getTime(), at(1.5 * HOUR).getTime());
    assert.equal(describePace(pace, NOW), 'runs out in 1h 30m');
  });

  it('says nothing in the first minutes of a window, when one prompt would skew it', () => {
    assert.equal(paceOf(session(5, 0.05), WINDOW_LENGTH_MS.session, NOW), undefined);
  });

  it('needs a reset time', () => {
    assert.equal(paceOf({ percentUsed: 50 }, WINDOW_LENGTH_MS.session, NOW), undefined);
  });

  it('describes a comfortable pace as the projected total', () => {
    const pace = paceOf(session(9, 1), WINDOW_LENGTH_MS.session, NOW);
    assert.ok(pace);
    assert.equal(describePace(pace, NOW), '~45% at reset');
  });
});

describe('assess', () => {
  const snap = (s?: UsageWindow, w?: UsageWindow): UsageSnapshot => ({ session: s, weekly: w, raw: {} });

  it('is ok at a comfortable pace', () => {
    assert.deepEqual(assess(snap(session(9, 1)), 80, NOW), { level: 'ok' });
  });

  it('watches a window that will run out before it resets, but not soon', () => {
    // 30% after 1h: 30%/h, runs out in ~2h20m, reset in 4h.
    assert.equal(assess(snap(session(30, 1)), 80, NOW).level, 'watch');
  });

  it('warns when the limit is under an hour away', () => {
    // 60% after 1h: runs out in 40m.
    const result = assess(snap(session(60, 1)), 80, NOW);
    assert.equal(result.level, 'warn');
    assert.match(result.reason ?? '', /runs out before it resets/);
  });

  it('warns at the threshold even at a slow pace', () => {
    const weekly: UsageWindow = { percentUsed: 85, resetsAt: at(1 * HOUR) };
    assert.deepEqual(assess(snap(undefined, weekly), 80, NOW), {
      level: 'warn',
      reason: 'weekly quota is past 80%',
    });
  });

  it('is critical at 100%, whichever window it is', () => {
    const result = assess(snap(session(9, 1), { percentUsed: 100 }), 80, NOW);
    assert.equal(result.level, 'critical');
    assert.equal(result.reason, 'weekly quota is used up');
  });
});
