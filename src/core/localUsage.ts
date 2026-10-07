/**
 * @file Estimates today's token consumption from Claude Code's local session logs.
 *
 * Local logs only show consumption; plan limits live server-side, so this can never yield a
 * remaining-quota percentage. It exists as a fallback for when the usage endpoint fails.
 */

import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { LocalUsageEstimate } from './types';

/** Bytes read per `read()` call while scanning a log file. */
const CHUNK_BYTES = 4 * 1024 * 1024;
const NEWLINE = 0x0a;

/**
 * Sums token usage from `~/.claude/projects/**\/*.jsonl` for the current local day.
 *
 * Session logs are append-only and a long session's file can reach hundreds of megabytes,
 * so the estimator is incremental: it remembers how far it has read in each file and only
 * parses the newly appended tail on later calls. State resets at local midnight.
 */
export class LocalUsageEstimator {
  private dayStartMs = -1;
  private readonly offsets = new Map<string, number>();
  private readonly seen = new Map<string, number>();
  private tokensToday = 0;

  /** @param projectsDir - Root of Claude Code's per-project session logs. */
  constructor(
    private readonly projectsDir = path.join(os.homedir(), '.claude', 'projects'),
  ) {}

  /**
   * Brings the running total up to date and returns it.
   *
   * Files last modified before local midnight are skipped without being opened. Streamed
   * responses log the same message more than once, so entries are de-duplicated by message
   * id and request id. Calls must not overlap; the controller serialises them.
   *
   * @param now - Reference time; injectable for tests.
   * @returns The estimate, or `undefined` if no usage was logged today.
   */
  async estimateToday(now: Date = new Date()): Promise<LocalUsageEstimate | undefined> {
    const since = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    if (since.getTime() !== this.dayStartMs) this.resetForDay(since);

    for await (const { file, size } of this.recentLogFiles(this.projectsDir, since)) {
      await this.scanTail(file, size, since);
    }
    return this.seen.size > 0
      ? { tokensToday: this.tokensToday, messageCount: this.seen.size }
      : undefined;
  }

  private resetForDay(since: Date): void {
    this.dayStartMs = since.getTime();
    this.offsets.clear();
    this.seen.clear();
    this.tokensToday = 0;
  }

  private async *recentLogFiles(
    dir: string,
    since: Date,
  ): AsyncGenerator<{ file: string; size: number }> {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        yield* this.recentLogFiles(full, since);
      } else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
        const stat = await fs.stat(full).catch(() => undefined);
        if (stat && stat.mtime >= since) yield { file: full, size: stat.size };
      }
    }
  }

  /**
   * Parses the complete lines appended to `file` since the last call.
   *
   * A trailing partial line (a write in progress) is left unread and picked up next time.
   * A file that shrank was rewritten, so it is rescanned from the start; the de-duplication
   * keys keep that from double counting.
   */
  private async scanTail(file: string, size: number, since: Date): Promise<void> {
    const previous = this.offsets.get(file) ?? 0;
    let position = previous > size ? 0 : previous;
    if (position === size) return;

    let handle;
    try {
      handle = await fs.open(file, 'r');
    } catch {
      return;
    }
    try {
      const chunk = Buffer.alloc(CHUNK_BYTES);
      let pending = Buffer.alloc(0);
      while (position < size) {
        const { bytesRead } = await handle.read(
          chunk,
          0,
          Math.min(CHUNK_BYTES, size - position),
          position,
        );
        if (bytesRead === 0) break;
        position += bytesRead;

        const fresh = chunk.subarray(0, bytesRead);
        const data = pending.length > 0 ? Buffer.concat([pending, fresh]) : fresh;
        const lastNewline = data.lastIndexOf(NEWLINE);
        if (lastNewline === -1) {
          pending = Buffer.from(data);
          continue;
        }
        this.consumeLines(data.subarray(0, lastNewline).toString('utf8'), since);
        pending = Buffer.from(data.subarray(lastNewline + 1));
      }
      this.offsets.set(file, position - pending.length);
    } catch {
      // Unreadable mid-scan: keep what was counted and retry the file from its old offset.
    } finally {
      await handle.close();
    }
  }

  private consumeLines(text: string, since: Date): void {
    for (const line of text.split('\n')) {
      // Most lines are tool output; skipping them before JSON.parse is the main speed-up.
      if (!line.includes('"usage"')) continue;
      let entry: unknown;
      try {
        entry = JSON.parse(line);
      } catch {
        continue;
      }
      const usage = tokenUsageOf(entry, since);
      if (!usage || this.seen.has(usage.key)) continue;
      this.seen.set(usage.key, usage.tokens);
      this.tokensToday += usage.tokens;
    }
  }
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
  const requestId = String(e.requestId ?? '');
  // Without a message id, fall back to the timestamp so distinct entries never collapse.
  const messageKey = e.message?.id ? String(e.message.id) : `ts:${e.timestamp}`;
  return { key: `${messageKey}:${requestId}`, tokens: input + output };
}
