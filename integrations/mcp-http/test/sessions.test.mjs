import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createBridge } from '../server.mjs';
import { operationQueue } from '../sessions.mjs';

const deferred = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};
const result = text => ({ content: [{ type: 'text', text }] });
const initialize = id => ({ jsonrpc: '2.0', id, method: 'initialize', params: {
  protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: `model-${id}`, version: '1' },
} });

async function fixture(t, createBackend, options = {}) {
  const reservation = createServer();
  await new Promise(resolve => reservation.listen(0, '127.0.0.1', resolve));
  const port = reservation.address().port;
  await new Promise(resolve => reservation.close(resolve));
  const bridge = createBridge({}, { port, createBackend, ...options });
  await new Promise(resolve => bridge.listen(port, '127.0.0.1', resolve));
  const url = new URL(`http://127.0.0.1:${port}/mcp`), clients = [];
  t.after(async () => {
    await Promise.allSettled(clients.map(({ client }) => client.close()));
    await bridge.closeSessions();
    bridge.closeAllConnections();
    await new Promise(resolve => bridge.close(resolve));
  });
  return {
    bridge, url,
    async client(name) {
      const client = new Client({ name, version: '1' }), transport = new StreamableHTTPClientTransport(url);
      clients.push({ client, transport });
      await client.connect(transport);
      return { client, transport, call: (arguments_ = {}) => client.callTool({ name: 'test', arguments: arguments_ }) };
    },
    post(body, headers = {}) {
      return fetch(url, { method: 'POST', headers: { Accept: 'application/json, text/event-stream', 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
    },
  };
}

test('HTTP sessions retain independent state and execute across connections concurrently', async t => {
  const entered = deferred(), release = deferred(), backends = [];
  const f = await fixture(t, async info => {
    let selected = info.name;
    const backend = {
      closed: false,
      listTools: async () => ({ tools: [] }),
      callTool: async params => {
        if (params.arguments.select) selected = params.arguments.select;
        if (params.arguments.slow) { entered.resolve(); await release.promise; }
        return result(selected);
      },
      close: async () => { backend.closed = true; },
    };
    backends.push(backend); return backend;
  });
  t.after(() => release.resolve());
  const [a, b] = await Promise.all([f.client('model-a'), f.client('model-b')]);
  assert.notEqual(a.transport.sessionId, b.transport.sessionId);
  await a.call({ select: 'tab-a' }); await b.call({ select: 'tab-b' });
  const slow = a.call({ slow: true });
  await entered.promise;
  assert.equal((await b.call()).content[0].text, 'tab-b', 'another session does not wait for the slow session');
  release.resolve(); assert.equal((await slow).content[0].text, 'tab-a');
  assert.equal((await a.call()).content[0].text, 'tab-a');
  await a.transport.terminateSession();
  await delay(10);
  assert.equal(backends[0].closed, true);
  assert.equal(backends[1].closed, false, 'deleting one session preserves other connections');
  await f.bridge.closeSessions();
  assert.ok(backends.every(backend => backend.closed));
  assert.equal((await f.post(initialize(3))).status, 503);
});

test('session capacity includes pending starts and shutdown closes late startups', async t => {
  const started = deferred(), startup = deferred(); let count = 0, closed = 0;
  const f = await fixture(t, async () => {
    count++; started.resolve(); await startup.promise;
    return { listTools: async () => ({ tools: [] }), close: async () => { closed++; } };
  }, { maxSessions: 1 });
  const pending = f.post(initialize(1));
  await started.promise;
  assert.equal((await f.post(initialize(2))).status, 503);
  assert.equal(count, 1);
  // Shutdown during a pending start must close the late backend as well.
  const closing = f.bridge.closeSessions();
  startup.resolve();
  assert.equal((await pending).status, 503);
  await closing;
  assert.equal(closed, 1);
});

test('failed backend startup releases capacity for a new connection', async t => {
  let count = 0;
  const f = await fixture(t, async () => {
    if (++count === 1) throw new Error('Expected backend startup failure');
    return { listTools: async () => ({ tools: [] }), close: async () => {} };
  }, { maxSessions: 1 });
  assert.equal((await f.post(initialize(1))).status, 500);
  const retry = await f.client('retry');
  assert.ok(retry.transport.sessionId);
  assert.equal(count, 2);
});

test('a disconnected native backend expires its HTTP session and frees capacity', async t => {
  const backends = [];
  const f = await fixture(t, async () => {
    const backend = { listTools: async () => ({ tools: [] }), close: async () => {} };
    backends.push(backend); return backend;
  }, { maxSessions: 1 });
  const first = await f.client('disconnected');
  backends[0].onclose();
  await delay(10);
  assert.equal((await f.post({ jsonrpc: '2.0', id: 5, method: 'ping' }, { 'mcp-session-id': first.transport.sessionId })).status, 404);
  assert.ok((await f.client('replacement')).transport.sessionId);
  assert.equal(backends.length, 2);
});

test('invalid initialization, unknown sessions, and oversized bodies never create backends', async t => {
  let count = 0;
  const f = await fixture(t, async () => { count++; throw new Error('must not start'); });
  const call = { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'test' } };
  assert.equal((await f.post(call)).status, 400);
  assert.equal((await f.post(initialize(1), { 'mcp-session-id': 'unknown' })).status, 404);
  assert.equal((await f.post(initialize(1), { Origin: 'https://foreign.example' })).status, 403);
  assert.equal((await f.post(initialize(1), { Accept: 'application/json' })).status, 406);
  assert.equal((await f.post({ ...initialize(1), extra: 'x'.repeat((1 << 20) + 1) })).status, 413);
  assert.equal(count, 0);
});

test('idle expiry cleans up abandoned sessions without expiring active operations', async t => {
  const entered = deferred(), release = deferred(); let closed = 0;
  const f = await fixture(t, async () => ({ listTools: async () => ({ tools: [] }),
    callTool: async () => { entered.resolve(); await release.promise; return result('done'); },
    close: async () => { closed++; },
  }), { idleMs: 100 });
  const a = await f.client('idle-model');
  const pending = a.call(); await entered.promise;
  await delay(250); assert.equal(closed, 0, 'active requests retain their backend');
  release.resolve(); await pending;
  const deadline = Date.now() + 2000;
  while (!closed && Date.now() < deadline) await delay(25);
  assert.equal(closed, 1);
  const response = await f.post({ jsonrpc: '2.0', id: 3, method: 'ping' }, { 'mcp-session-id': a.transport.sessionId });
  assert.equal(response.status, 404);
});

test('operation queue bounds work, preserves order, recovers from failures and cancels pending operations', async () => {
  const queue = operationQueue(2), started = deferred(), release = deferred(), order = [];
  const first = queue.run(async () => { order.push('first'); started.resolve(); await release.promise; throw new Error('failed'); });
  const failed = assert.rejects(first, /failed/);
  await started.promise;
  const second = queue.run(() => { order.push('second'); });
  await assert.rejects(queue.run(() => {}), /busy/);
  release.resolve(); await failed; await second;
  await queue.run(() => order.push('third'));
  assert.deepEqual(order, ['first', 'second', 'third']);
  const pending = queue.run(() => { throw new Error('must not run'); });
  queue.close();
  await assert.rejects(pending, /closed/);
  await assert.rejects(queue.run(() => {}), /closed/);
});
