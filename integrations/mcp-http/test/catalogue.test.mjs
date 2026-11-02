import test from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { createAppServer } from '../server.mjs';
import { browserFunctionTools } from '../function-tools.mjs';
import { appTools } from '../browser-app.mjs';
const definition = name => ({ name, description: `Fixture ${name}`, inputSchema: { type: 'object' } });
async function connect(t, server) {
  const client = new Client({ name: 'catalogue-fixture', version: '1' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  t.after(async () => { await client.close(); await server.close(); });
  await server.connect(serverTransport); await client.connect(clientTransport);
  return client;
}

test('App discovery drains real SDK backend pages and exposes App tools once', async t => {
  const native = new Server({ name: 'paged-fixture', version: '1' }, { capabilities: { tools: {} } });
  const cursors = [], dispatches = [];
  native.setRequestHandler(ListToolsRequestSchema, request => {
    cursors.push(request.params?.cursor);
    return request.params?.cursor === 'second' ? { tools: [definition('browser_snapshot')] }
      : { tools: [definition('browser_status')], nextCursor: 'second' };
  });
  native.setRequestHandler(CallToolRequestSchema, request => {
    dispatches.push(request.params);
    return { content: [{ type: 'text', text: 'Observed fixture' }] };
  });
  const backend = await connect(t, native), client = await connect(t, createAppServer(backend));
  const catalog = await client.listTools();
  assert.equal(catalog.nextCursor, undefined);
  assert.deepEqual(catalog.tools.map(tool => tool.name), ['browser_status', 'browser_snapshot', ...appTools.map(tool => tool.name)]);
  const adapter = await browserFunctionTools(client, { browser: 'owned-fixture', allowedTools: ['browser_snapshot'], approve: () => true });
  try { assert.equal((await adapter.call('browser_snapshot')).content[0].text, 'Observed fixture'); }
  finally { adapter.close(); }
  assert.deepEqual(cursors, [undefined, 'second'], 'complete catalog stays cached across revalidation');
  assert.equal(dispatches.length, 1); assert.equal(dispatches[0].arguments.browser, 'owned-fixture');
});

for (const kind of ['duplicate', 'reserved', 'cycle', 'page-limit', 'tool-limit']) {
  test(`App discovery refuses ${kind} catalogs without caching partial results`, async t => {
    let broken = true, pages = 0;
    const backend = { listTools: async params => {
      pages++;
      if (!broken) return { tools: [definition('browser_snapshot')] };
      if (kind === 'duplicate') return params?.cursor ? { tools: [definition('browser_snapshot')] }
        : { tools: [definition('browser_snapshot')], nextCursor: 'next' };
      if (kind === 'reserved') return { tools: [definition('kitsuvo_browser_action')] };
      if (kind === 'cycle') return { tools: [], nextCursor: 'same' };
      if (kind === 'page-limit') return { tools: [], nextCursor: String(pages) };
      return { tools: Array.from({ length: 2049 }, (_, i) => definition(`fixture_${i}`)) };
    } };
    const client = await connect(t, createAppServer(backend));
    await assert.rejects(client.listTools(), /catalog|pagination|reserved/i);
    assert.ok(pages <= 16);
    broken = false;
    assert.deepEqual((await client.listTools()).tools.map(tool => tool.name), ['browser_snapshot', ...appTools.map(tool => tool.name)]);
  });
}

test('shared App clients coalesce full discovery and invalidate every page on notification', async t => {
  let notify, reads = 0, title = 'Before';
  const backend = {
    setNotificationHandler(_schema, handler) { notify = handler; },
    async listTools(params) {
      reads++;
      return params?.cursor === 'last' ? { tools: [{ ...definition('browser_snapshot'), description: title }] }
        : { tools: [], nextCursor: 'last' };
    },
  };
  const a = await connect(t, createAppServer(backend)), b = await connect(t, createAppServer(backend));
  const catalogs = await Promise.all([a.listTools(), b.listTools()]);
  assert.ok(catalogs.every(catalog => catalog.tools.some(tool => tool.description === 'Before')));
  assert.equal(reads, 2);
  title = 'After'; notify();
  const changed = await Promise.all([a.listTools(), b.listTools()]);
  assert.ok(changed.every(catalog => catalog.tools.some(tool => tool.description === 'After')));
  assert.equal(reads, 4);
});

const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
test('an obsolete rejected discovery cannot evict a newer complete catalog', async t => {
  const entered = deferred(), first = deferred(); let notify, reads = 0;
  const backend = {
    setNotificationHandler(_schema, handler) { notify = handler; },
    async listTools() { if (++reads === 1) { entered.resolve(); return first.promise; } return { tools: [definition('browser_snapshot')] }; },
  };
  const a = await connect(t, createAppServer(backend)), b = await connect(t, createAppServer(backend));
  const pending = a.listTools(), rejected = assert.rejects(pending, /Obsolete discovery/);
  await entered.promise; notify();
  await b.listTools();
  first.reject(new Error('Obsolete discovery')); await rejected;
  await a.listTools();
  assert.equal(reads, 2, 'late rejection preserves the replacement cache');
});

test('cancelling one client leaves another client\'s shared discovery usable', async t => {
  const entered = deferred(), release = deferred(); let reads = 0, backendSignal;
  const backend = { async listTools(_params, options) {
    reads++; backendSignal = options?.signal; entered.resolve(); await release.promise;
    return { tools: [definition('browser_snapshot')] };
  } };
  const a = await connect(t, createAppServer(backend)), b = await connect(t, createAppServer(backend));
  const controller = new AbortController();
  const pending = a.listTools(undefined, { signal: controller.signal });
  const rejected = assert.rejects(pending, /Discovery cancelled/);
  await entered.promise;
  const other = b.listTools(); controller.abort(new Error('Discovery cancelled'));
  try { await rejected; assert.equal(backendSignal?.aborted ?? false, false); }
  finally { release.resolve(); }
  assert.ok((await other).tools.some(tool => tool.name === 'browser_snapshot'));
  assert.equal(reads, 1); await a.ping(); await b.ping();
});

test('the complete App catalog preserves first-page result and tool metadata', async t => {
  const backend = { async listTools(params) {
    return params?.cursor === '' ? { tools: [{ ...definition('browser_snapshot'), _meta: { fixture: 'tool metadata' } }] }
      : { tools: [], nextCursor: '', _meta: { fixture: 'result metadata' } };
  } };
  const client = await connect(t, createAppServer(backend)), result = await client.listTools();
  assert.deepEqual(result._meta, { fixture: 'result metadata' });
  assert.deepEqual(result.tools[0]._meta, { fixture: 'tool metadata' });
  assert.equal(result.nextCursor, undefined);
});
