import test from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { browserFunctionTools } from '../function-tools.mjs';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';

const tool = { name: 'browser_snapshot', description: 'Read page', inputSchema: {
  type: 'object', properties: { browser: { type: 'string' } }, required: ['browser'] } };
const scope = { allowedTools: [tool.name], browser: 'owned-target', approve: async () => true };
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
function fixture() {
  const calls = [];
  return { calls, listTools: async () => ({ tools: [structuredClone(tool)] }),
    callTool: async (...args) => { calls.push(args); return { content: [] }; } };
}

for (const action of ['abort', 'close']) test(`${action} settles a held approval without waiting for the approval UI`, async () => {
  const entered = deferred(), release = deferred(), controller = new AbortController(), client = fixture();
  const adapter = await browserFunctionTools(client, { ...scope, approve: async () => { entered.resolve(); return release.promise; } });
  const pending = adapter.call(tool.name, {}, { signal: controller.signal });
  const observed = pending.then(() => 'dispatched', error => error.message);
  await entered.promise;
  if (action === 'abort') controller.abort(new Error('User cancelled')); else adapter.close();
  try {
    const outcome = await Promise.race([observed, setImmediate('still waiting')]);
    assert.match(outcome, action === 'abort' ? /User cancelled/ : /closed/);
    assert.equal(client.calls.length, 0);
  } finally { release.resolve(true); await observed; adapter.close(); }
});

test('cancellation reaches catalog revalidation and never dispatches a late answer', async () => {
  const client = fixture(), adapter = await browserFunctionTools(client, scope);
  const entered = deferred(), release = deferred(), controller = new AbortController(); let requestOptions;
  client.listTools = async (_params, options) => { requestOptions = options; entered.resolve(); await release.promise; return { tools: [tool] }; };
  const pending = adapter.call(tool.name, {}, { signal: controller.signal });
  const observed = pending.then(() => 'dispatched', error => error.message);
  await entered.promise; controller.abort(new Error('Task cancelled'));
  try {
    assert.match(await Promise.race([observed, setImmediate('still waiting')]), /Task cancelled/);
    assert.equal(requestOptions.signal.aborted, true);
    assert.equal(client.calls.length, 0);
  } finally { release.resolve(); await observed; adapter.close(); }
});

test('a paginated tool remains discoverable and is revalidated on its actual page', async () => {
  const client = fixture(), cursors = [];
  client.listTools = async params => {
    cursors.push(params?.cursor);
    return params?.cursor === 'next' ? { tools: [tool] } : { tools: [], nextCursor: 'next' };
  };
  const adapter = await browserFunctionTools(client, scope);
  await adapter.call(tool.name);
  assert.deepEqual(cursors, [undefined, 'next', undefined, 'next']);
  assert.equal(client.calls.length, 1); adapter.close();
});

test('object key order is not a changed approved tool contract', async () => {
  const client = fixture(), adapter = await browserFunctionTools(client, scope);
  client.listTools = async () => ({ tools: [{ inputSchema: { required: ['browser'], properties: { browser: { type: 'string' } }, type: 'object' }, description: tool.description, name: tool.name }] });
  await adapter.call(tool.name);
  assert.equal(client.calls.length, 1); adapter.close();
});

test('setup cancellation and catalog deadlines cannot wait on an unresponsive peer', async () => {
  const client = fixture(), release = deferred(), controller = new AbortController(), entered = deferred();
  client.listTools = async () => { entered.resolve(); await release.promise; return { tools: [tool] }; };
  const pending = browserFunctionTools(client, { ...scope, signal: controller.signal });
  const observed = pending.then(() => 'created', error => error.message);
  await entered.promise; controller.abort(new Error('Setup cancelled'));
  try { assert.match(await Promise.race([observed, setImmediate('still waiting')]), /Setup cancelled/); }
  finally { release.resolve(); await observed; }

  const held = deferred(); client.listTools = async () => { await held.promise; return { tools: [tool] }; };
  const timed = browserFunctionTools(client, { ...scope, timeoutMs: 20 }).then(() => 'created', error => error.message);
  const keepAlive = new AbortController();
  try { assert.match(await Promise.race([timed, delay(2000, 'still waiting', { signal: keepAlive.signal })]), /deadline/i); }
  finally { keepAlive.abort(); held.resolve(); await timed; }
});

