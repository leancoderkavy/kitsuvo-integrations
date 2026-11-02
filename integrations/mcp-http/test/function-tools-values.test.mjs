import test from 'node:test';
import assert from 'node:assert/strict';
import { browserFunctionTools } from '../function-tools.mjs';
import { runInNewContext } from 'node:vm';
import { createServer } from 'node:http';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { createSessions } from '../protocol-sessions.mjs';

const tool = { name: 'browser_snapshot', description: 'Read the selected page', inputSchema: {
  type: 'object', properties: { browser: { type: 'string' }, data: { type: 'object' } }, required: ['browser'] } };
const scope = { allowedTools: [tool.name], browser: 'owned-target', approve: async () => true };
function fixture() {
  const calls = [];
  return { calls, listTools: async () => ({ tools: [tool] }),
    callTool: async (...args) => { calls.push(args); return { content: [] }; } };
}

test('non-JSON values are refused before approval or dispatch', async () => {
  const cycle = {}; cycle.self = cycle;
  const invalid = [new Date(), new Map(), new Set(), undefined, NaN, Infinity, 1n, () => {}, Symbol('value'), cycle, [, 1]];
  const client = fixture(); let approvals = 0;
  const adapter = await browserFunctionTools(client, { ...scope, approve: async () => { approvals++; return true; } });
  for (const value of invalid) await assert.rejects(adapter.call(tool.name, { data: { value } }), /JSON/);
  await assert.rejects(adapter.call(tool.name, new Date()), /JSON/);
  assert.equal(approvals, 0); assert.equal(client.calls.length, 0); adapter.close();
});

test('accessors are refused without invoking them, including the browser argument', async () => {
  const client = fixture(), adapter = await browserFunctionTools(client, scope); let reads = 0;
  for (const name of ['data', 'browser']) {
    const args = Object.defineProperty({}, name, { enumerable: true, get() { reads++; return scope.browser; } });
    await assert.rejects(adapter.call(tool.name, args), /JSON/);
  }
  const nested = Object.defineProperty({}, 'value', { enumerable: true, get() { reads++; return 'value'; } });
  await assert.rejects(adapter.call(tool.name, { data: nested }), /JSON/);
  assert.equal(reads, 0); assert.equal(client.calls.length, 0); adapter.close();
});

test('public definition snapshots cannot poison later provider exports', async () => {
  const adapter = await browserFunctionTools(fixture(), scope), definitions = adapter.definitions;
  definitions[0].name = 'browser_type'; definitions[0].parameters.properties.data = { type: 'number' };
  definitions.push({ name: 'unexpected' });
  assert.equal(adapter.openai().length, 1);
  assert.equal(adapter.openai()[0].name, tool.name);
  assert.equal(adapter.anthropic()[0].input_schema.properties.data.type, 'object');
  assert.equal(adapter.definitions[0].name, tool.name); adapter.close();
});

test('invalid cancellation setup cannot permanently lock the adapter', async () => {
  const client = fixture(), adapter = await browserFunctionTools(client, scope);
  await assert.rejects(adapter.call(tool.name, {}, { signal: { throwIfAborted() {} } }));
  await adapter.call(tool.name);
  assert.equal(client.calls.length, 1); adapter.close();
});

test('plain records from other realms and null prototypes retain JSON semantics', async () => {
  const client = fixture(), approved = [];
  const adapter = await browserFunctionTools(client, { ...scope, approve: async request => { approved.push(request.arguments); return true; } });
  const shared = { x: 1 }, record = Object.assign(Object.create(null), { left: shared, right: shared });
  for (const data of [record, runInNewContext('({list:[1,"two",null,false],number:-0})')]) {
    await adapter.call(tool.name, { data });
    const expected = JSON.parse(JSON.stringify({ data, browser: scope.browser }));
    assert.deepEqual(approved.at(-1), expected); assert.deepEqual(client.calls.at(-1)[0].arguments, expected);
  }
  adapter.close();
});

test('deep, oversized and decorated JSON-like values fail before approval', async () => {
  let deep = {}; for (let n = 0; n < 130; n++) deep = { nested: deep };
  const decorated = [1]; decorated.extra = true;
  const symbol = { [Symbol('hidden')]: true };
  const client = fixture(); let approvals = 0;
  const adapter = await browserFunctionTools(client, { ...scope, approve: async () => { approvals++; return true; } });
  for (const data of [deep, Array(100001).fill(0), decorated, symbol]) await assert.rejects(adapter.call(tool.name, { data }), /JSON/);
  assert.equal(approvals, 0); assert.equal(client.calls.length, 0); adapter.close();
});

test('approval and the MCP HTTP server receive the same JSON, including literal prototype keys', async t => {
  const received = [], approved = [], sessions = createSessions();
  const http = createServer((req, res) => sessions.handle(req, res, 'owned-json-fixture', () => {
    const server = new Server({ name: 'json-boundary-fixture', version: '1' }, { capabilities: { tools: {} } });
    server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [tool] }));
    server.setRequestHandler(CallToolRequestSchema, async request => {
      received.push(request.params.arguments); return { content: [{ type: 'text', text: 'observed' }] };
    }); return server;
  }).catch(() => { if (!res.headersSent) res.writeHead(500); res.end(); }));
  await new Promise(resolve => http.listen(0, '127.0.0.1', resolve));
  const client = new Client({ name: 'json-boundary-client', version: '1' });
  t.after(async () => { await client.close(); sessions.close(); http.closeAllConnections(); await new Promise(resolve => http.close(resolve)); });
  await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${http.address().port}/mcp`)));
  const adapter = await browserFunctionTools(client, { ...scope, approve: async request => { approved.push(structuredClone(request.arguments)); return true; } });
  const data = JSON.parse('{"__proto__":{"literal":true},"constructor":"literal","toJSON":"data","values":[0,false,null,"text"],"zero":-0}');
  await adapter.call(tool.name, { data });
  assert.deepEqual(received[0], approved[0]);
  assert.deepEqual(received[0].data, JSON.parse(JSON.stringify(data)));
  assert.equal(Object.hasOwn(received[0].data, '__proto__'), true);
  assert.equal(Object.getPrototypeOf(received[0].data), Object.prototype);
  await assert.rejects(adapter.call(tool.name, { data: { absent: undefined } }), /JSON/);
  assert.equal(received.length, 1); assert.equal(approved.length, 1);
  adapter.close(); await client.ping();
});
