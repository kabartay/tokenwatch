import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';

/**
 * Local .jsonl session logs only reveal consumption, not the server-side
 * plan limits, so this can show "tokens used today" but never a true
 * remaining-quota percentage. It's a last-resort fallback for when the
 * usage endpoint is unreachable, not a replacement for it.
 */
export async function estimateTokensUsedToday(): Promise<number | undefined> {
  const projectsDir = path.join(os.homedir(), '.claude', 'projects');
  let totalTokens = 0;
  let foundAny = false;

  const todayPrefix = new Date().toISOString().slice(0, 10);

  async function walk(dir: string): Promise<void> {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
        await scanFile(full);
      }
    }
  }

  async function scanFile(file: string): Promise<void> {
    let raw: string;
    try {
      raw = await fs.readFile(file, 'utf8');
    } catch {
      return;
    }
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue;
      if (!line.includes(todayPrefix)) continue;
      try {
        const entry = JSON.parse(line);
        const usage = entry?.message?.usage;
        if (usage && typeof usage === 'object') {
          const input = usage.input_tokens ?? 0;
          const output = usage.output_tokens ?? 0;
          totalTokens += input + output;
          foundAny = true;
        }
      } catch {
        // skip malformed lines
      }
    }
  }

  await walk(projectsDir);
  return foundAny ? totalTokens : undefined;
}
