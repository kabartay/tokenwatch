/**
 * @file Derived views of a snapshot: progress bars, pace projections and the alert level.
 *
 * Pace needs no stored history. A window's reset time and fixed length give its start, so the
 * average pace is simply `percentUsed / elapsed`. That stays correct across reloads and works
 * from the very first poll.
 */

import { formatDuration } from './format';
import type { UsageSnapshot, UsageWindow } from './types';

/** Fixed length of each quota window. */
export const WINDOW_LENGTH_MS = {
  session: 5 * 60 * 60 * 1_000,
  weekly: 7 * 24 * 60 * 60 * 1_000,
} as const;

export type WindowName = keyof typeof WINDOW_LENGTH_MS;

/**
 * Projections from fewer than this many minutes of elapsed window are mostly noise
 * (one large prompt in the first minute would "project" far past 100%).
 */
const MIN_ELAPSED_FOR_PACE_MS = 10 * 60 * 1_000;

/** Where a window is heading at its average pace so far. */
export interface Pace {
  /** Average consumption so far, in percentage points per hour. */
  readonly percentPerHour: number;
  /** Projected utilization when the window resets, if the pace holds. Can exceed 100. */
  readonly projectedAtReset: number;
  /** When the window would reach 100%, if that happens before it resets. */
  readonly limitAt?: Date;
}

/**
 * Projects a window forward at its average pace since it started.
 *
 * @param window - The window to project; needs `resetsAt`.
 * @param lengthMs - The window's fixed length, from {@link WINDOW_LENGTH_MS}.
 * @param now - Reference time; injectable for tests.
 * @returns The projection, or `undefined` when there's too little elapsed time to be meaningful.
 */
export function paceOf(window: UsageWindow, lengthMs: number, now: Date = new Date()): Pace | undefined {
  if (!window.resetsAt) return undefined;
  const resetMs = window.resetsAt.getTime();
  const elapsedMs = now.getTime() - (resetMs - lengthMs);
  const remainingMs = resetMs - now.getTime();
  if (elapsedMs < MIN_ELAPSED_FOR_PACE_MS || remainingMs <= 0) return undefined;

  const perMs = window.percentUsed / elapsedMs;
  const projectedAtReset = window.percentUsed + perMs * remainingMs;
  const msToLimit = perMs > 0 ? (100 - window.percentUsed) / perMs : Infinity;
  return {
    percentPerHour: perMs * 3_600_000,
    projectedAtReset,
    limitAt:
      window.percentUsed < 100 && msToLimit < remainingMs
        ? new Date(now.getTime() + msToLimit)
        : undefined,
  };
}

/**
 * Describes a pace in a few words, for the tooltip.
 *
 * @returns For example `"runs out in 1h 20m"` or `"~45% at reset"`.
 */
export function describePace(pace: Pace, now: Date = new Date()): string {
  if (pace.limitAt) return `runs out in ${formatDuration(pace.limitAt.getTime() - now.getTime())}`;
  return `~${Math.round(pace.projectedAtReset)}% at reset`;
}

/** How loudly the status bar should ask for attention, from calm to urgent. */
export type AlertLevel = 'ok' | 'watch' | 'warn' | 'critical';

/** The alert level and the one-line reason for it. */
export interface Assessment {
  readonly level: AlertLevel;
  /** Why the level isn't `ok`, for the tooltip; undefined when it is. */
  readonly reason?: string;
}

/** A limit closer than this, at the current pace, escalates `watch` to `warn`. */
const IMMINENT_LIMIT_MS = 60 * 60 * 1_000;

const RANK: Record<AlertLevel, number> = { ok: 0, watch: 1, warn: 2, critical: 3 };

/**
 * Decides the alert level from both windows.
 *
 * - `critical`: a window is at 100%.
 * - `warn`: a window has reached the threshold, or will hit 100% within the hour at this pace.
 * - `watch`: at this pace a window will hit 100% before it resets.
 * - `ok`: otherwise.
 *
 * @param thresholdPercent - The user's `warnThresholdPercent`.
 */
export function assess(
  snapshot: UsageSnapshot,
  thresholdPercent: number,
  now: Date = new Date(),
): Assessment {
  let worst: Assessment = { level: 'ok' };
  const consider = (candidate: Assessment) => {
    if (RANK[candidate.level] > RANK[worst.level]) worst = candidate;
  };

  for (const [name, window] of windowsOf(snapshot)) {
    const label = name === 'session' ? '5-hour session' : 'weekly quota';
    if (window.percentUsed >= 100) {
      consider({ level: 'critical', reason: `${label} is used up` });
      continue;
    }
    if (window.percentUsed >= thresholdPercent) {
      consider({ level: 'warn', reason: `${label} is past ${thresholdPercent}%` });
    }
    const limitAt = paceOf(window, WINDOW_LENGTH_MS[name], now)?.limitAt;
    if (limitAt) {
      const imminent = limitAt.getTime() - now.getTime() < IMMINENT_LIMIT_MS;
      consider({
        level: imminent ? 'warn' : 'watch',
        reason: `at this pace the ${label} runs out before it resets`,
      });
    }
  }
  return worst;
}

/** @returns The windows present in a snapshot, with their names. */
export function windowsOf(snapshot: UsageSnapshot): Array<[WindowName, UsageWindow]> {
  const out: Array<[WindowName, UsageWindow]> = [];
  if (snapshot.session) out.push(['session', snapshot.session]);
  if (snapshot.weekly) out.push(['weekly', snapshot.weekly]);
  return out;
}

/**
 * Draws a text progress bar.
 *
 * Any non-zero usage shows at least one filled segment, so 1% never looks like 0%.
 *
 * @param percent - Usage in `[0, 100]`; values outside are clamped.
 * @param segments - Bar width in characters.
 * @returns For example `"▰▰▱▱▱"` for 41% at 5 segments.
 */
export function progressBar(percent: number, segments = 5, filled = '▰', empty = '▱'): string {
  const clamped = Math.min(100, Math.max(0, percent));
  let n = Math.round((clamped / 100) * segments);
  if (clamped > 0 && n === 0) n = 1;
  return filled.repeat(n) + empty.repeat(segments - n);
}
