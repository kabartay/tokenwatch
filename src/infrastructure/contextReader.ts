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
import type { ContextSource } from '../application/ports';
import { toReading } from '../domain/contextWindow';
import { encodeProjectDir, parseContextReply } from '../domain/transcript';
import type { ContextReading, ContextReply } from '../domain/types';

/** Bytes read from the end of a transcript, growing until a reply with usage is found. */
const TAIL_STEPS = [256 * 1024, 4 * 1024 * 1024] as const;

/** Finds and reads the latest session transcript for a set of workspace folders. */
export class ContextReader implements ContextSource {
  /** @param projectsDir - Root of Claude Code's per-project transcripts. */
  constructor(
    private readonly projectsDir = path.join(os.homedir(), '.claude', 'projects'),
  ) {}

  /**
   * Reads the context size of the most recently active session in any of `folders`.
   *
   * @param folders - Absolute paths of the workspace folders open in this window.
   * @param windowSizes - Context window per model id from settings; see `windowFor` in domain/contextWindow.ts.
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

/** The last main-thread reply with usage in a transcript, or `undefined`. */
async function lastReply(
  file: string,
): Promise<ContextReply | undefined> {
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
        const reply = parseContextReply(lines[i] ?? '');
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
