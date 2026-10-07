/**
 * @file Tests for reading context size from session transcripts.
 */

import { strict as assert } from 'node:assert';
import { mkdir, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { ContextReader, encodeProjectDir, parseReply, windowFor } from '../core/contextUsage';
import { formatTokensRounded } from '../core/format';

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

describe('encodeProjectDir', () => {
  it('replaces every non-alphanumeric character with a dash, like Claude Code', () => {
    assert.equal(encodeProjectDir('/Users/me/my.proj'), '-Users-me-my-proj');
    assert.equal(encodeProjectDir('/private/tmp/x_1'), '-private-tmp-x-1');
  });
});

describe('parseReply', () => {
  it('sums input, cache-write and cache-read tokens; output does not count', () => {
    assert.equal(parseReply(reply({ input: 10, create: 1_000, read: 290_378 }))?.tokens, 291_388);
  });

  it('skips subagent entries, zero-usage entries and non-replies', () => {
    assert.equal(parseReply(reply({ input: 5 }, { isSidechain: true })), undefined);
    assert.equal(parseReply(reply({})), undefined);
    assert.equal(parseReply('{"type":"user","message":{"content":"hi"}}'), undefined);
    assert.equal(parseReply('{"usage": truncated'), undefined);
  });
});

describe('windowFor', () => {
  it('prefers an exact id, then the longest prefix, then "*"', () => {
    const sizes = { 'claude-opus-5-5': 500_000, 'claude-opus': 1_000_000, claude: 300_000, '*': 123 };
    assert.deepEqual(windowFor('claude-opus-5-5', 1, sizes), { windowTokens: 500_000, inferred: false });
    assert.deepEqual(windowFor('claude-opus-6', 1, sizes), { windowTokens: 1_000_000, inferred: false });
    assert.deepEqual(windowFor('claude-sonnet-5', 1, sizes), { windowTokens: 300_000, inferred: false });
    assert.deepEqual(windowFor('gpt', 1, sizes), { windowTokens: 123, inferred: false });
  });

  it('infers 200k, or 1M once a session has outgrown 200k', () => {
    assert.deepEqual(windowFor('claude-x', 150_000, {}), { windowTokens: 200_000, inferred: true });
    assert.deepEqual(windowFor('claude-x', 291_388, {}), { windowTokens: 1_000_000, inferred: true });
  });

  it('ignores non-positive or non-numeric settings', () => {
    assert.equal(windowFor('claude-x', 1, { 'claude-x': 0, '*': -5 }).inferred, true);
  });
});

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

describe('formatTokensRounded', () => {
  it('rounds to whole thousands and tidy millions', () => {
    assert.equal(formatTokensRounded(950), '950');
    assert.equal(formatTokensRounded(291_388), '291k');
    assert.equal(formatTokensRounded(999_700), '1M');
    assert.equal(formatTokensRounded(1_000_000), '1M');
    assert.equal(formatTokensRounded(1_520_000), '1.5M');
  });
});
