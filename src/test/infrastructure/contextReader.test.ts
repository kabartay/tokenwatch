/**
 * @file Tests for finding and tail-reading the newest session transcript.
 */

import { strict as assert } from 'node:assert';
import { mkdir, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { encodeProjectDir } from '../../domain/transcript';
import { ContextReader } from '../../infrastructure/contextReader';

const FOLDER = '/Users/me/my.proj';

function reply(tokens: { input?: number; create?: number; read?: number }, extra: object = {}): string {
  return JSON.stringify({
    type: 'assistant',
    timestamp: '2026-10-07T19:57:26.145Z',
    cwd: FOLDER,
    message: {
      model: 'claude-opus-5-5',
      usage: {
        input_tokens: tokens.input ?? 0,
        cache_creation_input_tokens: tokens.create ?? 0,
        cache_read_input_tokens: tokens.read ?? 0,
        output_tokens: 999,
      },
    },
    ...extra,
  });
}

describe('ContextReader.read', () => {
  let root: string;
  let dir: string;

  before(async () => {
    root = await mkdtemp(join(tmpdir(), 'tokenwatch-ctx-'));
    dir = join(root, encodeProjectDir(FOLDER));
    await mkdir(dir);

    const old = join(dir, 'old-session.jsonl');
    await writeFile(old, reply({ read: 50_000 }) + '\n');
    const yesterday = new Date(Date.now() - 86_400_000);
    await utimes(old, yesterday, yesterday);

    // The current session: an early reply, a later one after Claude cd'ed into a subfolder,
    // then a subagent reply and a huge tool result that push the answer out of the first tail read.
    await writeFile(
      join(dir, 'current-session.jsonl'),
      [
        reply({ read: 100_000 }),
        reply({ input: 10, create: 1_000, read: 290_378 }, { cwd: `${FOLDER}/sub` }),
        reply({ read: 5_000 }, { isSidechain: true }),
        JSON.stringify({ type: 'user', message: { content: 'x'.repeat(400 * 1024) } }),
        '',
      ].join('\n'),
    );
  });

  after(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("reads the newest session's last main-thread reply, even after a cd", async () => {
    const reading = await new ContextReader(root).read([FOLDER], { 'claude-opus': 1_000_000 });
    assert.ok(reading);
    assert.equal(reading.tokens, 291_388);
    assert.equal(Math.round(reading.percent), 29);
    assert.equal(reading.windowInferred, false);
    assert.equal(reading.model, 'claude-opus-5-5');
  });

  it('returns undefined for a folder with no sessions', async () => {
    assert.equal(await new ContextReader(root).read(['/nowhere'], {}), undefined);
  });
});
