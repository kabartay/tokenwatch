/**
 * @file Reads how full the context window is in the latest Claude Code session for a folder.
 *
 * Claude Code writes one `.jsonl` transcript per session under
 * `~/.claude/projects/<folder path with every non-alphanumeric character replaced by '-'>/`.
 * The last main-thread reply records the tokens it was sent: `input_tokens +
 * cache_creation_input_tokens + cache_read_input_tokens`, which is the context size `/context`
 * reports. Transcripts don't record the model's window size, so that comes from settings or
 * is inferred.
 *
 * A transcript lives under the folder the session *started* in and keeps its context when
 * Claude later changes directory, so entries are not filtered by their `cwd`. Two folders whose
 * paths differ only in punctuation share a directory name; that collision is accepted.
 */

import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';

/** The standard context window, used when nothing indicates a larger one. */
export const STANDARD_CONTEXT_TOKENS = 200_000;
/** The extended window some models run with; assumed once a session exceeds the standard one. */
export const EXTENDED_CONTEXT_TOKENS = 1_000_000;

/** Bytes read from the end of a transcript, growing until a reply with usage is found. */
const TAIL_STEPS = [256 * 1024, 4 * 1024 * 1024] as const;

/** One context-size reading. */
export interface ContextReading {
  /** Tokens in context at the last reply. */
  readonly tokens: number;
  /** Window size the percentage is relative to. */
  readonly windowTokens: number;
  /** Whether `windowTokens` was inferred rather than taken from settings. */
  readonly windowInferred: boolean;
  /** `tokens / windowTokens` as a percentage; can exceed 100 if the window is set too small. */
  readonly percent: number;
  /** Model that produced the last reply, e.g. `claude-opus-5-5`. */
  readonly model?: string;
  /** When the last reply was logged. */
  readonly at: Date;
}

/** Usage fields of a transcript entry that count toward context. */
interface UsageFields {
  input_tokens?: unknown;
  cache_creation_input_tokens?: unknown;
  cache_read_input_tokens?: unknown;
}

/** Finds and reads the latest session transcript for a set of workspace folders. */
export class ContextReader {
  /** @param projectsDir - Root of Claude Code's per-project transcripts. */
  constructor(
    private readonly projectsDir = path.join(os.homedir(), '.claude', 'projects'),
  ) {}

  /**
   * Reads the context size of the most recently active session in any of `folders`.
   *
   * @param folders - Absolute paths of the workspace folders open in this window.
   * @param windowSizes - Context window per model id from settings; see {@link windowFor}.
   * @returns The reading, or `undefined` if no session in these folders has replied yet.
   */
  async read(
    folders: readonly string[],
    windowSizes: Readonly<Record<string, number>>,
  ): Promise<ContextReading | undefined> {
    for (const { file } of await this.sessionsNewestFirst(folders)) {
      const reply = await lastReply(file);
      if (reply) return toReading(reply, windowSizes);
    }
    return undefined;
  }

  private async sessionsNewestFirst(
    folders: readonly string[],
  ): Promise<Array<{ file: string }>> {
    const found: Array<{ file: string; mtimeMs: number }> = [];
    for (const folder of folders) {
      const dir = path.join(this.projectsDir, encodeProjectDir(folder));
      let names: string[];
      try {
        names = await fs.readdir(dir);
      } catch {
        continue;
      }
      for (const name of names.filter((n) => n.endsWith('.jsonl'))) {
        const file = path.join(dir, name);
        const stat = await fs.stat(file).catch(() => undefined);
        if (stat?.isFile()) found.push({ file, mtimeMs: stat.mtimeMs });
      }
    }
    return found.sort((a, b) => b.mtimeMs - a.mtimeMs);
  }
}

/**
 * Maps a folder to the transcript directory name Claude Code uses for it.
 *
 * @example encodeProjectDir('/Users/me/proj') === '-Users-me-proj'
 */
export function encodeProjectDir(folder: string): string {
  return folder.replace(/[^A-Za-z0-9]/g, '-');
}

/** The last main-thread reply with usage in a transcript, or `undefined`. */
async function lastReply(
  file: string,
): Promise<{ tokens: number; model?: string; at: Date } | undefined> {
  let handle;
  try {
    handle = await fs.open(file, 'r');
  } catch {
    return undefined;
  }
  try {
    const { size } = await handle.stat();
    for (const step of TAIL_STEPS) {
      const start = Math.max(0, size - step);
      const length = size - start;
      const buffer = Buffer.alloc(length);
      await handle.read(buffer, 0, length, start);
      const lines = buffer.toString('utf8').split('\n');
      // The first line is usually cut in half unless the whole file was read.
      if (start > 0) lines.shift();
      for (let i = lines.length - 1; i >= 0; i--) {
        const reply = parseReply(lines[i] ?? '');
        if (reply) return reply;
      }
      if (start === 0) return undefined;
    }
    return undefined;
  } catch {
    return undefined;
  } finally {
    await handle.close();
  }
}

/**
 * Extracts a context reading from one transcript line.
 *
 * Skips subagent (sidechain) entries, which have their own context, and zero-usage
 * synthetic entries.
 */
export function parseReply(line: string): { tokens: number; model?: string; at: Date } | undefined {
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
  reply: { tokens: number; model?: string; at: Date },
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
