/**
 * @file Tests for the local session-log estimator, against a temporary log tree.
 */

import { strict as assert } from 'node:assert';
import { appendFile, mkdtemp, mkdir, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { LocalUsageEstimator, tokenUsageOf } from '../core/localUsage';

const NOW = new Date(2026, 9, 7, 15, 0, 0);
const TODAY = new Date(2026, 9, 7, 10, 0, 0).toISOString();
const YESTERDAY = new Date(2026, 9, 6, 10, 0, 0).toISOString();

function line(id: string, requestId: string, timestamp: string, input: number, output: number): string {
  return JSON.stringify({
    timestamp,
    requestId,
    message: { id, usage: { input_tokens: input, output_tokens: output } },
  });
}

describe('LocalUsageEstimator', () => {
  let root: string;

  before(async () => {
    root = await mkdtemp(join(tmpdir(), 'tokenwatch-'));
    const project = join(root, 'proj-a');
    await mkdir(project);

    await writeFile(
      join(project, 'today.jsonl'),
      [
        line('m1', 'r1', TODAY, 100, 50),
        line('m1', 'r1', TODAY, 100, 50), // streamed duplicate
        line('m2', 'r2', TODAY, 10, 5),
        line('m0', 'r0', YESTERDAY, 999, 999), // older entry in a file touched today
        '{"truncated": ',
        '',
      ].join('\n'),
    );

    const stale = join(project, 'stale.jsonl');
    await writeFile(stale, line('old', 'x', TODAY, 1_000_000, 0));
    const lastWeek = new Date(2026, 9, 1);
    await utimes(stale, lastWeek, lastWeek);
  });

  after(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('sums today, de-duplicates, and skips stale files and old entries', async () => {
    const estimate = await new LocalUsageEstimator(root).estimateToday(NOW);
    assert.deepEqual(estimate, { tokensToday: 165, messageCount: 2 });
  });

  it('reads only appended lines, waits for partial lines, and survives rewrites', async () => {
    const dir = join(root, 'proj-incremental');
    await mkdir(dir);
    const file = join(dir, 'live.jsonl');
    const estimator = new LocalUsageEstimator(dir);

    await writeFile(file, line('a', '1', TODAY, 10, 0) + '\n');
    assert.equal((await estimator.estimateToday(NOW))?.tokensToday, 10);

    const partial = line('b', '2', TODAY, 20, 0);
    await appendFile(file, line('a', '1', TODAY, 10, 0) + '\n' + partial.slice(0, 15));
    assert.equal((await estimator.estimateToday(NOW))?.tokensToday, 10, 'partial line not yet counted');

    await appendFile(file, partial.slice(15) + '\n');
    assert.deepEqual(await estimator.estimateToday(NOW), { tokensToday: 30, messageCount: 2 });

    await writeFile(file, line('a', '1', TODAY, 10, 0) + '\n');
    assert.deepEqual(
      await estimator.estimateToday(NOW),
      { tokensToday: 30, messageCount: 2 },
      'shrunk file is rescanned without double counting',
    );
  });

  it('returns undefined when the log directory is missing', async () => {
    const estimate = await new LocalUsageEstimator(join(root, 'nope')).estimateToday(NOW);
    assert.equal(estimate, undefined);
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
