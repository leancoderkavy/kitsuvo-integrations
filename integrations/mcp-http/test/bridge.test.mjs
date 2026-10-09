import assert from 'node:assert/strict';
import { test } from 'node:test';
import { request } from 'node:http';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createBridge, readConfig } from '../server.mjs';

test('port configuration rejects invalid values', () => {
  for (const value of ['0', '-1', '65536', 'abc', '1.5']) {
    assert.throws(() => readConfig({ KITSUVO_MCP_PORT: value }));
  }
  assert.equal(readConfig({ KITSUVO_BINARY: 'C:/Program Files/Kitsuvo/kitsuvo.exe' }).binary,
    'C:/Program Files/Kitsuvo/kitsuvo.exe');
});

test('HTTP MCP negotiates, forwards tools and results, and rejects untrusted requests', async t => {
  const calls = [];
  const tool = { name: 'kitsuvo_report', description: 'Detection evidence',
    inputSchema: { type: 'object', properties: { tab: { type: 'integer' } } },
    annotations: { readOnlyHint: true, openWorldHint: true } };
  const backend = {
    listTools: async () => ({ tools: [tool] }),
    callTool: async params => {
      calls.push(params);
      return { content: [{ type: 'text', text: 'evidence' }], isError: params.arguments.tab === 99 };
    },
  };
  // Choose an OS-assigned port, then construct the bridge for that exact Host.
  const reservation = createBridge(backend);
  await new Promise(resolve => reservation.listen(0, '127.0.0.1', resolve));
  const port = reservation.address().port;
  await new Promise(resolve => reservation.close(resolve));
  const bridge = createBridge(backend, { port });
  await new Promise(resolve => bridge.listen(port, '127.0.0.1', resolve));
  t.after(() => { bridge.closeAllConnections(); bridge.close(); });
  const url = new URL(`http://127.0.0.1:${port}/mcp`);
  const client = new Client({ name: 'test', version: '1.0.0' });
  t.after(() => client.close());
  await client.connect(new StreamableHTTPClientTransport(url));
  assert.deepEqual((await client.listTools()).tools, [tool]);
  const result = await client.callTool({ name: 'kitsuvo_report', arguments: { tab: 3 } });
  assert.equal(result.content[0].text, 'evidence');
  assert.deepEqual(calls[0], { name: 'kitsuvo_report', arguments: { tab: 3 } });
  assert.equal((await client.callTool({ name: 'kitsuvo_report', arguments: { tab: 99 } })).isError, true);
  assert.equal((await fetch(url, { method: 'POST', headers: { Origin: 'https://evil.example' } })).status, 403);
  const foreignHostStatus = await new Promise((resolve, reject) => {
    const req = request(url, { method: 'POST', headers: { Host: 'evil.example' } }, res => {
      res.resume();
      resolve(res.statusCode);
    });
    req.on('error', reject);
    req.end();
  });
  assert.equal(foreignHostStatus, 403);
  assert.equal((await fetch(url)).status, 405);
  assert.equal((await fetch(new URL('/wrong', url))).status, 404);
});
