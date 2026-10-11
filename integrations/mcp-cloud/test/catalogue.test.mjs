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