test('cyclic, duplicate and unbounded catalogs fail closed', async () => {
  for (const kind of ['cycle', 'duplicate', 'unbounded']) {
    const client = fixture(); let pages = 0;
    client.listTools = async () => {
      pages++;
      return kind === 'duplicate' ? { tools: [tool, tool] }
        : { tools: [], nextCursor: kind === 'cycle' ? 'same' : String(pages) };
    };
    await assert.rejects(browserFunctionTools(client, scope), /catalog|pagination/);
    assert.ok(pages <= 16); assert.equal(client.calls.length, 0);
  }
});

test('a later-page contract change is refused before dispatch', async () => {
  const client = fixture(); let changed = false;
  client.listTools = async params => params?.cursor === 'second'
    ? { tools: [{ ...tool, description: changed ? 'Different action' : tool.description }] }
    : { tools: [], nextCursor: 'second' };
  const adapter = await browserFunctionTools(client, scope); changed = true;
  await assert.rejects(adapter.call(tool.name), /contract changed/);
  assert.equal(client.calls.length, 0); adapter.close();
});

test('close cancels only the active request and never closes the shared client', async () => {
  const client = fixture(), entered = deferred(); let sharedCloses = 0;
  client.close = async () => { sharedCloses++; };
  client.callTool = (_params, _schema, { signal }) => new Promise((resolve, reject) => {
    signal.addEventListener('abort', () => reject(signal.reason), { once: true }); entered.resolve();
  });
  const adapter = await browserFunctionTools(client, scope), pending = adapter.call(tool.name);
  const rejected = assert.rejects(pending, /closed/);
  await entered.promise; adapter.close(); await rejected;
  assert.equal(sharedCloses, 0); assert.equal((await client.listTools()).tools[0].name, tool.name);
});

test('real MCP SDK pagination, refusal results and request cancellation preserve the shared connection', async t => {
  const client = new Client({ name: 'adapter-qualification', version: '1' });
  const server = new Server({ name: 'paged-native-contract', version: '1' }, { capabilities: { tools: {} } });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  t.after(async () => { await client.close(); await server.close(); });
  const entered = deferred(), cancelled = deferred(); let hold = false, dispatches = 0;
  server.setRequestHandler(ListToolsRequestSchema, async (request, extra) => {
    if (hold) {
      entered.resolve();
      await new Promise(resolve => extra.signal.addEventListener('abort', () => { cancelled.resolve(); resolve(); }, { once: true }));
    }
    return request.params?.cursor === 'second' ? { tools: [tool] } : { tools: [], nextCursor: 'second' };
  });
  server.setRequestHandler(CallToolRequestSchema, async request => {
    dispatches++; assert.equal(request.params.arguments.browser, scope.browser);
    return { isError: true, content: [{ type: 'text', text: 'Protected page refused' }], structuredContent: { refused: true } };
  });
  await server.connect(serverTransport); await client.connect(clientTransport);
  const adapter = await browserFunctionTools(client, scope);
  const result = await adapter.call(tool.name);
  assert.equal(result.isError, true); assert.deepEqual(result.structuredContent, { refused: true });
  hold = true;
  const controller = new AbortController(), pending = adapter.call(tool.name, {}, { signal: controller.signal });
  const rejected = assert.rejects(pending, /SDK task cancelled/);
  await entered.promise; controller.abort(new Error('SDK task cancelled'));
  await rejected; await cancelled.promise;
  assert.equal(dispatches, 1); adapter.close(); await client.ping();
});

test('catalog pages consume the same approval-to-dispatch deadline', async () => {
  const client = fixture(), remaining = []; let revalidating = false;
  client.listTools = async (params, options) => {
    if (revalidating) remaining.push(options.timeout);
    await delay(5);
    return params?.cursor === 'last' ? { tools: [tool] } : { tools: [], nextCursor: params?.cursor === 'middle' ? 'last' : 'middle' };
  };
  const adapter = await browserFunctionTools(client, { ...scope, timeoutMs: 2000, approve: async () => { await delay(20); return true; } });
  revalidating = true; await adapter.call(tool.name);
  assert.equal(remaining.length, 3);
  assert.ok(remaining[0] < 1990);
  assert.ok(remaining[1] < remaining[0] && remaining[2] < remaining[1]);
  assert.ok(client.calls[0][0]._meta['kitsuvo/deadlineMs'] < remaining[2]);
  adapter.close();
});
