/**
 * @file Tests for the HTTP behaviour of UsageApiClient against a local server.
 */

import { strict as assert } from 'node:assert';
import {
  createServer,
  request,
  type IncomingHttpHeaders,
  type Server,
  type ServerResponse,
} from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';
import { UsageApiError } from '../../application/errors';
import { UsageApiClient } from '../../infrastructure/usageApiClient';

type Responder = (res: ServerResponse) => void;

describe('UsageApiClient.fetchUsage', () => {
  let server: Server;
  let port: number;
  let respond: Responder = () => undefined;
  let lastHeaders: IncomingHttpHeaders = {};
  let lastPath: string | undefined;

  before(async () => {
    server = createServer((req, res) => {
      lastHeaders = req.headers;
      lastPath = req.url;
      respond(res);
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    port = (server.address() as AddressInfo).port;
  });

  after(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  const client = (timeoutMs = 2_000) =>
    new UsageApiClient({ hostname: '127.0.0.1', port, request, timeoutMs });

  const json = (status: number, body: string): Responder => (res) => {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(body);
  };

  it('sends the bearer token and required headers, and parses the response', async () => {
    respond = json(200, '{"five_hour":{"utilization":9,"resets_at":"2026-10-07T16:00:00Z"},"seven_day":{"utilization":41}}');
    const snapshot = await client().fetchUsage('tok-123');

    assert.equal(lastPath, '/api/oauth/usage');
    assert.equal(lastHeaders.authorization, 'Bearer tok-123');
    assert.equal(lastHeaders['anthropic-beta'], 'oauth-2025-04-20');
    assert.equal(lastHeaders['user-agent'], 'tokenwatch');
    assert.equal(snapshot.session?.percentUsed, 9);
    assert.equal(snapshot.weekly?.percentUsed, 41);
  });

  it('rejects non-2xx responses with the status and a truncated body', async () => {
    respond = json(401, `{"error":"${'x'.repeat(500)}"}`);
    const err = await client().fetchUsage('tok').then(
      () => assert.fail('expected rejection'),
      (e: unknown) => e,
    );
    assert.ok(err instanceof UsageApiError);
    assert.equal(err.status, 401);
    assert.ok(err.isAuthFailure);
    assert.ok(err.message.length < 220, 'body is truncated');
    assert.ok(!err.message.includes('tok'), 'token is not echoed into the error');
  });

  it('reads a numeric Retry-After header on a 429', async () => {
    respond = (res) => {
      res.writeHead(429, { 'Content-Type': 'application/json', 'Retry-After': '42' });
      res.end('{"error":"rate limited"}');
    };
    const err = await client().fetchUsage('tok').then(
      () => assert.fail('expected rejection'),
      (e: unknown) => e,
    );
    assert.ok(err instanceof UsageApiError);
    assert.ok(err.isRateLimited);
    assert.equal(err.retryAfterSeconds, 42);
  });

  it('reads an HTTP-date Retry-After header as seconds from now', async () => {
    respond = (res) => {
      res.writeHead(429, { 'Retry-After': new Date(Date.now() + 90_000).toUTCString() });
      res.end('{}');
    };
    const err = await client().fetchUsage('tok').then(
      () => assert.fail('expected rejection'),
      (e: unknown) => e,
    );
    assert.ok(err instanceof UsageApiError);
    assert.ok(err.retryAfterSeconds !== undefined && Math.abs(err.retryAfterSeconds - 90) <= 2);
  });

  it('has no retryAfterSeconds when the header is absent', async () => {
    respond = json(429, '{}');
    const err = await client().fetchUsage('tok').then(
      () => assert.fail('expected rejection'),
      (e: unknown) => e,
    );
    assert.ok(err instanceof UsageApiError);
    assert.equal(err.retryAfterSeconds, undefined);
  });

  it('rejects invalid JSON', async () => {
    respond = json(200, '<html>maintenance</html>');
    await assert.rejects(client().fetchUsage('tok'), /not valid JSON/);
  });

  it('times out instead of hanging', async () => {
    respond = () => undefined; // never answer
    await assert.rejects(client(100).fetchUsage('tok'), /Timed out after 100 ms/);
  });

  it('wraps connection failures in UsageApiError', async () => {
    const closed = new UsageApiClient({ hostname: '127.0.0.1', port: 1, request, timeoutMs: 1_000 });
    await assert.rejects(closed.fetchUsage('tok'), UsageApiError);
  });
});
