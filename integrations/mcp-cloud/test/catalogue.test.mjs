import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { WebSocketServer } from 'ws';
import { connectBrowser } from '../connect.mjs';

test('connector caches tools and invalidates only on a catalogue notification', async t => {
  const http = createServer(); const ws = new WebSocketServer({ server: http, path: '/connect' });
  await new Promise(resolve => http.listen(0, '127.0.0.1', resolve));
  let catalogues = 0, invalidate;
  const connected = once(ws, 'connection');
  const connector = connectBrowser({ origin: `http://127.0.0.1:${http.address().port}`, backend: {
    listTools: async () => { catalogues++; return { tools: [{ name: 'fixture' }] }; },
    callTool: async () => ({ content: [], isError: false }),
    setNotificationHandler: (_, handler) => { invalidate = handler; },
  } });
  t.after(async () => { connector.socket.terminate(); for (const socket of ws.clients) socket.terminate(); ws.close(); http.closeAllConnections(); await new Promise(resolve => http.close(resolve)); });
  const [socket] = await connected;
  const call = async id => {
    const result = once(socket, 'message');
    socket.send(JSON.stringify({ type: 'call', id, method: 'tools/call', params: { name: 'fixture', arguments: {} } }));
    assert.equal(JSON.parse((await result)[0]).type, 'result');
  };
  await call('one'); await call('two'); assert.equal(catalogues, 1);
  invalidate(); await call('three'); assert.equal(catalogues, 2);
});

async function relayFixture(t, backend) {
  const http = createServer(), ws = new WebSocketServer({ server: http, path: '/connect' });
  await new Promise(resolve => http.listen(0, '127.0.0.1', resolve));
  const connected = once(ws, 'connection');
  const connector = connectBrowser({ origin: `http://127.0.0.1:${http.address().port}`, backend });
  t.after(async () => {
    connector.socket.terminate(); for (const socket of ws.clients) socket.terminate(); ws.close();
    http.closeAllConnections(); await new Promise(resolve => http.close(resolve));
  });
  const [socket] = await connected; let next = 0;
  return async (method, params) => {
    const result = once(socket, 'message');
    socket.send(JSON.stringify({ type: 'call', id: String(++next), method, params }));
    return JSON.parse((await result)[0]);
  };
}
const definition = name => ({ name, inputSchema: { type: 'object' } });
test('connector exposes complete paged metadata and can call a later-page tool', async t => {
  const pages = [], calls = [];
  const call = await relayFixture(t, {
    async listTools(params) {
      pages.push(params?.cursor);
      return params?.cursor === 'second' ? { tools: [{ ...definition('later'), _meta: { fixture: true } }] }
        : { tools: [definition('first')], nextCursor: 'second', _meta: { fixture: 'catalog' } };
    },
    async callTool(params) { calls.push(params); return { content: [{ type: 'text', text: 'Later page result' }] }; },
  });
  const list = await call('tools/list', {});
  assert.equal(list.error, undefined); assert.equal(list.result.nextCursor, undefined);
  assert.deepEqual(list.result.tools.map(tool => tool.name), ['first', 'later']);
  assert.deepEqual(list.result._meta, { fixture: 'catalog' });
  assert.deepEqual(list.result.tools[1]._meta, { fixture: true });
  const result = await call('tools/call', { name: 'later', arguments: {} });
  assert.equal(result.error, undefined); assert.equal(result.result.content[0].text, 'Later page result');
  assert.deepEqual(pages, [undefined, 'second']); assert.equal(calls.length, 1);
});

for (const kind of ['duplicate', 'cycle', 'page-limit', 'tool-limit']) {
  test(`connector refuses ${kind} discovery and recovers without a partial cache`, async t => {
    let broken = true, pages = 0;
    const call = await relayFixture(t, { async listTools() {
      pages++;
      if (!broken) return { tools: [definition('recovered')] };
      if (kind === 'duplicate') return { tools: [definition('same'), definition('same')] };
      if (kind === 'tool-limit') return { tools: Array.from({ length: 2049 }, (_, i) => definition(`fixture_${i}`)) };
      return { tools: [], nextCursor: kind === 'cycle' ? 'same' : String(pages) };
    } });
    assert.equal((await call('tools/list', {})).error, 'Browser request failed.');
    assert.ok(pages <= 16);
    broken = false;
    const result = await call('tools/list', {});
    assert.equal(result.error, undefined); assert.equal(result.result.tools[0].name, 'recovered');
  });
}

test('independently distributed discovery helpers stay identical', async () => {
  const { readFile } = await import('node:fs/promises');
  assert.equal(await readFile(new URL('../client-requests.mjs', import.meta.url), 'utf8'),
    await readFile(new URL('../../mcp-http/client-requests.mjs', import.meta.url), 'utf8'));
});
