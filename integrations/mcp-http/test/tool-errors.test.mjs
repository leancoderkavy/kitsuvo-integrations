import { test } from 'node:test';
import assert from 'node:assert/strict';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createAppServer } from '../server.mjs';

async function rpc(t) {
  const backend = { listTools: async () => ({ tools: [] }), callTool: async ({ name }) => ({ content: [{ type: 'text', text: `Unknown tool ${JSON.stringify(name)}.` }], isError: true }) };
  const server = createAppServer(backend);
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
