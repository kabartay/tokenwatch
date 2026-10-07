/**
 * @file Tests for choosing a model's context window size.
 */

import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { windowFor } from '../../domain/contextWindow';

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
