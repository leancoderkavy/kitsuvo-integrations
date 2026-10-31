import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { EventEmitter, once } from 'node:events';
import { createHash, generateKeyPairSync, randomBytes, sign } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import WebSocket, { WebSocketServer } from 'ws';
import { createRelay, limits, plusLimits } from '../server.mjs';
import { connectBrowser } from '../connect.mjs';
import { validateConfig } from '../service.mjs';
import { PLUS_PRODUCT, verifyPlus, plusPublicKey, plusSource, watchPlus, defaultPlusLicensePath } from '../plus.mjs';

// The SDK rate-limits OAuth endpoints per address; fixture requests spread across
// documentation-range sources unless a test names its source.
const anywhere = () => `198.18.${randomBytes(1)[0]}.${randomBytes(1)[0]}`;
const fetch = (url, options = {}) => globalThis.fetch(url, { ...options, headers: { 'X-Forwarded-For': anywhere(), ...options.headers, Connection: 'close' } });
// A throwaway test keypair; production uses the site's key, which tests never touch.
const keypair = () => {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  return { privateKey, hex: publicKey.export({ type: 'spki', format: 'der' }).subarray(-32).toString('hex') };
};
const signer = keypair(), stranger = keypair();
const seconds = () => Math.floor(Date.now() / 1000);
// Same format as site/api/_lib/license.mjs subscriptionLicense.
function mint({ key = signer.privateKey, subscription = 'sub_test', product = PLUS_PRODUCT, issued = seconds(), ttl = 7 * 86400, extra = {} } = {}) {
  const claims = { version: 1, product, subject: createHash('sha256').update(subscription).digest('hex'), issued_at: issued, expires_at: issued + ttl, ...extra };
  const body = Buffer.from(JSON.stringify(claims)).toString('base64url');
  return `${body}.${sign(null, Buffer.from(body), key).toString('base64url')}`;
}
const expired = () => mint({ issued: seconds() - 8 * 86400, ttl: 86400 });
const forged = () => mint({ key: stranger.privateKey });
const wrongProduct = () => mint({ product: 'kitsuvo-plus-team-v1' });

test('activation codes are verified offline exactly like the desktop app', () => {
  const key = plusPublicKey(signer.hex), now = seconds();
  const valid = verifyPlus(mint({ ttl: 3600 }), key, now);
  assert.deepEqual(valid, { subject: createHash('sha256').update('sub_test').digest('hex'), expiresAt: now + 3600 });
  for (const [label, code] of [
    ['expired', expired()], ['forged', forged()], ['wrong product', wrongProduct()],
    ['longer than seven days', mint({ ttl: 7 * 86400 + 1 })], ['issued in the future', mint({ issued: now + 600 })],
    ['unknown claim', mint({ extra: { tier: 'max' } })], ['bad subject', mint({ extra: { subject: 'not-hex' } })],
    ['wrong version', mint({ extra: { version: 2 } })], ['tampered body', 'e30' + mint().slice(3)],
    ['oversized', mint() + 'A'.repeat(2048)], ['not a code', 'nope'], ['missing', undefined], ['array', ['a', 'b']],
  ]) assert.equal(verifyPlus(code, key, now), undefined, label);
  assert.equal(verifyPlus(mint(), undefined, now), undefined, 'a relay without a configured key grants no Plus');
  assert.throws(() => plusPublicKey('xyz'));
  assert.equal(plusPublicKey(''), undefined);
});

