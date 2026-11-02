import test from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { browserFunctionTools } from '../function-tools.mjs';
import { createAppServer } from '../server.mjs';
import { operationQueue } from '../operation-queue.mjs';

test('function adapter deadline expires queued SDK work without late browser dispatch', async t => {
  const queue = operationQueue();
  let release, admit;
  const admitted = new Promise(resolve => { admit = resolve; });
  const held = queue.run(() => new Promise(resolve => { release = resolve; }));
  await new Promise(resolve => setImmediate(resolve));
  let calls = 0;
  const server = createAppServer({
    listTools: async () => ({ tools: [{ name: 'browser_snapshot', inputSchema: { type: 'object' } }] }),
    callTool: async () => { calls++; return { content: [] }; },
  }, (operation, options) => {
    const result = queue.run(operation, options);
    admit();
    return result;
  });
  const client = new Client({ name: 'function-budget-fixture', version: '1' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  t.after(async () => {
    release(); queue.close(); await held;
    await client.close(); await server.close();
  });
  await server.connect(serverTransport); await client.connect(clientTransport);
  const adapter = await browserFunctionTools(client, {
    allowedTools: ['browser_snapshot'], browser: 'fixture-target', approve: () => true, timeoutMs: 30,
  });
  t.after(() => adapter.close());
  const pending = adapter.call('browser_snapshot');
  await admitted;
  // The SDK may receive the bridge's deadline tool error first, or the local
  // adapter may abort first. Neither path can release stale work into native.
  const settled = await pending.then(result => ({ result }), error => ({ error }));
  if (settled.error) assert.match(settled.error.message, /deadline|timed out/i);
  else {
    assert.equal(settled.result.isError, true);
    assert.match(settled.result.content[0].text, /deadline/i);
  }
  release(); await held;
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls, 0);
});
