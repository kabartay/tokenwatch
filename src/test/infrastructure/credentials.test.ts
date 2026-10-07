/**
 * @file Tests for access-token extraction and source fallback order.
 */

import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { CredentialStore, extractAccessToken, type TokenSource } from '../../infrastructure/credentials';

class FakeSource implements TokenSource {
  constructor(
    readonly name: string,
    private readonly value: string | undefined,
  ) {}
  async read(): Promise<string | undefined> {
    return this.value;
  }
}

describe('extractAccessToken', () => {
  it('reads the claudeAiOauth shape Claude Code writes', () => {
    const raw = JSON.stringify({ claudeAiOauth: { accessToken: 'tok-1', refreshToken: 'r' } });
    assert.equal(extractAccessToken(raw), 'tok-1');
  });

  it('accepts flat and snake_case shapes', () => {
    assert.equal(extractAccessToken('{"accessToken":"a"}'), 'a');
    assert.equal(extractAccessToken('{"oauth":{"access_token":"b"}}'), 'b');
  });

  it('treats a non-JSON value as a bare token', () => {
    assert.equal(extractAccessToken('  bare-token \n'), 'bare-token');
  });

  it('returns undefined for empty, malformed or tokenless input', () => {
    assert.equal(extractAccessToken(''), undefined);
    assert.equal(extractAccessToken('{not json'), undefined);
    assert.equal(extractAccessToken('{"claudeAiOauth":{}}'), undefined);
  });
});

describe('CredentialStore', () => {
  it('falls through sources until one yields a token', async () => {
    const store = new CredentialStore([
      new FakeSource('empty', undefined),
      new FakeSource('junk', '{"nothing":true}'),
      new FakeSource('good', '{"claudeAiOauth":{"accessToken":"found"}}'),
    ]);
    assert.equal(await store.getAccessToken(), 'found');
  });

  it('returns undefined when no source has a token', async () => {
    assert.equal(await new CredentialStore([new FakeSource('x', undefined)]).getAccessToken(), undefined);
  });
});
