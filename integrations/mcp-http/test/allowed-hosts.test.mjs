import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request } from 'node:http';
import { createBridge, readConfig, parseAllowedHosts } from '../server.mjs';
import { token, authorization } from './auth-fixture.mjs';

const freePort = async () => {
  const reservation = createServer();
  await new Promise(resolve => reservation.listen(0, '127.0.0.1', resolve));
  const { port } = reservation.address();
  await new Promise(resolve => reservation.close(resolve));
  return port;
};

// fetch() cannot override Host, so send raw requests to 127.0.0.1 with a chosen Host.
const send = (port, { method = 'POST', host, headers = {}, body } = {}) => new Promise((resolve, reject) => {
  const req = request({ host: '127.0.0.1', port, method, path: '/mcp', headers: {
    'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', ...(host === undefined ? {} : { Host: host }), ...headers } }, res => {
    let text = ''; res.setEncoding('utf8'); res.on('data', chunk => { text += chunk; });
    res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text }));
  });
  req.on('error', reject);
  req.end(body);
});

const init = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'allowed-host-fixture', version: '1' } } });
const listTools = JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'private_read', arguments: {} } });
const initialized = JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' });

test('allowed hosts: parsing accepts DNS names with optional ports and rejects everything else', () => {
  assert.deepEqual(parseAllowedHosts(undefined), []);
  assert.deepEqual(parseAllowedHosts('  '), []);
  assert.deepEqual(parseAllowedHosts('My-Mac.Example-Tailnet.ts.net:8788'), ['my-mac.example-tailnet.ts.net:8788']);
  assert.deepEqual(parseAllowedHosts('host.example.ts.net'), ['host.example.ts.net', 'host.example.ts.net:443']);
  assert.deepEqual(parseAllowedHosts('host.example.ts.net.:8788, other.example.ts.net:9000'), ['host.example.ts.net:8788', 'other.example.ts.net:9000']);
  for (const bad of ['*', '*.ts.net', 'https://host.example.ts.net', 'host.example.ts.net/mcp', 'user@host.example.ts.net',
    'localhost', '0.0.0.0', '100.64.0.1:8788', '[::1]:8788', 'host.example.ts.net:0', 'host.example.ts.net:70000',
    '-bad.example.ts.net', 'bad-.example.ts.net', 'under_score.example.ts.net', 'a..b.ts.net', `${'a'.repeat(64)}.ts.net`]) {
    assert.throws(() => parseAllowedHosts(bad), /KITSUVO_MCP_ALLOWED_HOSTS entry/, bad);
  }
  assert.throws(() => parseAllowedHosts(Array.from({ length: 9 }, (_, i) => `h${i}.example.ts.net`).join(',')), /at most 8/);
});

test('allowed hosts: an invalid value never breaks stdio config but refuses to start HTTP', () => {
  const config = readConfig({ KITSUVO_MCP_ALLOWED_HOSTS: '*' });
  assert.match(config.allowedHostsError, /KITSUVO_MCP_ALLOWED_HOSTS entry/);
  assert.deepEqual(config.allowedHosts, []);
  assert.throws(() => createBridge({}, { ...config, token }), /KITSUVO_MCP_ALLOWED_HOSTS entry/);
  assert.equal(readConfig({}).allowedHostsError, undefined);
  assert.deepEqual(readConfig({}).allowedHosts, []);
});

