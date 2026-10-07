/**
 * @file Chooses a model's context window size and turns a reply into a {@link ContextReading}.
 *
 * Transcripts record the model but not its window size, so the size comes from settings or is
 * inferred. Pure: no I/O.
 */

import type { ContextReading, ContextReply } from './types';

/** The standard context window, used when nothing indicates a larger one. */
export const STANDARD_CONTEXT_TOKENS = 200_000;
/** The extended window some models run with; assumed once a session exceeds the standard one. */
export const EXTENDED_CONTEXT_TOKENS = 1_000_000;

/**
 * Chooses the context window size for a model.
 *
 * Lookup order: an exact model id, then the longest key the id starts with (so
 * `"claude-opus"` covers every Opus version), then `"*"`. Without a match, a session that has
 * grown past the standard window must be using the extended one; otherwise the standard
 * window is assumed.
 *
 * @returns The size and whether it was inferred rather than configured.
 */
export function windowFor(
  model: string | undefined,
  tokens: number,
  windowSizes: Readonly<Record<string, number>>,
): { windowTokens: number; inferred: boolean } {
  const valid = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0;
  if (model) {
    if (valid(windowSizes[model])) return { windowTokens: windowSizes[model], inferred: false };
    const prefix = Object.keys(windowSizes)
      .filter((k) => k !== '*' && model.startsWith(k) && valid(windowSizes[k]))
      .sort((a, b) => b.length - a.length)[0];
    if (prefix) return { windowTokens: windowSizes[prefix], inferred: false };
  }
  if (valid(windowSizes['*'])) return { windowTokens: windowSizes['*'], inferred: false };
  return {
    windowTokens: tokens > STANDARD_CONTEXT_TOKENS ? EXTENDED_CONTEXT_TOKENS : STANDARD_CONTEXT_TOKENS,
    inferred: true,
  };
}

/** Turns a raw reply into a reading. */
export function toReading(
  reply: ContextReply,
  windowSizes: Readonly<Record<string, number>>,
): ContextReading {
  const { windowTokens, inferred } = windowFor(reply.model, reply.tokens, windowSizes);
  return {
    tokens: reply.tokens,
    windowTokens,
    windowInferred: inferred,
    percent: (reply.tokens / windowTokens) * 100,
    model: reply.model,
    at: reply.at,
  };
}
