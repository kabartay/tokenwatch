/**
 * @file Parses Claude Code session transcripts (`~/.claude/projects/<dir>/<session>.jsonl`).
 *
 * Pure: these functions take a folder path, a line or a parsed entry and return plain data;
 * reading the files is `infrastructure/`'s job.
 */

import type { ContextReply } from './types';

/** Usage fields of a transcript entry that count toward context. */
interface UsageFields {
  input_tokens?: unknown;
  cache_creation_input_tokens?: unknown;
  cache_read_input_tokens?: unknown;
}

/**
 * Maps a folder to the transcript directory name Claude Code uses for it.
 *
 * @example encodeProjectDir('/Users/me/proj') === '-Users-me-proj'
 */
export function encodeProjectDir(folder: string): string {
  return folder.replace(/[^A-Za-z0-9]/g, '-');
}

/**
 * Extracts a context reading from one transcript line.
 *
 * Skips subagent (sidechain) entries, which have their own context, and zero-usage
 * synthetic entries.
 */
export function parseContextReply(line: string): ContextReply | undefined {
  if (!line.includes('"usage"')) return undefined;
  let entry: unknown;
  try {
    entry = JSON.parse(line);
  } catch {
    return undefined;
  }
  if (!entry || typeof entry !== 'object') return undefined;
  const e = entry as {
    isSidechain?: unknown;
    timestamp?: unknown;
    message?: { model?: unknown; usage?: UsageFields };
  };
  if (e.isSidechain === true) return undefined;
  const usage = e.message?.usage;
  if (!usage) return undefined;

  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  const tokens =
    num(usage.input_tokens) +
    num(usage.cache_creation_input_tokens) +
    num(usage.cache_read_input_tokens);
  if (tokens <= 0) return undefined;

  const at = typeof e.timestamp === 'string' ? new Date(e.timestamp) : new Date(NaN);
  return {
    tokens,
    model: typeof e.message?.model === 'string' ? e.message.model : undefined,
    at: Number.isNaN(at.getTime()) ? new Date(0) : at,
  };
}

/**
 * Extracts the token count and de-duplication key of one log entry.
 *
 * @param entry - One parsed JSON line from a session log.
 * @param since - Entries logged before this instant are ignored.
 * @returns `undefined` for entries without usage or logged before `since`.
 */
export function tokenUsageOf(
  entry: unknown,
  since: Date,
): { key: string; tokens: number } | undefined {
  if (!entry || typeof entry !== 'object') return undefined;
  const e = entry as {
    timestamp?: unknown;
    requestId?: unknown;
    message?: { id?: unknown; usage?: { input_tokens?: unknown; output_tokens?: unknown } };
  };
  const usage = e.message?.usage;
  if (!usage || typeof e.timestamp !== 'string') return undefined;
  const at = new Date(e.timestamp);
  if (Number.isNaN(at.getTime()) || at < since) return undefined;

  const input = typeof usage.input_tokens === 'number' ? usage.input_tokens : 0;
  const output = typeof usage.output_tokens === 'number' ? usage.output_tokens : 0;
  const requestId = typeof e.requestId === 'string' ? e.requestId : '';
  // Without a string message id, fall back to the timestamp so distinct entries never collapse.
  const messageId = e.message?.id;
  const messageKey = typeof messageId === 'string' && messageId ? messageId : `ts:${e.timestamp}`;
  return { key: `${messageKey}:${requestId}`, tokens: input + output };
}
