import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request as httpRequest } from 'node:http';
import { EventEmitter, once } from 'node:events';
import { randomBytes, createHash } from 'node:crypto';
import { createRelay } from '../server.mjs';
import { connectBrowser, browserTransportConfig } from '../connect.mjs';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

async function fixture(t) {
  const reserve = createServer();
  await new Promise(resolve => reserve.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${reserve.address().port}`;
  await new Promise(resolve => reserve.close(resolve));
  const relay = createRelay({ origin });
  await new Promise(resolve => relay.http.listen(new URL(origin).port, '127.0.0.1', resolve));
  t.after(() => relay.close());
  const post = (path, values) => fetch(origin + path, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(values) });
  async function browser(label, app = false) {
    const events = new EventEmitter();
    const connection = connectBrowser({ origin, backend: {
      getServerCapabilities() { return app ? { resources: {} } : {}; },
      async listTools() { return { tools: [{ name: 'fixture', description: label, inputSchema: { type: 'object' }, ...(app ? { _meta: { ui: { resourceUri: 'ui://kitsuvo/browser.html' } } } : {}) }] }; },
      async callTool() { return { content: [{ type: 'text', text: label }] }; },
      async listResources() { return { resources: [{ uri: 'ui://kitsuvo/browser.html', name: 'browser', mimeType: 'text/html;profile=mcp-app' }] }; },
      async readResource({ uri }) { return { contents: [{ uri, mimeType: 'text/html;profile=mcp-app', text: `<p>${label}</p>` }] }; },
    }, onMessage: message => events.emit(message.type, message) });
    connection.socket.on('error', error => events.emit('error', error));
    await once(events, 'connected');
    return { ...connection, events };
  }
  async function client() {
    const response = await fetch(origin + '/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ client_name: 'Fixture client', redirect_uris: ['http://127.0.0.1/callback'], token_endpoint_auth_method: 'none', grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'] }) });
    assert.equal(response.status, 201);
    return response.json();
  }
  async function authorize(client, browser) {
    const verifier = randomBytes(32).toString('base64url');
    const params = new URLSearchParams({ client_id: client.client_id, response_type: 'code', redirect_uri: client.redirect_uris[0], code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256', scope: 'browser', resource: origin + '/mcp', state: 'fixture-state' });
    const url = origin + '/authorize?' + params;
    const page = await fetch(url);
    assert.equal(page.status, 200);
    assert.equal(page.headers.get('cache-control'), 'no-store');
    const id = (await page.text()).match(/approve ([A-Za-z0-9_-]{43})/)[1];
    const review = once(browser.events, 'review'); browser.review(id);
    assert.equal((await review)[0].clientName, 'Fixture client');
    const approved = once(browser.events, 'approved'); browser.approve(id); await approved;
    const redirect = await fetch(url, { redirect: 'manual' });
    assert.equal(redirect.status, 302);
    const location = new URL(redirect.headers.get('location'));
    assert.equal(location.origin, 'http://127.0.0.1');
    assert.equal(location.searchParams.get('state'), 'fixture-state');
    return { code: location.searchParams.get('code'), verifier, id };
  }
  const exchange = (client, auth, overrides = {}) => post('/token', { grant_type: 'authorization_code', client_id: client.client_id, redirect_uri: client.redirect_uris[0], code: auth.code, code_verifier: auth.verifier, resource: origin + '/mcp', ...overrides });
  return { relay, origin, post, browser, client, authorize, exchange };
}

test('OAuth PKCE, resource binding, replay, rotation and revocation fail closed', { timeout: 20000 }, async t => {
  const f = await fixture(t), browser = await f.browser('owner'), client = await f.client(), other = await f.client();
  const unauthenticated = await fetch(f.origin + '/mcp', { method: 'POST' });
  assert.equal(unauthenticated.status, 401);
  assert.match(unauthenticated.headers.get('www-authenticate'), /resource_metadata/);
  const metadata = await (await fetch(f.origin + '/.well-known/oauth-protected-resource/mcp')).json();
  assert.equal(metadata.resource, f.origin + '/mcp');
  const auth = await f.authorize(client, browser);
  assert.equal((await f.exchange(client, auth, { code_verifier: randomBytes(32).toString('base64url') })).status, 400);
  assert.equal((await f.exchange(other, auth)).status, 400);
  assert.equal((await f.exchange(client, auth, { resource: 'https://other.invalid/mcp' })).status, 400);
  assert.equal((await f.exchange(client, auth, { redirect_uri: 'http://127.0.0.1/wrong' })).status, 400);
  const response = await f.exchange(client, auth); assert.equal(response.status, 200);
  const tokens = await response.json();
  assert.equal((await f.exchange(client, auth)).status, 400);
  const refresh = await f.post('/token', { grant_type: 'refresh_token', client_id: client.client_id, refresh_token: tokens.refresh_token, resource: f.origin + '/mcp' });
  assert.equal(refresh.status, 200); const rotated = await refresh.json();
  assert.notEqual(rotated.refresh_token, tokens.refresh_token);
  assert.equal((await f.post('/token', { grant_type: 'refresh_token', client_id: client.client_id, refresh_token: tokens.refresh_token })).status, 400);
  assert.equal((await fetch(f.origin + '/userinfo', { headers: { Authorization: 'Bearer ' + tokens.access_token } })).status, 401);
  const user = await fetch(f.origin + '/userinfo', { headers: { Authorization: 'Bearer ' + rotated.access_token } });
  assert.equal(user.status, 200); assert.equal((await user.json()).email_verified, undefined);
  await f.post('/revoke', { client_id: client.client_id, token: rotated.refresh_token });
  assert.equal((await fetch(f.origin + '/userinfo', { headers: { Authorization: 'Bearer ' + rotated.access_token } })).status, 401);
});

test('MCP tools and App resources route only to the consenting browser; disconnect revokes access', { timeout: 20000 }, async t => {
  const f = await fixture(t), a = await f.browser('browser-a', true), b = await f.browser('browser-b', true);
  const clients = await Promise.all([f.client(), f.client()]);
  const auth = await Promise.all([f.authorize(clients[0], a), f.authorize(clients[1], b)]);
  const tokens = await Promise.all(clients.map(async (client, index) => (await f.exchange(client, auth[index])).json()));
  const sdk = await Promise.all(tokens.map(async token => {
    const client = new Client({ name: 'fixture', version: '1' });
    const transport = new StreamableHTTPClientTransport(new URL(f.origin + '/mcp'), { requestInit: { headers: { Authorization: 'Bearer ' + token.access_token } } });
    await client.connect(transport); t.after(() => client.close()); return client;
  }));
  assert.equal((await sdk[0].listTools()).tools[0].description, 'browser-a');
  assert.equal((await sdk[1].callTool({ name: 'fixture', arguments: {} })).content[0].text, 'browser-b');
  assert.deepEqual((await sdk[0].listTools()).tools[0]._meta.securitySchemes, [{ type: 'oauth2', scopes: ['browser'] }]);
  assert.equal((await sdk[0].listTools()).tools[0]._meta.ui.resourceUri, 'ui://kitsuvo/browser.html');
  assert.equal((await sdk[0].listResources()).resources[0].uri, 'ui://kitsuvo/browser.html');
  assert.equal((await sdk[0].readResource({ uri: 'ui://kitsuvo/browser.html' })).contents[0].text, '<p>browser-a</p>');
  assert.equal((await sdk[1].readResource({ uri: 'ui://kitsuvo/browser.html' })).contents[0].text, '<p>browser-b</p>');
  await assert.rejects(sdk[0].readResource({ uri: 'file:///private/config' }));
  const closed = once(a.socket, 'close'); a.socket.close(); await closed;
  assert.equal((await fetch(f.origin + '/userinfo', { headers: { Authorization: 'Bearer ' + tokens[0].access_token } })).status, 401);
  assert.equal((await sdk[1].listTools()).tools[0].description, 'browser-b');
  await assert.rejects(sdk[0].listResources());
});

test('connector App mode uses the fixed stdio bridge and preserves an isolated profile', () => {
  const config = browserTransportConfig({ KITSUVO_BINARY: 'C:/Program Files/Kitsuvo/kitsuvo.exe', KITSUVO_PROFILE_DIR: '/tmp/isolated-profile' }, true);
  assert.equal(config.command, process.execPath);
  assert.ok(config.args[0].endsWith('server.mjs'));
  assert.equal(config.args[1], '--stdio');
  assert.equal(config.env.KITSUVO_BINARY, 'C:/Program Files/Kitsuvo/kitsuvo.exe');
  assert.equal(config.env.KITSUVO_PROFILE_DIR, '/tmp/isolated-profile');
  assert.deepEqual(browserTransportConfig({}, false).args, ['mcp']);
});

test('unsafe relay URLs, redirects, hosts, origins and scopes are rejected', { timeout: 20000 }, async t => {
  assert.throws(() => createRelay({ origin: 'http://public.invalid' }));
  assert.throws(() => connectBrowser({ origin: 'https://user:secret@public.invalid', backend: {} }));
  const f = await fixture(t);
  assert.equal((await fetch(f.origin + '/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ redirect_uris: ['http://public.invalid/callback'] }) })).status, 400);
  assert.equal((await fetch(f.origin + '/mcp', { headers: { Origin: 'https://other.invalid' } })).status, 403);
  const foreignHost = await new Promise((resolve, reject) => {
    const request = httpRequest(f.origin + '/mcp', { headers: { Host: 'other.invalid' } }, response => { response.resume(); resolve(response.statusCode); });
    request.on('error', reject); request.end();
  });
  assert.equal(foreignHost, 403);
  const client = await f.client();
  const params = new URLSearchParams({ client_id: client.client_id, response_type: 'code', redirect_uri: client.redirect_uris[0], code_challenge: randomBytes(32).toString('base64url'), code_challenge_method: 'S256', scope: 'admin' });
  const denied = await fetch(f.origin + '/authorize?' + params, { redirect: 'manual' });
  assert.equal(denied.status, 302);
  assert.equal(new URL(denied.headers.get('location')).searchParams.get('error'), 'invalid_scope');
});
