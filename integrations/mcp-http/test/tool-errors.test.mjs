import { test } from 'node:test';
import assert from 'node:assert/strict';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createAppServer } from '../server.mjs';
import { operationQueue } from '../operation-queue.mjs';

async function rpc(t, backend = { listTools: async () => ({ tools: [] }), callTool: async ({ name }) => ({ content: [{ type: 'text', text: `Unknown tool ${JSON.stringify(name)}.` }], isError: true }) }, serialize) {
  const server = createAppServer(backend, serialize);
  const [client, transport] = InMemoryTransport.createLinkedPair();
  await server.connect(transport);
  t.after(() => server.close());
  const waiting = new Map();
  client.onmessage = message => { waiting.get(message.id)?.(message); waiting.delete(message.id); };
  await client.start();
  let id = 0;
  const send = (method, params) => new Promise(resolve => { const current = ++id; waiting.set(current, resolve); client.send({ jsonrpc: '2.0', id: current, method, params }); });
  await send('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'fixture', version: '1' } });
  return send;
}

test('malformed tools/call params are Invalid params (-32602), not internal errors', async t => {
  const send = await rpc(t);
  assert.equal((await send('tools/call', { name: 5 })).error.code, -32602);
  assert.equal((await send('tools/call', { name: 'kitsuvo_browser', arguments: 'nope' })).error.code, -32602);
  assert.equal((await send('tools/call', {})).error.code, -32602);
});

test('unknown tools return an isError tool result from the native backend', async t => {
  const send = await rpc(t);
  const response = await send('tools/call', { name: 'nope', arguments: {} });
  assert.equal(response.error, undefined);
  assert.equal(response.result.isError, true);
});

test('short client deadlines expire in the bridge queue before mutation dispatch', async t => {
  const queue = operationQueue(); t.after(() => queue.close());
  let release; const held = queue.run(() => new Promise(resolve => { release = resolve; }));
  await new Promise(resolve => setImmediate(resolve));
  t.after(() => release());
  const calls = [];
  const send = await rpc(t, { callTool: async params => { calls.push(params); return { content: [] }; } },
    (operation, options) => queue.run(operation, options));
  // Keep the mutation blocked until the bridge has replied. No polling or
  // timing assertion: a broken bridge dispatches it after release instead.
  const fallback = setTimeout(() => release(), 250); t.after(() => clearTimeout(fallback));
  const response = await send('tools/call', { name: 'browser_click', arguments: { ref: 'e1' }, _meta: { 'kitsuvo/deadlineMs': 15 } });
  assert.equal(response.error, undefined);
  assert.equal(response.result.isError, true);
  assert.match(response.result.content[0].text, /deadline.*inspect state/i);
  assert.equal(calls.length, 0);
  release(); await held;
});

test('invalid deadlines fail as tool errors without dispatching browser work', async t => {
  const queue = operationQueue(); t.after(() => queue.close());
  const calls = [];
  const send = await rpc(t, { callTool: async params => { calls.push(params); return { content: [] }; } },
    (operation, options) => queue.run(operation, options));
  for (const deadline of [0, -1, '500']) {
    const response = await send('tools/call', { name: 'browser_click', arguments: { ref: 'e1' }, _meta: { 'kitsuvo/deadlineMs': deadline } });
    assert.equal(response.error, undefined);
    assert.equal(response.result.isError, true);
    assert.match(response.result.content[0].text, /Invalid request deadline/);
  }
  assert.equal(calls.length, 0);
});
