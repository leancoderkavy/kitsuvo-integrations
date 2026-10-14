import test from 'node:test';
import assert from 'node:assert/strict';
import { createPostHogTelemetry, noopTelemetry } from '../posthog.mjs';

test('PostHog telemetry is a no-op without the relay key', async () => {
  const telemetry = createPostHogTelemetry({ env: {} });
  assert.equal(telemetry, noopTelemetry);
  telemetry.captureException(new Error('ignored'));
  await telemetry.shutdown();
});

test('PostHog telemetry captures only safe relay failure context and flushes on shutdown', async () => {
  const captures = [];
  let options, shutdowns = 0;
  class FakePostHog {
    constructor(key, receivedOptions) { assert.equal(key, 'test-key'); options = receivedOptions; }
    captureException(...args) { captures.push(args); }
    async shutdown() { shutdowns += 1; }
  }
  const telemetry = createPostHogTelemetry({
    env: { KITSUVO_POSTHOG_KEY: 'test-key', POSTHOG_HOST: 'https://events.example.test' },
    PostHogClient: FakePostHog,
  });
  const error = new Error('relay failed');
  telemetry.captureException(error, { source: 'express', method: 'POST', path: '/mcp' });
  assert.deepEqual(options, { host: 'https://events.example.test', disableGeoip: true, enableExceptionAutocapture: false });
  assert.notEqual(captures[0][0], error);
  assert.equal(captures[0][0].message, 'Relay service operation failed');
  assert.deepEqual(captures[0].slice(1), ['kitsuvo-mcp-relay', {
    service: 'kitsuvo-mcp-relay', source: 'express', error_type: 'Error', method: 'POST', path: '/mcp',
  }]);
  await telemetry.shutdown();
  assert.equal(shutdowns, 1);
});

test('exception messages, stacks, causes, private paths and arbitrary context never reach the SDK', () => {
  const captures = [];
  class FakePostHog {
    captureException(error, id, properties) { captures.push({ error, id, properties }); }
  }
  const telemetry = createPostHogTelemetry({ env: { KITSUVO_POSTHOG_KEY: 'test-key' }, PostHogClient: FakePostHog });
  const secret = 'PRIVATE_PAGE_TOKEN_123';
  const error = new SyntaxError(`Unexpected token in https://private.example/?token=${secret}`);
  error.stack += `\n${secret}`;
  error.cause = new Error(secret);
  error.body = secret;
  error.code = secret;
  telemetry.captureException(error, { source: secret, method: secret, path: '/approve/' + secret,
    authorization: secret, body: secret, browserId: secret, page: secret });
  assert.equal(captures.length, 1);
  const sent = captures[0];
  assert.equal(sent.error.cause, undefined);
  assert.equal(sent.error.body, undefined);
  assert.equal(sent.error.stack, 'SyntaxError: Relay service operation failed');
  assert.equal(JSON.stringify(sent).includes(secret), false);
  assert.equal(sent.error.message.includes(secret), false);
  assert.deepEqual(sent.properties, { service: 'kitsuvo-mcp-relay', source: 'unknown',
    error_type: 'SyntaxError', method: 'other', path: 'other' });
});
