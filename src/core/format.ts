/**
 * @file Pure presentation helpers shared by the status bar, its tooltip and notifications.
 */

import type { UsageState } from './types';

/** Prefix for a reset countdown. Plain Unicode, so it renders in notifications and logs too. */
export const RESET_SYMBOL = '↻';

/**
 * Summarises a state in one line, for notifications and the log.
 *
 * @returns For example `"5h 9% ↻4h 8m · wk 41%"`.
 */
export function summarizeState(state: UsageState, now: Date = new Date()): string {
  switch (state.kind) {
    case 'loading':
      return 'fetching usage…';
    case 'noCredentials':
      return 'no Claude Code login found';
    case 'live': {
      const { session, weekly } = state.snapshot;
      const reset = session?.resetsAt ? ` ${formatCountdown(session.resetsAt, now)}` : '';
      return `5h ${formatPercent(session?.percentUsed)}${reset} · wk ${formatPercent(weekly?.percentUsed)}`;
    }
    case 'fallback':
      return `live quota unavailable (${state.reason}); ~${formatTokens(state.estimate.tokensToday)} tokens today`;
    case 'error':
      return `error: ${state.message}`;
  }
}

/**
 * Formats a percentage for the status bar.
 *
 * @param percent - Value in `[0, 100]`, or `undefined` when unknown.
 * @returns For example `"42%"`, or `"–"` when unknown.
 */
export function formatPercent(percent: number | undefined): string {
  return percent === undefined ? '–' : `${Math.round(percent)}%`;
}

/**
 * Formats a duration coarsened to its two largest units.
 *
 * @param ms - Duration in milliseconds.
 * @returns For example `"2h 13m"`, `"3d 4h"`, `"7m"`, or `"now"` when zero or negative.
 */
export function formatDuration(ms: number): string {
  const totalMinutes = Math.floor(ms / 60_000);
  if (totalMinutes <= 0) return 'now';
  const days = Math.floor(totalMinutes / 1_440);
  const hours = Math.floor((totalMinutes % 1_440) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

/**
 * Describes how long until `target`, for prose.
 *
 * @returns For example `"in 2h 13m"`, or `"now"` once passed.
 */
export function formatTimeUntil(target: Date, now: Date = new Date()): string {
  const d = formatDuration(target.getTime() - now.getTime());
  return d === 'now' ? d : `in ${d}`;
}

/**
 * Compact reset countdown for tight spaces.
 *
 * @returns For example `"↻4h 8m"`.
 */
export function formatCountdown(target: Date, now: Date = new Date()): string {
  return `${RESET_SYMBOL}${formatDuration(target.getTime() - now.getTime())}`;
}

/**
 * Formats a token count compactly.
 *
 * @returns For example `"950"`, `"12.3k"`, `"4.1M"`.
 */
export function formatTokens(tokens: number): string {
  if (tokens < 1_000) return String(tokens);
  if (tokens < 1_000_000) return `${(tokens / 1_000).toFixed(1)}k`;
  return `${(tokens / 1_000_000).toFixed(1)}M`;
}
