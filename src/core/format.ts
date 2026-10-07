/**
 * @file Pure presentation helpers shared by the status bar and its tooltip.
 */

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
 * Describes how long until `target`, coarsened to the two largest units.
 *
 * @param target - The future instant.
 * @param now - Reference time; injectable for tests.
 * @returns For example `"in 2h 13m"`, `"in 3d 4h"`, or `"now"` once passed.
 */
export function formatTimeUntil(target: Date, now: Date = new Date()): string {
  const totalMinutes = Math.floor((target.getTime() - now.getTime()) / 60_000);
  if (totalMinutes <= 0) return 'now';
  const days = Math.floor(totalMinutes / 1_440);
  const hours = Math.floor((totalMinutes % 1_440) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) return `in ${days}d ${hours}h`;
  if (hours > 0) return `in ${hours}h ${minutes}m`;
  return `in ${minutes}m`;
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
