/**
 * @file Maps the usage endpoint's JSON body onto a {@link UsageSnapshot}.
 *
 * Pure: no I/O. The shape, `{"five_hour": {"utilization": 42, "resets_at": "<ISO>"},
 * "seven_day": {...}}`, was confirmed against a live account on 2026-10-07 (see
 * docs/USAGE_ENDPOINT.md). A few plausible renames are accepted too, and the raw body is kept,
 * so a future change degrades to the local fallback instead of showing wrong numbers.
 */

import type { UsageSnapshot, UsageWindow } from './types';

const SESSION_KEYS = ['five_hour', 'fiveHour', 'session'] as const;
const WEEKLY_KEYS = ['seven_day', 'sevenDay', 'weekly'] as const;
const PERCENT_KEYS = ['utilization', 'percent', 'percentage'] as const;
const RESET_KEYS = ['resets_at', 'resetsAt', 'reset_at'] as const;

/**
 * Maps a raw response body onto a {@link UsageSnapshot}.
 *
 * @param body - Parsed JSON from the usage endpoint.
 * @returns A snapshot; `session`/`weekly` are undefined when not recognised.
 */
export function parseUsageResponse(body: unknown): UsageSnapshot {
  if (!isRecord(body)) return { raw: body };
  return {
    session: parseWindow(firstRecord(body, SESSION_KEYS)),
    weekly: parseWindow(firstRecord(body, WEEKLY_KEYS)),
    raw: body,
  };
}

/** @returns True if the snapshot carries at least one usable window. */
export function hasAnyWindow(snapshot: UsageSnapshot): boolean {
  return snapshot.session !== undefined || snapshot.weekly !== undefined;
}

function parseWindow(section: Record<string, unknown> | undefined): UsageWindow | undefined {
  if (!section) return undefined;
  const percentUsed = firstValue(section, PERCENT_KEYS, isFiniteNumber);
  if (percentUsed === undefined) return undefined;
  const resetRaw = firstValue(section, RESET_KEYS, (v): v is string => typeof v === 'string');
  const resetsAt = resetRaw === undefined ? undefined : new Date(resetRaw);
  return {
    percentUsed: Math.max(0, percentUsed),
    resetsAt: resetsAt && !Number.isNaN(resetsAt.getTime()) ? resetsAt : undefined,
  };
}

function firstRecord(
  obj: Record<string, unknown>,
  keys: readonly string[],
): Record<string, unknown> | undefined {
  return firstValue(obj, keys, isRecord);
}

function firstValue<T>(
  obj: Record<string, unknown>,
  keys: readonly string[],
  guard: (v: unknown) => v is T,
): T | undefined {
  for (const key of keys) {
    const value = obj[key];
    if (guard(value)) return value;
  }
  return undefined;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}
