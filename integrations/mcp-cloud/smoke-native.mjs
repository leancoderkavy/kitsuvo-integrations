// Explicit qualification only: a disposable local browser approves this script's
// own test client, never a real user's account or existing OAuth request.
import assert from 'node:assert/strict';
import { EventEmitter, once } from 'node:events';
import { randomBytes, createHash } from 'node:crypto';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { connectBrowser } from './connect.mjs';

if (process.env.KITSUVO_CLOUD_SMOKE !== '1') throw new Error('Set KITSUVO_CLOUD_SMOKE=1 to explicitly run disposable native qualification.');
const origin = new URL(process.env.KITSUVO_CLOUD_ORIGIN).origin;
const profile = await mkdtemp(join(tmpdir(), 'kitsuvo-cloud-smoke-'));
const native = new Client({ name: 'kitsuvo-cloud-smoke-native', version: '1' });
const sdk = new Client({ name: 'kitsuvo-cloud-smoke-client', version: '1' });
const events = new EventEmitter();
const fixture = createServer((_req, res) => res.end('<title>Kitsuvo cloud qualification</title><main><h1>Isolated browser relay fixture</h1></main>'));
let browser, grant;
try {
  const env = Object.fromEntries(['PATH', 'SystemRoot', 'USERPROFILE', 'HOME', 'TMP', 'TEMP', 'LOCALAPPDATA'].filter(key => process.env[key]).map(key => [key, process.env[key]]));
  env.KITSUVO_PROFILE_DIR = profile;
  await native.connect(new StdioClientTransport({ command: process.env.KITSUVO_BINARY || 'kitsuvo', args: ['mcp'], env, stderr: 'inherit' }));
  browser = connectBrowser({ origin, backend: native, onMessage: message => events.emit(message.type, message) });
  browser.socket.on('error', error => events.emit('error', error));
  await once(events, 'connected');
  const registration = await fetch(origin + '/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ client_name: 'Kitsuvo disposable qualification', redirect_uris: ['http://127.0.0.1/callback'], token_endpoint_auth_method: 'none', grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'] }) });
  assert.equal(registration.status, 201); const client = await registration.json();
  const verifier = randomBytes(32).toString('base64url');
  const params = new URLSearchParams({ client_id: client.client_id, response_type: 'code', redirect_uri: client.redirect_uris[0], code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256', scope: 'browser', resource: origin + '/mcp', state: 'disposable-smoke' });
  const authUrl = origin + '/authorize?' + params;
  const authResponse = await fetch(authUrl); assert.equal(authResponse.status, 200);
  const requestId = (await authResponse.text()).match(/approve ([A-Za-z0-9_-]{43})/)[1];
  const reviewed = once(events, 'review'); browser.review(requestId);
  assert.equal((await reviewed)[0].clientName, 'Kitsuvo disposable qualification');
  const approved = once(events, 'approved'); browser.approve(requestId); await approved;
  const redirect = await fetch(authUrl, { redirect: 'manual' }); assert.equal(redirect.status, 302);
  const location = new URL(redirect.headers.get('location')); assert.equal(location.searchParams.get('state'), 'disposable-smoke');
  const tokenResponse = await fetch(origin + '/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'authorization_code', client_id: client.client_id, redirect_uri: client.redirect_uris[0], code: location.searchParams.get('code'), code_verifier: verifier, resource: origin + '/mcp' }) });
  assert.equal(tokenResponse.status, 200); grant = await tokenResponse.json();
  await sdk.connect(new StreamableHTTPClientTransport(new URL(origin + '/mcp'), { requestInit: { headers: { Authorization: 'Bearer ' + grant.access_token } } }));
  assert.equal((await sdk.listTools()).tools.length, (await native.listTools()).tools.length);
  await new Promise(resolve => fixture.listen(0, '127.0.0.1', resolve));
  const call = async (name, args = {}) => {
    const result = await sdk.callTool({ name, arguments: args }, undefined, { timeout: 60000 });
    assert.notEqual(result.isError, true); return result;
  };
  await call('browser_tabs', { action: 'list' });
  await call('browser_navigate', { url: `http://127.0.0.1:${fixture.address().port}` });
  assert.match(JSON.stringify((await call('browser_snapshot')).content), /Isolated browser relay fixture/);
  await call('kitsuvo_report');
  assert.equal((await sdk.callTool({ name: 'browser_navigate', arguments: { url: 'https://accounts.google.com/' } })).isError, true);
  const count = (await sdk.listTools()).tools.length;
  await sdk.close(); const closed = once(browser.socket, 'close'); browser.socket.close(); await closed;
  assert.equal((await fetch(origin + '/userinfo', { headers: { Authorization: 'Bearer ' + grant.access_token } })).status, 401);
  console.log(`Cloud relay ${origin}: OAuth PKCE, ${count} native tools, isolated navigation, snapshot, report, sensitive-page refusal and disconnect revocation passed.`);
} finally {
  await sdk.close(); browser?.socket.terminate(); await native.close();
  fixture.closeAllConnections(); await new Promise(resolve => fixture.close(resolve));
  try {
    const control = JSON.parse(await readFile(join(profile, 'agent/control.json'), 'utf8'));
    if (Number.isInteger(control.pid) && control.pid !== process.pid) process.kill(control.pid);
  } catch (error) { if (!['ENOENT', 'ESRCH'].includes(error.code)) console.error('Close the disposable browser window.'); }
}