async function fixture(t, { durable = false, plusKey = signer.hex } = {}) {
  const directory = await mkdtemp(path.join(tmpdir(), 'kitsuvo-plus-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const stateFile = durable ? path.join(directory, 'state.json') : undefined;
  const reserve = createServer();
  await new Promise(resolve => reserve.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${reserve.address().port}`;
  await new Promise(resolve => reserve.close(resolve));
  let offset = 0;
  const clock = { wall: () => Date.now(), monotonic: () => performance.now() + offset * 1000 };
  const relay = createRelay({ origin, stateFile, trustedProxyHops: 1, clock, plusKey });
  await new Promise(resolve => relay.http.listen(new URL(origin).port, '127.0.0.1', resolve));
  t.after(() => relay.close());
  const sockets = [];
  t.after(() => { for (const ws of sockets) ws.terminate(); });
  const json = { 'Content-Type': 'application/json' };
  const register = async (ip = anywhere()) => (await fetch(origin + '/register', { method: 'POST', headers: { ...json, 'X-Forwarded-For': ip }, body: JSON.stringify({ client_name: 'Plus fixture', redirect_uris: ['http://127.0.0.1/cb'], token_endpoint_auth_method: 'none', grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'] }) })).json();
  const socket = (ip, { key, plus } = {}) => new Promise(resolve => {
    const ws = new WebSocket(origin.replace('http:', 'ws:') + '/connect', { headers: { 'X-Forwarded-For': ip, ...(key ? { 'X-Kitsuvo-Connector-Key': key } : {}), ...(plus ? { 'X-Kitsuvo-Plus': plus } : {}) } });
    const events = new EventEmitter(), connected = once(events, 'connected');
    ws.on('message', data => { const message = JSON.parse(data); events.emit(message.type, message); });
    ws.once('open', () => { sockets.push(ws); resolve({ status: 101, ws, events, connected }); });
    ws.once('unexpected-response', (_request, response) => resolve({ status: response.statusCode }));
  });
  const approvalId = async (client, ip) => {
    const params = new URLSearchParams({ client_id: client.client_id, response_type: 'code', redirect_uri: 'http://127.0.0.1/cb', code_challenge: 'a'.repeat(43), code_challenge_method: 'S256', state: randomBytes(6).toString('hex') });
    return (await (await fetch(origin + '/authorize?' + params, { headers: { 'X-Forwarded-For': ip } })).text()).match(/approve ([A-Za-z0-9_-]{43})/)[1];
  };
  // Opens a connector and approves one fresh client on it: 'approved', 'rejected' or 'refused' (HTTP 429).
  const enroll = async (ip, options) => {
    const opened = await socket(ip, options);
    if (opened.status !== 101) return 'refused';
    // Client registrations and approval pages come from the MCP client's network, not the connector's.
    const id = await approvalId(await register(), anywhere());
    const outcome = Promise.race([once(opened.events, 'approved').then(() => 'approved'), once(opened.events, 'rejected').then(() => 'rejected')]);
    opened.ws.send(JSON.stringify({ type: 'approve', id }));
    return outcome;
  };
  // A real connector (connect.mjs) with a fixture backend, as `npm run connect` uses.
  async function browser(plusCode) {
    const events = new EventEmitter();
    const connection = connectBrowser({ origin, plusCode, backend: { async listTools() { return { tools: [{ name: 'fixture', inputSchema: { type: 'object' } }] }; }, async callTool() { return { content: [] }; } }, onMessage: message => events.emit(message.type, message) });
    sockets.push(connection.socket);
    const status = plusCode ? once(events, 'plus') : undefined;
    await once(events, 'connected');
    return { ...connection, events, status: status && (await status)[0] };
  }
  // Authorizes with PKCE and exchanges the code: one new grant on `browser`.
  async function grant(client, browser) {
    const verifier = randomBytes(32).toString('base64url');
    const params = new URLSearchParams({ client_id: client.client_id, response_type: 'code', redirect_uri: 'http://127.0.0.1/cb', code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256', scope: 'browser', resource: origin + '/mcp' });
    const url = origin + '/authorize?' + params;
    const id = (await (await fetch(url)).text()).match(/approve ([A-Za-z0-9_-]{43})/)[1];
    const approved = once(browser.events, 'approved'); browser.approve(id); await approved;
    const code = new URL((await fetch(url, { redirect: 'manual' })).headers.get('location')).searchParams.get('code');
    const response = await fetch(origin + '/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'authorization_code', client_id: client.client_id, redirect_uri: 'http://127.0.0.1/cb', code, code_verifier: verifier, resource: origin + '/mcp' }) });
    assert.equal(response.status, 200);
    return { client, tokens: await response.json() };
  }
  const refresh = async item => {
    const response = await fetch(origin + '/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'refresh_token', client_id: item.client.client_id, refresh_token: item.tokens.refresh_token, resource: origin + '/mcp' }) });
    if (response.status === 200) item.tokens = await response.json();
    return response.status;
  };
  return { origin, stateFile, register, socket, enroll, browser, grant, refresh, advance: s => { offset += s; } };
}

test('a full free pool turns away free and invalid codes, but never a current Plus connector', { timeout: 60000 }, async t => {
  const f = await fixture(t, { durable: true });
  for (let i = 0; i < limits.temporaryConnectors; i++) assert.equal(await f.enroll(`10.10.${i}.1`), 'approved');
  assert.equal(await f.enroll('10.11.0.1'), 'rejected', 'free behaviour is unchanged');
  for (const [label, plus] of [['expired', expired()], ['forged', forged()], ['wrong product', wrongProduct()]]) {
    assert.equal(await f.enroll('10.11.0.2', { plus }), 'rejected', `${label} codes get free limits`);
  }
  // One subscription may hold only a bounded share of the reserved pool.
  const code = mint();
  for (let i = 0; i < plusLimits.connectorsPerSubscription; i++) assert.equal(await f.enroll(`10.12.${i}.1`, { plus: code }), 'approved');
  assert.equal(await f.enroll('10.13.0.1', { plus: code }), 'rejected');
  assert.equal(await f.enroll('10.13.0.2', { plus: mint({ subscription: 'sub_other' }) }), 'approved');
  // Installed connectors use the reserved pool too.
  assert.equal(await f.enroll('10.13.0.3', { key: randomBytes(32).toString('base64url'), plus: mint({ subscription: 'sub_installed' }) }), 'approved');
});

test('Plus raises per-source connector caps; free and invalid codes keep the free caps', { timeout: 60000 }, async t => {
  const f = await fixture(t, { durable: true });
  for (let i = 0; i < limits.temporaryPerSource; i++) assert.equal(await f.enroll('10.20.0.1'), 'approved');
  assert.equal(await f.enroll('10.20.0.1'), 'rejected');
  assert.equal(await f.enroll('10.20.0.1', { plus: forged() }), 'rejected');
  const code = mint();
  // Plus connectors do not count against the free slots this source already holds.
  for (let i = 0; i < plusLimits.temporaryPerSource; i++) assert.equal(await f.enroll('10.20.0.1', { plus: code }), 'approved');
  assert.equal(await f.enroll('10.20.0.1', { plus: code }), 'rejected');
  const key = () => randomBytes(32).toString('base64url');
  for (let i = 0; i < limits.installedPerSource; i++) assert.equal(await f.enroll('10.21.0.1', { key: key() }), 'approved');
  assert.equal(await f.enroll('10.21.0.1', { key: key() }), 'rejected');
  assert.equal(await f.enroll('10.21.0.1', { key: key(), plus: expired() }), 'rejected');
  const installed = mint({ subscription: 'sub_installed' });
  for (let i = 0; i < plusLimits.installedPerSource; i++) assert.equal(await f.enroll('10.21.0.1', { key: key(), plus: installed }), 'approved');
  assert.equal(await f.enroll('10.21.0.1', { key: key(), plus: installed }), 'rejected');
});

test('Plus browsers hold more grants; on expiry nothing is revoked and each new grant replaces one', { timeout: 60000 }, async t => {
  const f = await fixture(t);
  const browser = await f.browser(mint({ ttl: 3600 }));
  assert.equal(browser.status.active, true);
  const grants = [];
  for (let c = 0; grants.length < plusLimits.grantsPerBrowser; c++) {
    const client = await f.register();
    for (let i = 0; i < limits.grantsPerClient && grants.length < plusLimits.grantsPerBrowser; i++) grants.push(await f.grant(client, browser));
  }
  for (const item of grants) assert.equal(await f.refresh(item), 200);
  // Past the code's expiry (refresh tokens last a day): every grant still refreshes.
  f.advance(3700);
  for (const item of grants) assert.equal(await f.refresh(item), 200);
  // A new grant now follows the free cap gently: only the oldest grant goes.
  const newest = await f.grant(await f.register(), browser);
  assert.deepEqual((await Promise.all(grants.map(f.refresh))).map(status => status === 200), [false, ...Array(plusLimits.grantsPerBrowser - 1).fill(true)]);
  assert.equal(await f.refresh(newest), 200);
});

test('free browsers keep the free grant cap even when a forged or wrong-product code is presented', { timeout: 30000 }, async t => {
  const f = await fixture(t);
  for (const code of [undefined, forged(), wrongProduct()]) {
    const browser = await f.browser(code);
    if (code) assert.equal(browser.status.active, false);
    const grants = [];
    for (let c = 0; c < 3; c++) { const client = await f.register(); for (let i = 0; i < limits.grantsPerClient; i++) grants.push(await f.grant(client, browser)); }
    const statuses = await Promise.all(grants.map(f.refresh));
    assert.equal(statuses.filter(status => status === 200).length, limits.grantsPerBrowser);
  }
});

test('Plus browsers hold more MCP sessions; free browsers still evict at the free cap', { timeout: 60000 }, async t => {
  const f = await fixture(t);
  const headers = token => ({ Authorization: 'Bearer ' + token, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' });
  const init = async token => { const r = await fetch(f.origin + '/mcp', { method: 'POST', headers: headers(token), body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'p', version: '1' } } }) }); await r.text(); return r.headers.get('mcp-session-id'); };
  const alive = async (token, id) => (await fetch(f.origin + '/mcp', { method: 'POST', headers: { ...headers(token), 'Mcp-Session-Id': id, 'Mcp-Protocol-Version': '2025-06-18' }, body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }) })).status;
  for (const [code, cap] of [[undefined, limits.sessionsPerBrowser], [mint(), plusLimits.sessionsPerBrowser], [forged(), limits.sessionsPerBrowser]]) {
    const browser = await f.browser(code), token = (await f.grant(await f.register(), browser)).tokens.access_token;
    const sessions = [];
    for (let i = 0; i < cap; i++) sessions.push(await init(token));
    // Touching the first session makes the second the least recently used.
    assert.equal(await alive(token, sessions[0]), 200, 'within the cap every session stays');
    sessions.push(await init(token));
    assert.equal(await alive(token, sessions[1]), 404, `past the cap of ${cap} the idlest session is evicted`);
    assert.equal(await alive(token, sessions[0]), 200);
    assert.equal(await alive(token, sessions.at(-1)), 200);
  }
});

test('a refreshed code extends Plus on the live connection; a bad refresh changes nothing', { timeout: 20000 }, async t => {
  const f = await fixture(t);
  const browser = await f.browser(mint({ ttl: 60 }));
  assert.equal(browser.status.active, true);
  const later = mint({ ttl: 86400 }), expiry = JSON.parse(Buffer.from(later.split('.')[0], 'base64url')).expires_at;
  let status = once(browser.events, 'plus'); browser.plus(later);
  assert.deepEqual((await status)[0], { type: 'plus', active: true, expiresAt: expiry });
  status = once(browser.events, 'plus'); browser.plus(forged());
  assert.deepEqual((await status)[0], { type: 'plus', active: true, expiresAt: expiry });
  f.advance(86400 + 1);
  status = once(browser.events, 'plus'); browser.plus(expired());
  assert.deepEqual((await status)[0], { type: 'plus', active: false });
});

test('a refreshed code for a full subscription is refused; the connector keeps its own', { timeout: 60000 }, async t => {
  const f = await fixture(t);
  const full = subscription => mint({ subscription, ttl: 86400 });
  for (let i = 0; i < plusLimits.connectorsPerSubscription; i++) assert.equal(await f.enroll(`10.20.${i}.1`, { plus: full('sub_full') }), 'approved');
  const own = mint({ subscription: 'sub_mine', ttl: 600 }), expiry = JSON.parse(Buffer.from(own.split('.')[0], 'base64url')).expires_at;
  const browser = await f.browser(own);
  let status = once(browser.events, 'plus'); browser.plus(full('sub_full'));
  assert.deepEqual((await status)[0], { type: 'plus', active: true, expiresAt: expiry }, 'a shared code cannot exceed its cap by refresh');
  const later = full('sub_mine'), laterExpiry = JSON.parse(Buffer.from(later.split('.')[0], 'base64url')).expires_at;
  status = once(browser.events, 'plus'); browser.plus(later);
  assert.deepEqual((await status)[0], { type: 'plus', active: true, expiresAt: laterExpiry }, 'its own subscription still refreshes');
});

test('a relay without a configured public key gives every connector free limits', { timeout: 20000 }, async t => {
  const f = await fixture(t, { plusKey: '' });
  const browser = await f.browser(mint());
  assert.deepEqual(browser.status, { type: 'plus', active: false });
  for (let i = 0; i < limits.temporaryPerSource; i++) assert.equal(await f.enroll('10.30.0.1', { plus: mint() }), 'approved');
  assert.equal(await f.enroll('10.30.0.1', { plus: mint() }), 'rejected');
});

test('the relay persists neither the activation code nor the subscription hash', { timeout: 20000 }, async t => {
  const f = await fixture(t, { durable: true });
  const code = mint(), subject = createHash('sha256').update('sub_test').digest('hex');
  assert.equal(await f.enroll('10.40.0.1', { key: randomBytes(32).toString('base64url'), plus: code }), 'approved');
  const saved = await readFile(f.stateFile, 'utf8');
  assert.ok(saved.length > 0);
  assert.ok(!saved.includes(subject) && !saved.includes(code.split('.')[1]) && !saved.includes(code.split('.')[0]));
});

test('connectors read the app\'s code, skip expired ones, honour opt-out and resend only changes', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'kitsuvo-plus-source-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'plus-license.txt'), code = mint();
  await writeFile(file, code + '\n');
  assert.equal(await plusSource({ env: {}, file })(), code);
  assert.equal(await plusSource({ env: { KITSUVO_PLUS_LICENSE_FILE: file } })(), code);
  assert.equal(await plusSource({ env: { KITSUVO_PLUS_LICENSE: ` ${code} ` } })(), code);
  assert.equal(plusSource({ env: { KITSUVO_PLUS: 'off' }, file }), undefined);
  assert.equal(await plusSource({ env: {}, file: path.join(directory, 'missing.txt') })(), undefined);
  await writeFile(file, expired());
  assert.equal(await plusSource({ env: {}, file })(), undefined, 'an expired code is never sent');
  await writeFile(file, 'x'.repeat(4096));
  assert.equal(await plusSource({ env: {}, file })(), undefined);
  assert.equal(defaultPlusLicensePath('darwin', {}, '/Users/a'), path.join('/Users/a', 'Library', 'Application Support', 'kitsuvo', 'plus-license.txt'));
  assert.equal(defaultPlusLicensePath('win32', { APPDATA: 'C:\\R' }, 'C:\\U'), path.join('C:\\R', 'kitsuvo', 'plus-license.txt'));
  assert.equal(defaultPlusLicensePath('linux', {}, '/home/a'), path.join('/home/a', '.config', 'kitsuvo', 'plus-license.txt'));
  const sent = []; let current = code;
  const watcher = watchPlus(async () => current, value => sent.push(value), { initial: code });
  t.after(watcher.stop);
  await watcher.check(); assert.deepEqual(sent, []);
  current = mint({ ttl: 3600 }); await watcher.check(); await watcher.check();
  assert.deepEqual(sent, [current]);
});

test('installed connector config accepts only explicit Plus settings', () => {
  const config = { origin: 'https://relay.example', binary: path.resolve('kitsuvo'), profile: path.resolve('p'), node: process.execPath, script: path.resolve('service.mjs'), consent: 'isolated-browser-cloud-access-v1' };
  assert.equal(validateConfig({ ...config, plus: false }).plus, false);
  assert.equal(validateConfig({ ...config, plusLicense: path.resolve('plus-license.txt') }).plusLicense, path.resolve('plus-license.txt'));
  assert.throws(() => validateConfig({ ...config, plus: 'yes' }));
  assert.throws(() => validateConfig({ ...config, plusLicense: 'relative.txt' }));
});

test('connectors never send refreshed codes to an older relay that would close on them', { timeout: 10000 }, async t => {
  const server = new WebSocketServer({ port: 0, host: '127.0.0.1' }), received = [];
  await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  for (const advertised of [false, true]) {
    const accepted = once(server, 'connection');
    const connection = connectBrowser({ origin: `http://127.0.0.1:${server.address().port}`, plusCode: mint(), backend: { async listTools() { return { tools: [] }; } } });
    const [socket, request] = await accepted;
    assert.equal(request.headers['x-kitsuvo-plus'].split('.').length, 2);
    socket.on('message', data => received.push(JSON.parse(data)));
    const connected = once(connection.socket, 'message');
    socket.send(JSON.stringify({ type: 'connected', durable: false, ...(advertised ? { plus: true } : {}) })); await connected;
    connection.plus(mint({ ttl: 60 }));
    connection.revoke();
    await new Promise(resolve => setTimeout(resolve, 50));
    connection.socket.close();
  }
  assert.deepEqual(received.map(message => message.type), ['revoke', 'plus', 'revoke']);
});
