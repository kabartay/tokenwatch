/**
 * @file Tests for parsing Claude Code session transcripts.
 */

import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { encodeProjectDir, parseContextReply, tokenUsageOf } from '../../domain/transcript';

const TODAY = new Date(2026, 9, 7, 10, 0, 0).toISOString();
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

describe('parseContextReply', () => {
  it('sums input, cache-write and cache-read tokens; output does not count', () => {
    assert.equal(parseContextReply(reply({ input: 10, create: 1_000, read: 290_378 }))?.tokens, 291_388);
  });

  it('skips subagent entries, zero-usage entries and non-replies', () => {
    assert.equal(parseContextReply(reply({ input: 5 }, { isSidechain: true })), undefined);
    assert.equal(parseContextReply(reply({})), undefined);
    assert.equal(parseContextReply('{"type":"user","message":{"content":"hi"}}'), undefined);
    assert.equal(parseContextReply('{"usage": truncated'), undefined);
  });
});

describe('tokenUsageOf', () => {
  const since = new Date(2026, 9, 7);

  it('ignores entries without usage or timestamp', () => {
    assert.equal(tokenUsageOf({ message: {} }, since), undefined);
    assert.equal(tokenUsageOf({ message: { usage: { input_tokens: 1 } } }, since), undefined);
    assert.equal(tokenUsageOf(null, since), undefined);
  });

  it('does not collapse entries whose ids are not strings', () => {
    const entry = (ts: string) => ({
      timestamp: ts,
      requestId: { nested: true },
      message: { id: { nested: true }, usage: { input_tokens: 1 } },
    });
    const a = tokenUsageOf(entry(TODAY), since);
    const b = tokenUsageOf(entry(new Date(2026, 9, 7, 11).toISOString()), since);
    assert.ok(a && b);
    assert.notEqual(a.key, b.key);
  });

  it('keys id-less entries by timestamp so they never collapse together', () => {
    const a = tokenUsageOf({ timestamp: TODAY, message: { usage: { input_tokens: 1 } } }, since);
    const b = tokenUsageOf(
      { timestamp: new Date(2026, 9, 7, 11).toISOString(), message: { usage: { input_tokens: 1 } } },
      since,
    );
    assert.ok(a && b);
    assert.notEqual(a.key, b.key);
  });
});