for (const shared of [true, false]) {
  test(`allowed hosts (${shared ? 'shared' : 'per-session'} mode): configured name works end to end; every other Host, Origin and credential is refused`, async () => {
    const port = await freePort();
    let starts = 0, calls = 0;
    const backend = { listTools: async () => ({ tools: [{ name: 'private_read', inputSchema: { type: 'object' } }] }),
      callTool: async () => { calls++; return { content: [{ type: 'text', text: 'private fixture' }] }; }, close: async () => {} };
    const allowedHosts = parseAllowedHosts('mili.example-tailnet.ts.net:8788,bare.example-tailnet.ts.net');
    const bridge = createBridge(backend, { token, port, allowedHosts, ...(shared ? {} : { createBackend: async () => { starts++; return backend; } }) });
    await new Promise(resolve => bridge.listen(port, '127.0.0.1', resolve));
    const auth = { Authorization: authorization };
    try {
      // Refused before any backend work.
      const refused = [
        { host: 'attacker.example:8788', headers: auth },
        { host: 'mili.example-tailnet.ts.net:9999', headers: auth },
        { host: 'mili.example-tailnet.ts.net', headers: auth },
        { host: 'bare.example-tailnet.ts.net:8788', headers: auth },
        { host: 'mili.example-tailnet.ts.net:8788', headers: { ...auth, Origin: 'https://mili.example-tailnet.ts.net:8788' } },
        { host: 'mili.example-tailnet.ts.net:8788', headers: { ...auth, Origin: 'http://mili.example-tailnet.ts.net:8788' } },
        { host: 'mili.example-tailnet.ts.net:8788', headers: { ...auth, 'Tailscale-Funnel-Request': '?1' } },
        { host: 'attacker.example', headers: { ...auth, 'X-Forwarded-Host': 'mili.example-tailnet.ts.net:8788', Forwarded: 'host=mili.example-tailnet.ts.net:8788' } },
      ];
      for (const r of refused) assert.equal((await send(port, { ...r, body: init })).status, 403, JSON.stringify(r));
      for (const headers of [{}, { Authorization: `Bearer ${'z'.repeat(43)}` }]) {
        assert.equal((await send(port, { host: 'mili.example-tailnet.ts.net:8788', headers, body: init })).status, 401);
      }
      const hint = await send(port, { host: 'attacker.example', headers: auth, body: init });
      assert.match(hint.text, /KITSUVO_MCP_ALLOWED_HOSTS/);
      assert.ok(!hint.text.includes('attacker.example'), 'the refusal does not echo the received Host');
      assert.equal(starts, 0); assert.equal(calls, 0);

      // Accepted: exact configured host (case and trailing dot normalised), bare name on 443, and loopback as before.
      for (const host of ['MILI.example-tailnet.ts.net.:8788', 'bare.example-tailnet.ts.net', 'bare.example-tailnet.ts.net:443', `127.0.0.1:${port}`]) {
        const opened = await send(port, { host, headers: auth, body: init });
        assert.equal(opened.status, 200, host);
        const session = opened.headers['mcp-session-id'];
        assert.ok(session, host);
        const headers = { ...auth, 'mcp-session-id': session, 'mcp-protocol-version': '2025-06-18' };
        assert.equal((await send(port, { host, headers, body: initialized })).status, 202, host);
        const called = await send(port, { host, headers, body: listTools });
        assert.equal(called.status, 200, host); assert.match(called.text, /private fixture/);
        // A session opened through the allowed host cannot be reused from a foreign Host or without the token.
        assert.equal((await send(port, { host: 'attacker.example:8788', headers, body: listTools })).status, 403);
        assert.equal((await send(port, { host, headers: { 'mcp-session-id': session }, body: listTools })).status, 401);
        assert.equal((await send(port, { method: 'DELETE', host, headers })).status, 200, `${host} delete`);
      }
      assert.equal(calls, 4);
    } finally {
      await bridge.closeSessions(); bridge.closeAllConnections(); await new Promise(resolve => bridge.close(resolve));
    }
  });
}

test('allowed hosts: unset keeps the loopback-only behaviour', async () => {
  const port = await freePort();
  const backend = { listTools: async () => ({ tools: [] }), callTool: async () => ({ content: [] }), close: async () => {} };
  const bridge = createBridge(backend, { token, port });
  await new Promise(resolve => bridge.listen(port, '127.0.0.1', resolve));
  try {
    assert.equal((await send(port, { host: 'mili.example-tailnet.ts.net:8788', headers: { Authorization: authorization }, body: init })).status, 403);
    assert.equal((await send(port, { host: `localhost:${port}`, headers: { Authorization: authorization }, body: init })).status, 200);
  } finally {
    await bridge.closeSessions(); bridge.closeAllConnections(); await new Promise(resolve => bridge.close(resolve));
  }
});
