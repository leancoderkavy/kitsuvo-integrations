import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request as httpRequest } from 'node:http';
import { EventEmitter, once } from 'node:events';
import { randomBytes, createHash } from 'node:crypto';
import { createRelay, limits } from '../server.mjs';
import { durableStore } from '../durable-store.mjs';
import { connectBrowser, browserTransportConfig, nativeArguments } from '../connect.mjs';
import { mkdtemp, mkdir, readFile, stat, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js';
import WebSocket from 'ws';

const cardVersion = JSON.parse(await readFile(new URL('../server-card.json', import.meta.url), 'utf8')).serverInfo.version;
const fetch = (url, options = {}) => globalThis.fetch(url, {...options, headers:{...options.headers, Connection:'close'}});
async function offline(f, headers) {
  let status;
  for (let i=0;i<50;i++) { status=(await fetch(f.origin+'/mcp',{headers})).status; if(status===503) return; await new Promise(r=>setTimeout(r,10)); }
  assert.equal(status,503);
}

async function fixture(t, durable = false, { telemetry, trustedProxyHops=0, clock } = {}) {
  const directory = await mkdtemp(path.join(tmpdir(), 'kitsuvo-relay-'));
  t.after(() => rm(directory, {recursive:true,force:true}));
  const stateFile = durable ? path.join(directory, 'state.json') : undefined;
  const reserve = createServer();
  await new Promise(resolve => reserve.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${reserve.address().port}`;
  await new Promise(resolve => reserve.close(resolve));
  let relay = createRelay({ origin, stateFile, telemetry, trustedProxyHops, clock });
  await new Promise(resolve => relay.http.listen(new URL(origin).port, '127.0.0.1', resolve));
  t.after(() => relay.close());
  const post = (path, values) => fetch(origin + path, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(values) });
  async function browser(label, app = false, overrides = {}, connectorKey) {
    const events = new EventEmitter();
    const connection = connectBrowser({ origin, connectorKey, backend: {
      getServerCapabilities() { return app ? { resources: {} } : {}; },
      async listTools() { return { tools: [{ name: 'fixture', description: label, inputSchema: { type: 'object' }, ...(app ? { _meta: { ui: { resourceUri: 'ui://kitsuvo/browser.html' } } } : {}) }] }; },
      async callTool() { return { content: [{ type: 'text', text: label }] }; },
      async listResources() { return { resources: [{ uri: 'ui://kitsuvo/browser.html', name: 'browser', mimeType: 'text/html;profile=mcp-app' }] }; },
      async readResource({ uri }) { return { contents: [{ uri, mimeType: 'text/html;profile=mcp-app', text: `<p>${label}</p>` }] }; },
      ...overrides,
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
  return { get relay() { return relay; }, origin, post, browser, client, authorize, exchange, stateFile,
    async restart() { await relay.close(); relay = createRelay({origin, stateFile, telemetry, trustedProxyHops, clock}); await new Promise(resolve => relay.http.listen(new URL(origin).port, '127.0.0.1', resolve)); }
  };
}

test('invalid WebSocket protocol messages are reported through injected telemetry', async t => {
  const reported = [];
  const f = await fixture(t, false, { telemetry: { captureException(error, context) { reported.push({ error, context }); } } });
  const socket = new WebSocket(f.origin.replace('http:', 'ws:') + '/connect');
  await once(socket, 'open');
  socket.send('{not json');
  await once(socket, 'close');
  assert.equal(reported.length, 1);
  assert.equal(reported[0].context.source, 'websocket-message');
  assert.ok(reported[0].error instanceof Error);
});

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
  // A spent code presented by another client is refused without revoking anything.
  assert.equal((await f.exchange(other, auth)).status, 400);
  const refresh = await f.post('/token', { grant_type: 'refresh_token', client_id: client.client_id, refresh_token: tokens.refresh_token, resource: f.origin + '/mcp' });
  assert.equal(refresh.status, 200); const rotated = await refresh.json();
  assert.notEqual(rotated.refresh_token, tokens.refresh_token);
  assert.equal((await f.post('/token', { grant_type: 'refresh_token', client_id: other.client_id, refresh_token: tokens.refresh_token })).status, 400);
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
    await client.connect(transport); t.after(() => client.close());
    assert.equal(client.getServerVersion().title, 'Kitsuvo');
    assert.equal(client.getServerVersion().version, cardVersion);
    assert.equal(client.getServerVersion().icons[0].mimeType, 'image/png');
    assert.match(client.getServerVersion().icons[0].src, /^data:image\/png;base64,iVBOR/);
    return client;
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
  // Client close fires before the relay necessarily processes the close frame.
  let disconnectedStatus;
  const deadline = Date.now() + 1000;
  do {
    disconnectedStatus = (await fetch(f.origin + '/userinfo', { headers: { Authorization: 'Bearer ' + tokens[0].access_token } })).status;
    if (disconnectedStatus !== 401) await new Promise(resolve => setTimeout(resolve, 10));
  } while (disconnectedStatus !== 401 && Date.now() < deadline);
  assert.equal(disconnectedStatus, 401);
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
  assert.deepEqual(browserTransportConfig({}, false).args, ['mcp', '--separate-profile']);
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

 test('public directory card exposes schemas, never browser state or authorization', async t => {
  const { origin } = await fixture(t);
  {
    const response = await fetch(origin + '/.well-known/mcp/server-card.json');
    assert.equal(response.status, 200);
    const card=await response.json();
    assert.equal(card.authentication.required, true);
    assert.deepEqual(card.authentication.schemes, ['oauth2']);
    assert.ok(card.tools.some(tool => tool.name === 'browser_snapshot'));
    assert.ok(card.tools.some(tool => tool.name === 'browser_run_script' && tool.annotations.readOnlyHint === false));
    assert.ok(card.tools.every(tool => typeof tool.name === 'string' && tool.inputSchema.type === 'object'));
    assert.deepEqual(Object.keys(card).sort(), ['authentication','serverInfo','tools']);
  }
  // server-card.json is the single version source for every relay surface.
  const health = await (await fetch(origin + '/health')).json();
  assert.equal(health.version, cardVersion);
  assert.equal(JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')).version, cardVersion);
 });

 test('Glama ownership proof is public metadata and absent without deployment configuration', async t => {
  const f = await fixture(t);
  const previous = process.env.KITSUVO_GLAMA_CLAIM;
  t.after(() => { if (previous === undefined) delete process.env.KITSUVO_GLAMA_CLAIM; else process.env.KITSUVO_GLAMA_CLAIM = previous; });
  delete process.env.KITSUVO_GLAMA_CLAIM;
  assert.equal((await fetch(f.origin + '/.well-known/glama.json')).status, 404);
  process.env.KITSUVO_GLAMA_CLAIM = 'glama_claim_publicOwnershipTest';
  const response = await fetch(f.origin + '/.well-known/glama.json');
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { $schema: 'https://glama.ai/mcp/schemas/connector.json', claim: 'glama_claim_publicOwnershipTest' });
 });


test('headless selection reaches both native and MCP App transports', () => {
  const env = { KITSUVO_HEADLESS: '1', KITSUVO_BINARY: '/fixture/kitsuvo' };
  const native = browserTransportConfig(env);
  assert.deepEqual(native.args, ['mcp', '--separate-profile', '--headless']);
  assert.equal(native.env.KITSUVO_HEADLESS, '1');
  const app = browserTransportConfig(env, true);
  assert.ok(app.args.includes('--stdio'));
  assert.equal(app.env.KITSUVO_HEADLESS, '1');
  assert.deepEqual(browserTransportConfig({}).args, ['mcp', '--separate-profile']);
});

test('the terminal connector requests the isolated profile it discloses, like the HTTP bridge', () => {
  // `kitsuvo mcp` alone uses the normal signed-in profile; cloud access promises isolation.
  const current = 'Usage:\n  kitsuvo mcp [--separate-profile] [--headless]\n';
  assert.deepEqual(browserTransportConfig({}, false, current).args, ['mcp', '--separate-profile']);
  assert.deepEqual(nativeArguments(current, true), ['mcp', '--separate-profile', '--headless']);
  // Older builds isolated MCP by default and reject the later flag.
  const legacy = 'Usage:\n  --agent    Start agent mode with a separate profile\n  --headless\n';
  assert.deepEqual(browserTransportConfig({}, false, legacy).args, ['mcp']);
  assert.throws(() => nativeArguments('  --agent  separate profile\n', true), /headless/);
});

test('relay cancellation reaches the backend and cancelled queued tools never run; catalogue is cached', {timeout:10000},async t=>{
  const f=await fixture(t), effects=[];
  let release, started, activeStarted, activeAborted, catalogues=0;
  const gate=new Promise(r=>release=r), began=new Promise(r=>started=r);
  const activeBegan=new Promise(r=>activeStarted=r), abortedBackend=new Promise(r=>activeAborted=r);
  const browser=await f.browser('cancel-fixture',false,{
    async listTools(){catalogues++;return {tools:[{name:'fixture',inputSchema:{type:'object',properties:{id:{type:'integer'}}}}]};},
    async callTool(params,_,options){
      const id=params.arguments.id;effects.push(id);
      if(id===0){started();await gate;}
      if(id===3){activeStarted();await new Promise((_,reject)=>options.signal.addEventListener('abort',()=>{activeAborted();reject(options.signal.reason);},{once:true}));}
      return {content:[{type:'text',text:String(id)}]};
    },
  });
  const registration=await f.client(), auth=await f.authorize(registration,browser);
  const token=await (await f.exchange(registration,auth)).json();
  const c=new Client({name:'cancellation-fixture',version:'1'});t.after(()=>c.close());
  await c.connect(new StreamableHTTPClientTransport(new URL(f.origin+'/mcp'),{requestInit:{headers:{Authorization:'Bearer '+token.access_token}}}));
  const first=c.callTool({name:'fixture',arguments:{id:0}});await began;
  const queuedController=new AbortController();
  const queued=c.callTool({name:'fixture',arguments:{id:1}},undefined,{signal:queuedController.signal});
  const rejected=assert.rejects(queued);await new Promise(r=>setTimeout(r,30));queuedController.abort();await rejected;
  await new Promise(r=>setTimeout(r,30));release();await first;
  await c.callTool({name:'fixture',arguments:{id:2}});assert.deepEqual(effects,[0,2]);
  const activeController=new AbortController();
  const active=c.callTool({name:'fixture',arguments:{id:3}},undefined,{signal:activeController.signal});
  const activeRejected=assert.rejects(active);await activeBegan;activeController.abort();await activeRejected;await abortedBackend;
  await c.callTool({name:'fixture',arguments:{id:4}});
  assert.deepEqual(effects,[0,2,3,4]);assert.equal(catalogues,1);
});


test('approved durable connector survives offline refresh, socket and relay restart without new authorization', {timeout:20000}, async t => {
  const f = await fixture(t, true), key = randomBytes(32).toString('base64url');
  let browser = await f.browser('original', true, {}, key);
  const registration = await f.client(), auth = await f.authorize(registration, browser);
  const token = await (await f.exchange(registration, auth)).json();
  const headers = { Authorization: 'Bearer ' + token.access_token };
  const subject = (await (await fetch(f.origin+'/userinfo', {headers})).json()).sub;
  const sdk = new Client({name:'restart-fixture',version:'1'}); t.after(() => sdk.close());
  await sdk.connect(new StreamableHTTPClientTransport(new URL(f.origin+'/mcp'),{requestInit:{headers}}));
  assert.equal((await sdk.callTool({name:'fixture',arguments:{}})).content[0].text, 'original');
  const closed = once(browser.socket, 'close'); browser.socket.close(); await closed;
  assert.equal((await fetch(f.origin+'/userinfo',{headers})).status,200);
  await offline(f,headers);
  browser = await f.browser('same-session-resumed',true,{},key);
  assert.equal((await sdk.callTool({name:'fixture',arguments:{}})).content[0].text,'same-session-resumed');
  const disconnectedAgain = once(browser.socket,'close'); browser.socket.close(); await disconnectedAgain;
  await offline(f,headers);
  const refresh = await f.post('/token',{grant_type:'refresh_token',client_id:registration.client_id,refresh_token:token.refresh_token});
  assert.equal(refresh.status,200); const rotated = await refresh.json();
  browser = await f.browser('resumed', true, {}, key);
  // Existing MCP session resolves the resumed socket, not a stale closure.
  const freshSdk = new Client({name:'resumed-fixture',version:'1'}); t.after(() => freshSdk.close());
  await freshSdk.connect(new StreamableHTTPClientTransport(new URL(f.origin+'/mcp'),{requestInit:{headers:{Authorization:'Bearer '+rotated.access_token}}}));
  assert.equal((await freshSdk.callTool({name:'fixture',arguments:{}})).content[0].text,'resumed');
  const second = randomBytes(32).toString('base64url');
  const foreign = await f.browser('other-identity', true, {}, second);
  assert.notEqual((await (await fetch(f.origin+'/userinfo',{headers:{Authorization:'Bearer '+rotated.access_token}})).json()).sub, undefined);
  const persisted = await readFile(f.stateFile,'utf8');
  for (const secret of [key,second,token.access_token,token.refresh_token,rotated.access_token,rotated.refresh_token]) assert.ok(!persisted.includes(secret));
  assert.equal((await stat(f.stateFile)).mode & 0o777, 0o600);
  await f.restart();
  const restoredHeaders = {Authorization:'Bearer '+rotated.access_token};
  assert.equal((await fetch(f.origin+'/userinfo',{headers:restoredHeaders})).status,200);
  assert.equal((await fetch(f.origin+'/mcp',{headers:restoredHeaders})).status,503);
  browser = await f.browser('after-relay-restart',true,{},key);
  assert.equal((await (await fetch(f.origin+'/userinfo',{headers:restoredHeaders})).json()).sub,subject);
  const restoredSdk = new Client({name:'restored-fixture',version:'1'}); t.after(() => restoredSdk.close());
  await restoredSdk.connect(new StreamableHTTPClientTransport(new URL(f.origin+'/mcp'),{requestInit:{headers:restoredHeaders}}));
  assert.equal((await restoredSdk.callTool({name:'fixture',arguments:{}})).content[0].text,'after-relay-restart');
  assert.equal((await f.post('/token',{grant_type:'refresh_token',client_id:registration.client_id,refresh_token:token.refresh_token})).status,400);
  const revoked = once(browser.events,'revoked'); browser.revoke(); await revoked;
  await f.restart();
  browser = await f.browser('revoked-connector',true,{},key);
  assert.equal((await fetch(f.origin+'/userinfo',{headers:restoredHeaders})).status,401);
  assert.equal((await f.post('/token',{grant_type:'refresh_token',client_id:registration.client_id,refresh_token:rotated.refresh_token})).status,400);
});

test('durable identity cannot replace an active connector; corrupt persisted grants fail closed', {timeout:10000}, async t => {
  const f = await fixture(t,true), key = randomBytes(32).toString('base64url');
  const browser = await f.browser('owner',false,{},key);
  const duplicate = connectBrowser({origin:f.origin,connectorKey:key,backend:{}});
  assert.match((await once(duplicate.socket,'error'))[0].message,/409/);
  const registration = await f.client(), auth = await f.authorize(registration,browser);
  const token = await (await f.exchange(registration,auth)).json();
  const other = await f.browser('wrong-key',false,{},randomBytes(32).toString('base64url'));
  const closed = once(browser.socket,'close'); browser.socket.close(); await closed;
  await offline(f,{Authorization:'Bearer '+token.access_token});
  await writeFile(f.stateFile,'{"version":1,"origin":"foreign"}');
  assert.throws(() => createRelay({origin:f.origin,stateFile:f.stateFile}),/Invalid relay/);
});


test('durable grants refresh after a month offline and expire after 90 days of inactivity', {timeout:10000}, async t => {
  const f=await fixture(t,true), key=randomBytes(32).toString('base64url');
  const browser=await f.browser('long-offline',false,{},key), registration=await f.client();
  const auth=await f.authorize(registration,browser), token=await (await f.exchange(registration,auth)).json();
  const closed=once(browser.socket,'close'); browser.socket.close(); await closed;
  await offline(f,{Authorization:'Bearer '+token.access_token});
  const original=Date.now, start=original(); t.after(()=>{Date.now=original;});
  Date.now=()=>start+31*86400000;
  await f.restart();
  assert.equal((await fetch(f.origin+'/userinfo',{headers:{Authorization:'Bearer '+token.access_token}})).status,401);
  const refreshed=await f.post('/token',{grant_type:'refresh_token',client_id:registration.client_id,refresh_token:token.refresh_token});
  assert.equal(refreshed.status,200); const rotated=await refreshed.json();
  Date.now=()=>start+122*86400000;
  await f.restart();
  assert.equal((await f.post('/token',{grant_type:'refresh_token',client_id:registration.client_id,refresh_token:rotated.refresh_token})).status,400);
});

test('connector revocation works offline, is identity-scoped and persists across restart', {timeout:10000}, async t => {
  const f=await fixture(t,true), keys=[randomBytes(32).toString('base64url'),randomBytes(32).toString('base64url')];
  const browsers=await Promise.all(keys.map((key,i)=>f.browser('owner-'+i,false,{},key)));
  const clients=await Promise.all([f.client(),f.client()]);
  const tokens=[];
  for(let i=0;i<2;i++) tokens.push(await (await f.exchange(clients[i],await f.authorize(clients[i],browsers[i]))).json());
  const closed=once(browsers[0].socket,'close'); browsers[0].socket.close(); await closed;
  assert.equal((await fetch(f.origin+'/connector/revoke',{method:'POST'})).status,403);
  assert.equal((await fetch(f.origin+'/connector/revoke',{method:'POST',headers:{'X-Kitsuvo-Connector-Key':randomBytes(32).toString('base64url')}})).status,404);
  assert.equal((await fetch(f.origin+'/connector/revoke',{method:'POST',headers:{'X-Kitsuvo-Connector-Key':keys[0]}})).status,200);
  await f.restart();
  assert.equal((await fetch(f.origin+'/userinfo',{headers:{Authorization:'Bearer '+tokens[0].access_token}})).status,401);
  assert.equal((await fetch(f.origin+'/userinfo',{headers:{Authorization:'Bearer '+tokens[1].access_token}})).status,200);
});

test('persistence failure denies authorization rather than silently losing revocation', {timeout:10000}, async t => {
  const f=await fixture(t,true), key=randomBytes(32).toString('base64url');
  const browser=await f.browser('storage-failure',false,{},key), registration=await f.client();
  const token=await (await f.exchange(registration,await f.authorize(registration,browser))).json();
  const directory=path.dirname(f.stateFile); await rm(directory,{recursive:true,force:true}); await writeFile(directory,'blocked');
  assert.equal((await fetch(f.origin+'/connector/revoke',{method:'POST',headers:{'X-Kitsuvo-Connector-Key':key}})).status,503);
  assert.equal((await fetch(f.origin+'/userinfo',{headers:{Authorization:'Bearer '+token.access_token}})).status,401);
  assert.throws(()=>createRelay({origin:f.origin,stateFile:f.stateFile}),/Invalid relay authorization store/);
});

test('failed upgrades and unapproved connectors reserve no durable identity records',async t=>{
 const f=await fixture(t,true);
 for(let i=0;i<3;i++){
  const status=await new Promise((resolve,reject)=>{
   const request=httpRequest(f.origin+'/connect',{headers:{Connection:'Upgrade',Upgrade:'websocket','Sec-WebSocket-Version':'13','Sec-WebSocket-Key':'invalid','X-Kitsuvo-Connector-Key':randomBytes(32).toString('base64url')}},response=>{response.resume();resolve(response.statusCode);});request.on('error',reject);request.end();
  });assert.equal(status,400);
 }
 assert.equal(JSON.parse(await readFile(f.stateFile,'utf8')).identities.length,0);
 const browser=await f.browser('pending',false,{},randomBytes(32).toString('base64url'));
 assert.equal(JSON.parse(await readFile(f.stateFile,'utf8')).identities.length,0);
 const client=await f.client(),auth=await f.authorize(client,browser);assert.equal((await f.exchange(client,auth)).status,200);
 assert.equal(JSON.parse(await readFile(f.stateFile,'utf8')).identities.length,1);
});

test('an approved connector can reconnect after anonymous enrollment exhausts its source budget',async t=>{
 const f=await fixture(t,true),key=randomBytes(32).toString('base64url'),browser=await f.browser('approved',false,{},key),client=await f.client();
 const auth=await f.authorize(client,browser);assert.equal((await f.exchange(client,auth)).status,200);
 const closed=once(browser.socket,'close');browser.socket.close();await closed;
 for(let i=0;i<21;i++)await new Promise((resolve,reject)=>{
  const request=httpRequest(f.origin+'/connect',{headers:{Connection:'Upgrade',Upgrade:'websocket','Sec-WebSocket-Version':'13','Sec-WebSocket-Key':'invalid'}},response=>{response.resume();resolve(response.statusCode);});request.on('error',reject);request.end();
 });
 const restored=await f.browser('restored',false,{},key);assert.equal(restored.socket.readyState,WebSocket.OPEN);
});

test('anonymous bucket capacity cannot exclude an approved reconnect from a fresh address',async t=>{
 const f=await fixture(t,true,{trustedProxyHops:1}),key=randomBytes(32).toString('base64url'),browser=await f.browser('approved',false,{},key),client=await f.client();
 assert.equal((await f.exchange(client,await f.authorize(client,browser))).status,200);
 const closed=once(browser.socket,'close');browser.socket.close();await closed;
 for(let i=0;i<500;i++)await new Promise((resolve,reject)=>{
  const request=httpRequest(f.origin+'/connect',{headers:{Connection:'Upgrade',Upgrade:'websocket','Sec-WebSocket-Version':'13','Sec-WebSocket-Key':'invalid','X-Forwarded-For':`198.18.${Math.floor(i/250)}.${i%250+1}`}},response=>{response.resume();resolve();});request.on('error',reject);request.end();
 });
 const restored=await f.browser('restored',false,{},key);assert.equal(restored.socket.readyState,WebSocket.OPEN);
});

test('restart removes legacy orphan identities while retaining approved grants',async t=>{
 const f=await fixture(t,true),key=randomBytes(32).toString('base64url'),browser=await f.browser('approved',false,{},key),client=await f.client();
 const token=await (await f.exchange(client,await f.authorize(client,browser))).json();
 const state=JSON.parse(await readFile(f.stateFile,'utf8'));state.identities.push(['f'.repeat(64),{browserId:randomBytes(32).toString('base64url'),expiresAt:Math.floor(Date.now()/1000)+86400}]);
 await writeFile(f.stateFile,JSON.stringify(state));await f.restart();
 const clean=JSON.parse(await readFile(f.stateFile,'utf8'));assert.equal(clean.identities.length,1);
 assert.equal((await fetch(f.origin+'/userinfo',{headers:{Authorization:'Bearer '+token.access_token}})).status,200);
});

test('authorization without a scope parameter defaults to browser scope', async t => {
  const f = await fixture(t);
  const client = await f.client();
  const params = new URLSearchParams({ client_id: client.client_id, response_type: 'code', redirect_uri: client.redirect_uris[0], code_challenge: 'a'.repeat(43), code_challenge_method: 'S256', resource: f.origin + '/mcp' });
  const page = await fetch(f.origin + '/authorize?' + params, { redirect: 'manual' });
  assert.equal(page.status, 200);
  assert.match(await page.text(), /approve [A-Za-z0-9_-]{43}/);
  const wrong = await fetch(f.origin + '/authorize?' + params + '&scope=admin', { redirect: 'manual' });
  assert.equal(new URL(wrong.headers.get('location')).searchParams.get('error'), 'invalid_scope');
});

test('malformed JSON bodies return a short 400 instead of a server error', async t => {
  const reported = [];
  const f = await fixture(t, false, { telemetry: { captureException(error) { reported.push(error); } } });
  const response = await fetch(f.origin + '/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{bad' });
  assert.equal(response.status, 400);
  const body = await response.text();
  assert.doesNotMatch(body, /<html|at \w+ \(|node_modules/i);
  assert.equal(JSON.parse(body).error, 'invalid_request');
  assert.equal(reported.length, 0);
});

test('confidential client secret expiry matches the registration lifetime', async t => {
  const f = await fixture(t);
  const response = await fetch(f.origin + '/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ client_name: 'Confidential', redirect_uris: ['https://example.com/callback'] }) });
  assert.equal(response.status, 201);
  const client = await response.json();
  assert.ok(client.client_secret);
  assert.equal(client.client_secret_expires_at - client.client_id_issued_at, 86400);
});

// Abuse helpers: every request can claim a forwarded source (trustedProxyHops: 1).
function sourced(f) {
  const json = { 'Content-Type': 'application/json' };
  const register = async ip => {
    const response = await fetch(f.origin + '/register', { method: 'POST', headers: { ...json, 'X-Forwarded-For': ip }, body: JSON.stringify({ client_name: 'Abuse', redirect_uris: ['http://127.0.0.1/cb'], token_endpoint_auth_method: 'none' }) });
    return { status: response.status, client: response.status === 201 ? await response.json() : undefined };
  };
  const authorize = async (client, ip, state = randomBytes(6).toString('hex')) => {
    const params = new URLSearchParams({ client_id: client.client_id, response_type: 'code', redirect_uri: 'http://127.0.0.1/cb', code_challenge: 'a'.repeat(43), code_challenge_method: 'S256', state });
    const response = await fetch(f.origin + '/authorize?' + params, { headers: { 'X-Forwarded-For': ip }, redirect: 'manual' });
    const text = await response.text();
    return { status: response.status, location: response.headers.get('location'), id: text.match(/approve ([A-Za-z0-9_-]{43})/)?.[1] };
  };
  const socket = (ip, key) => new Promise(resolve => {
    const ws = new WebSocket(f.origin.replace('http:', 'ws:') + '/connect', { headers: { 'X-Forwarded-For': ip, ...(key ? { 'X-Kitsuvo-Connector-Key': key } : {}) } });
    const events = new EventEmitter(), connected = once(events, 'connected');
    ws.on('message', data => { const message = JSON.parse(data); events.emit(message.type, message); });
    ws.once('open', () => resolve({ status: 101, ws, events, connected }));
    ws.once('unexpected-response', (_request, response) => resolve({ status: response.statusCode }));
  });
  // Opens a connector and approves one fresh client on it; resolves 'approved' or 'rejected'.
  const enroll = async (ip, key) => {
    const opened = await socket(ip, key);
    if (opened.status !== 101) return { ...opened, outcome: 'refused' };
    const { client } = await register(ip), { id } = await authorize(client, ip);
    const outcome = Promise.race([once(opened.events, 'approved').then(() => 'approved'), once(opened.events, 'rejected').then(() => 'rejected')]);
    opened.ws.send(JSON.stringify({ type: 'approve', id }));
    return { ...opened, outcome: await outcome };
  };
  return { register, authorize, socket, enroll };
}

test('anonymous self-approvals cannot exhaust capacity for installed connectors', { timeout: 30000 }, async t => {
  const f = await fixture(t, true, { trustedProxyHops: 1 }), abuse = sourced(f), key = randomBytes(32).toString('base64url');
  const installed = await abuse.enroll('10.0.0.1', key);
  assert.equal(installed.outcome, 'approved');
  const closed = once(installed.ws, 'close'); installed.ws.close(); await closed;
  const held = [];
  t.after(() => { for (const item of held) item.ws?.terminate(); });
  // One source holds at most a few temporary slots.
  for (let i = 0; i < limits.temporaryPerSource; i++) { const item = await abuse.enroll('10.1.0.1'); held.push(item); assert.equal(item.outcome, 'approved'); }
  const extra = await abuse.enroll('10.1.0.1'); held.push(extra); assert.equal(extra.outcome, 'rejected');
  extra.ws.terminate();
  // Many sources together can fill only the temporary budget.
  for (let i = 0; held.filter(item => item.outcome === 'approved').length < limits.temporaryConnectors; i++) {
    const item = await abuse.enroll(`10.2.${i}.1`); held.push(item); assert.equal(item.outcome, 'approved');
  }
  const overflow = await abuse.enroll('10.3.0.1'); held.push(overflow); assert.equal(overflow.outcome, 'rejected');
  overflow.ws.terminate();
  const back = await abuse.socket('10.0.0.1', key); held.push(back);
  assert.equal(back.status, 101);
  assert.equal((await back.connected)[0].durable, true);
});

test('installed connectors are capped per source, at reconnect and at approval', { timeout: 30000 }, async t => {
  const f = await fixture(t, true, { trustedProxyHops: 1 }), abuse = sourced(f), held = [];
  t.after(() => { for (const item of held) item.ws?.terminate(); });
  for (let i = 0; i < limits.installedPerSource; i++) {
    const item = await abuse.enroll('10.4.0.1', randomBytes(32).toString('base64url')); held.push(item); assert.equal(item.outcome, 'approved');
  }
  const extra = await abuse.enroll('10.4.0.1', randomBytes(32).toString('base64url')); held.push(extra);
  assert.equal(extra.outcome, 'rejected');
  assert.equal((await abuse.enroll('10.4.0.2', randomBytes(32).toString('base64url'))).outcome, 'approved');
});

test('pending connectors are capped per source and globally larger', { timeout: 10000 }, async t => {
  const f = await fixture(t, true, { trustedProxyHops: 1 }), abuse = sourced(f), held = [];
  t.after(() => { for (const item of held) item.ws?.terminate(); });
  for (let i = 0; i < limits.pendingPerSource; i++) { const item = await abuse.socket('10.5.0.1'); held.push(item); assert.equal(item.status, 101); }
  assert.equal((await abuse.socket('10.5.0.1')).status, 429);
  assert.equal((await abuse.socket('10.5.0.1', randomBytes(32).toString('base64url'))).status, 429);
  const other = await abuse.socket('10.5.0.2'); held.push(other); assert.equal(other.status, 101);
  assert.ok(limits.pendingConnectors > 20);
});

test('unapproved sockets may only send small messages; approval raises the limit', { timeout: 10000 }, async t => {
  const f = await fixture(t, false, { trustedProxyHops: 1 }), abuse = sourced(f);
  const pending = await abuse.socket('10.6.0.1');
  const closed = once(pending.ws, 'close');
  pending.ws.send(JSON.stringify({ type: 'review', id: 'x'.repeat(limits.pendingMessageBytes) }));
  assert.equal((await closed)[0], 1009);
  const approved = await abuse.enroll('10.6.0.2'); t.after(() => approved.ws.terminate());
  assert.equal(approved.outcome, 'approved');
  approved.ws.send(JSON.stringify({ type: 'result', id: 'unknown', result: { padding: 'x'.repeat(limits.pendingMessageBytes * 4) } }));
  approved.ws.send(JSON.stringify({ type: 'review', id: 'missing' }));
  await once(approved.events, 'rejected');
  assert.equal(approved.ws.readyState, WebSocket.OPEN);
});

test('one source cannot fill the client registry or pending approval requests', { timeout: 10000 }, async t => {
  const f = await fixture(t, false, { trustedProxyHops: 1 }), abuse = sourced(f), clients = [];
  for (let i = 0; i < limits.unapprovedClientsPerSource; i++) { const item = await abuse.register('10.7.0.1'); assert.equal(item.status, 201); clients.push(item.client); }
  const refused = await abuse.register('10.7.0.1');
  assert.equal(refused.status, 429);
  assert.equal((await abuse.register('10.7.0.2')).status, 201);
  for (let i = 0; i < limits.pendingRequestsPerSource; i++) assert.ok((await abuse.authorize(clients[i % clients.length], '10.7.0.3', 's' + i)).id);
  const blocked = await abuse.authorize(clients[0], '10.7.0.3', 'overflow');
  assert.equal(new URL(blocked.location).searchParams.get('error'), 'temporarily_unavailable');
  assert.ok((await abuse.authorize(clients[0], '10.7.0.4', 'other')).id);
});

test('grant caps evict a browser or client\'s own oldest grants instead of exhausting the store', { timeout: 30000 }, async t => {
  const f = await fixture(t), browser = await f.browser('greedy');
  const userinfo = token => fetch(f.origin + '/userinfo', { headers: { Authorization: 'Bearer ' + token } }).then(response => response.status);
  const mint = async client => (await f.exchange(client, await f.authorize(client, browser))).json();
  const single = await f.client(), grants = [];
  for (let i = 0; i < limits.grantsPerClient + 2; i++) grants.push(await mint(single));
  assert.deepEqual(await Promise.all(grants.map(grant => userinfo(grant.access_token))), [401, 401, 200, 200, 200, 200]);
  const all = [...grants.slice(2)];
  for (let i = 0; i < 2; i++) { const client = await f.client(); for (let j = 0; j < limits.grantsPerClient; j++) all.push(await mint(client)); }
  const statuses = await Promise.all(all.map(grant => userinfo(grant.access_token)));
  assert.equal(statuses.filter(status => status === 200).length, limits.grantsPerBrowser);
  assert.deepEqual(statuses.slice(-limits.grantsPerBrowser), Array(limits.grantsPerBrowser).fill(200));
  const other = await f.browser('other'), client = await f.client();
  assert.equal((await f.exchange(client, await f.authorize(client, other))).status, 200);
});

test('refreshing a grant at the per-client or per-browser cap keeps every other grant', { timeout: 30000 }, async t => {
  const f = await fixture(t), browser = await f.browser('full');
  const userinfo = token => fetch(f.origin + '/userinfo', { headers: { Authorization: 'Bearer ' + token } }).then(response => response.status);
  const mint = async client => (await f.exchange(client, await f.authorize(client, browser))).json();
  const refresh = async (client, grant) => (await f.post('/token', { grant_type: 'refresh_token', client_id: client.client_id, refresh_token: grant.refresh_token, resource: f.origin + '/mcp' })).json();
  const clients = [await f.client(), await f.client()], grants = [];
  for (const client of clients) for (let i = 0; i < limits.grantsPerClient; i++) grants.push({ client, tokens: await mint(client) });
  assert.equal(grants.length, limits.grantsPerBrowser);
  // Rotation renews an existing family; it must not count as a new grant.
  for (let round = 0; round < 2; round++) for (const grant of grants) grant.tokens = await refresh(grant.client, grant.tokens);
  assert.deepEqual(await Promise.all(grants.map(grant => userinfo(grant.tokens.access_token))), Array(limits.grantsPerBrowser).fill(200));
});

test('authorization code and refresh token replay revoke the grant family', { timeout: 20000 }, async t => {
  const f = await fixture(t), browser = await f.browser('replay'), client = await f.client();
  const userinfo = token => fetch(f.origin + '/userinfo', { headers: { Authorization: 'Bearer ' + token } }).then(response => response.status);
  const refresh = token => f.post('/token', { grant_type: 'refresh_token', client_id: client.client_id, refresh_token: token, resource: f.origin + '/mcp' });
  const auth = await f.authorize(client, browser);
  const first = await (await f.exchange(client, auth)).json();
  const rotated = await (await refresh(first.refresh_token)).json();
  const unrelated = await (await f.exchange(client, await f.authorize(client, browser))).json();
  assert.equal(await userinfo(rotated.access_token), 200);
  const replay = await f.exchange(client, auth);
  assert.equal(replay.status, 400);
  assert.equal(await userinfo(rotated.access_token), 401);
  assert.equal((await refresh(rotated.refresh_token)).status, 400);
  assert.equal(await userinfo(unrelated.access_token), 200);
  // A rotated refresh token presented again revokes its newest successor.
  const next = await (await refresh(unrelated.refresh_token)).json();
  assert.equal(await userinfo(next.access_token), 200);
  assert.equal((await refresh(unrelated.refresh_token)).status, 400);
  assert.equal(await userinfo(next.access_token), 401);
  assert.equal((await refresh(next.refresh_token)).status, 400);
});

test('invalid tools/call params are -32602 and local refusals are isError tool results', { timeout: 10000 }, async t => {
  const f = await fixture(t), browser = await f.browser('tools', false, { async callTool() { throw new Error('refused'); } }), client = await f.client();
  const token = await (await f.exchange(client, await f.authorize(client, browser))).json();
  const sdk = new Client({ name: 'tool-errors', version: '1' }); t.after(() => sdk.close());
  await sdk.connect(new StreamableHTTPClientTransport(new URL(f.origin + '/mcp'), { requestInit: { headers: { Authorization: 'Bearer ' + token.access_token } } }));
  for (const params of [{ name: 5 }, {}, { name: 'fixture', arguments: 'nope' }]) {
    await assert.rejects(sdk.request({ method: 'tools/call', params }, CallToolResultSchema), error => error.code === -32602);
  }
  const result = await sdk.callTool({ name: 'nope', arguments: {} });
  assert.equal(result.isError, true);
  assert.equal(result.content[0].text, 'Browser request failed.');
});

test('a failed state write recovers on the next successful write', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'kitsuvo-store-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const parent = path.join(directory, 'state'), file = path.join(parent, 'state.json');
  const errors = []; t.mock.method(console, 'error', line => errors.push(line));
  t.mock.timers.enable({ apis: ['Date'], now: Date.now() });
  const store = durableStore(file, 'https://relay.example');
  await rm(parent, { recursive: true }); await writeFile(parent, 'blocked');
  await assert.rejects(store.save(), /unavailable/);
  assert.throws(() => store.check(), /unavailable/);
  // Node may emit its experimental MockTimers warning through console.error.
  // Require the store event without assuming it is the first captured log line.
  assert.match(errors.join('\n'), /"event":"state_write_failed"/);
  await rm(parent); await mkdir(parent);
  assert.throws(() => store.check(), /unavailable/, 'retries are throttled');
  t.mock.timers.tick(5000);
  // The retry runs in the background; authorization stays closed until it lands.
  assert.throws(() => store.check(), /unavailable/);
  await store.persist();
  store.check();
  await store.save();
  assert.match(errors.join('\n'), /"event":"state_write_recovered"/);
  assert.equal(JSON.parse(await readFile(file, 'utf8')).version, 1);
});

test('persist skips an unchanged authorization document; save and changes still write', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'kitsuvo-store-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'state.json');
  const store = durableStore(file, 'https://relay.example');
  const inode = async () => (await stat(file)).ino;
  const first = await inode();
  // Temporary connectors' grants are not part of the stored document.
  store.tokens.set('a'.repeat(64), { clientId: 'c'.repeat(43), browserId: 'b'.repeat(43), grantId: 'g'.repeat(43), kind: 'access', expiresAt: Math.floor(Date.now() / 1000) + 600 });
  await store.persist();
  assert.equal(await inode(), first, 'no rewrite for an identical document');
  store.identities.set('d'.repeat(64), { browserId: 'b'.repeat(43), expiresAt: Math.floor(Date.now() / 1000) + 600 });
  await store.persist();
  const second = await inode();
  assert.notEqual(second, first);
  assert.equal(JSON.parse(await readFile(file, 'utf8')).tokens.length, 1);
  await store.save();
  assert.notEqual(await inode(), second, 'save() always writes');
});

test('client registrations are size-capped so a full registry still restarts', { timeout: 30000 }, async t => {
  const f = await fixture(t, true);
  const register = metadata => fetch(f.origin + '/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ client_name: 'x', redirect_uris: ['http://127.0.0.1/cb'], token_endpoint_auth_method: 'none', ...metadata }) });
  const large = await register({ software_statement: 'a'.repeat(limits.clientMetadataBytes) });
  assert.equal(large.status, 400);
  assert.equal((await large.json()).error, 'invalid_client_metadata');
  assert.equal((await register({ software_statement: 'a'.repeat(limits.clientMetadataBytes - 512) })).status, 201);
  // Worst case: every slot holds a maximal registration, plus the durable token store.
  assert.ok(500 * limits.clientMetadataBytes + limits.tokenRecords * 300 < 4 * 1024 * 1024);
  await f.restart();
  assert.equal((await register({})).status, 201);
});

test('one browser cannot exhaust global MCP session capacity; it evicts its own oldest', { timeout: 60000 }, async t => {
  const f = await fixture(t);
  const a = await f.browser('a'), b = await f.browser('b');
  const ca = await f.client(), cb = await f.client();
  const ta = await (await f.exchange(ca, await f.authorize(ca, a))).json();
  const tb = await (await f.exchange(cb, await f.authorize(cb, b))).json();
  const headers = token => ({ Authorization: 'Bearer ' + token, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' });
  const init = async token => { const r = await fetch(f.origin + '/mcp', { method: 'POST', headers: headers(token), body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'p', version: '1' } } }) }); await r.text(); return r; };
  const list = (token, id) => fetch(f.origin + '/mcp', { method: 'POST', headers: { ...headers(token), 'Mcp-Session-Id': id, 'Mcp-Protocol-Version': '2025-06-18' }, body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }) });
  const victim = (await init(tb.access_token)).headers.get('mcp-session-id');
  // Parallel initializations cannot overshoot the per-browser reservation either.
  const burst = await Promise.all(Array.from({ length: limits.sessionsPerBrowser + 8 }, () => init(ta.access_token)));
  assert.ok(burst.filter(r => r.status === 200).length >= limits.sessionsPerBrowser);
  const first = [];
  for (let i = 0; i < 520; i++) { const r = await init(ta.access_token); assert.equal(r.status, 200); first.push(r.headers.get('mcp-session-id')); }
  assert.equal((await list(ta.access_token, first[0])).status, 404, 'the oldest session of the same browser was evicted');
  assert.equal((await list(ta.access_token, first.at(-1))).status, 200);
  assert.equal((await list(tb.access_token, victim)).status, 200, 'another browser keeps its session');
  assert.equal((await init(tb.access_token)).status, 200);
});

test('failed state writes leave no private temporary files and startup removes crash leftovers', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'kitsuvo-store-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'state.json'), { readdir } = await import('node:fs/promises');
  t.mock.method(console, 'error', () => {});
  const leftover = path.join(directory, 'state.json.0b8c4a52-6f1e-4c2d-9a7b-3e5f6d7c8b9a');
  await writeFile(leftover, '{"partial":');
  await writeFile(path.join(directory, 'state.json.keep'), 'unrelated');
  const store = durableStore(file, 'https://relay.example');
  assert.deepEqual((await readdir(directory)).sort(), ['state.json', 'state.json.keep']);
  // Renaming over a directory fails after the temporary file was fully written.
  await rm(file); await mkdir(file); await writeFile(path.join(file, 'x'), '');
  for (let i = 0; i < 3; i++) await assert.rejects(store.save(), /unavailable/);
  assert.deepEqual((await readdir(directory)).sort(), ['state.json', 'state.json.keep']);
});

test('SIGTERM-style shutdown drains in-flight calls, refuses new work, asks connectors to reconnect and flushes state', { timeout: 20000 }, async t => {
  const f = await fixture(t, true), key = randomBytes(32).toString('base64url');
  let release, started; const gate = new Promise(r => release = r), began = new Promise(r => started = r);
  const browser = await f.browser('draining', false, { async callTool() { started(); await gate; return { content: [{ type: 'text', text: 'finished' }] }; } }, key);
  const registration = await f.client(), auth = await f.authorize(registration, browser);
  const token = await (await f.exchange(registration, auth)).json();
  const c = new Client({ name: 'drain-fixture', version: '1' }); t.after(() => c.close());
  await c.connect(new StreamableHTTPClientTransport(new URL(f.origin + '/mcp'), { requestInit: { headers: { Authorization: 'Bearer ' + token.access_token } } }));
  const inFlight = c.callTool({ name: 'fixture', arguments: {} }); await began;
  const closeCode = new Promise(resolve => browser.socket.once('close', code => resolve(code)));
  let done = false; const stopping = f.relay.shutdown({ graceMs: 5000 }).then(() => { done = true; });
  await new Promise(r => setTimeout(r, 50));
  const fresh = await fetch(f.origin + '/health').then(r => r.status, () => 'refused');
  assert.ok(fresh === 503 || fresh === 'refused', `new work is not accepted while draining (${fresh})`);
  assert.equal(done, false, 'shutdown waits for the in-flight call');
  release();
  assert.equal((await inFlight).content[0].text, 'finished', 'the in-flight call completes');
  await stopping;
  assert.equal(await closeCode, 1012, 'connectors are told the relay is restarting');
  const state = JSON.parse(await readFile(f.stateFile, 'utf8'));
  assert.ok(state.tokens.some(([, item]) => item.clientId === registration.client_id), 'the durable grant was flushed');
});

test('shutdown is bounded: a call that never finishes cannot hold the relay past its grace period', { timeout: 10000 }, async t => {
  const f = await fixture(t);
  let started; const began = new Promise(r => started = r);
  const browser = await f.browser('stuck', false, { async callTool() { started(); return new Promise(() => {}); } });
  const registration = await f.client(), token = await (await f.exchange(registration, await f.authorize(registration, browser))).json();
  const c = new Client({ name: 'stuck-fixture', version: '1' }); t.after(() => c.close());
  await c.connect(new StreamableHTTPClientTransport(new URL(f.origin + '/mcp'), { requestInit: { headers: { Authorization: 'Bearer ' + token.access_token } } }));
  const stuck = c.callTool({ name: 'fixture', arguments: {} }).catch(() => 'failed'); await began;
  const begin = performance.now(); await f.relay.shutdown({ graceMs: 300, socketMs: 300 });
  assert.ok(performance.now() - begin < 3000);
  assert.equal(await stuck, 'failed');
});

test('the relay process exits cleanly on SIGTERM after draining', { timeout: 20000 }, async t => {
  const { spawn } = await import('node:child_process');
  const reserve = createServer(); await new Promise(r => reserve.listen(0, '127.0.0.1', r)); const port = reserve.address().port; await new Promise(r => reserve.close(r));
  const child = spawn(process.execPath, [new URL('../server.mjs', import.meta.url).pathname], { env: { ...process.env, PORT: String(port), KITSUVO_CLOUD_ORIGIN: `http://127.0.0.1:${port}`, KITSUVO_SHUTDOWN_GRACE_MS: '500', KITSUVO_CLOUD_STATE_FILE: '', POSTHOG_API_KEY: '' }, stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(() => child.kill('SIGKILL'));
  let out = ''; child.stdout.on('data', d => { out += d; });
  for (let i = 0; i < 100 && !out.includes('listening'); i++) await new Promise(r => setTimeout(r, 50));
  assert.match(out, /listening/);
  const [code] = await Promise.all([once(child, 'exit').then(([c]) => c), Promise.resolve(child.kill('SIGTERM'))]);
  assert.equal(code, 0); assert.match(out, /"event":"draining"/); assert.match(out, /"event":"stopped"/);
});

test('relay responses carry anti-framing and no-sniff headers; the approval page declares its language', async t => {
  const f = await fixture(t), registration = await f.client();
  const params = new URLSearchParams({ client_id: registration.client_id, response_type: 'code', redirect_uri: registration.redirect_uris[0], code_challenge: 'x'.repeat(43), code_challenge_method: 'S256', scope: 'browser', resource: f.origin + '/mcp' });
  const page = await fetch(f.origin + '/authorize?' + params);
  assert.equal(page.status, 200); assert.match(page.headers.get('content-type'), /^text\/plain; charset=utf-8/); assert.equal(page.headers.get('content-language'), 'en');
  for (const response of [page, await fetch(f.origin + '/health'), await fetch(f.origin + '/nowhere'), await fetch(f.origin + '/register', { headers: { Origin: 'https://evil.example' } })]) {
    assert.match(response.headers.get('content-security-policy'), /frame-ancestors 'none'/);
    assert.equal(response.headers.get('x-frame-options'), 'DENY');
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
  }
});

test('a wall-clock jump while running neither expires live tokens nor prunes persisted grants', { timeout: 10000 }, async t => {
  const f = await fixture(t, true), key = randomBytes(32).toString('base64url');
  const browser = await f.browser('clock', false, {}, key);
  const registration = await f.client(), token = await (await f.exchange(registration, await f.authorize(registration, browser))).json();
  const original = Date.now, start = original(); t.after(() => { Date.now = original; });
  Date.now = () => start + 200 * 86400000;
  const headers = { Authorization: 'Bearer ' + token.access_token };
  assert.equal((await fetch(f.origin + '/userinfo', { headers })).status, 200, 'a forward step does not expire the access token');
  const refreshed = await f.post('/token', { grant_type: 'refresh_token', client_id: registration.client_id, refresh_token: token.refresh_token });
  assert.equal(refreshed.status, 200, 'nor the refresh token');
  Date.now = () => start - 86400000;
  const state = JSON.parse(await readFile(f.stateFile, 'utf8'));
  assert.ok(state.tokens.length >= 2 && state.identities.length === 1, 'persisted grants survive');
  const later = await refreshed.json(); browser.socket.close();
  assert.ok(later.expires_in > 0 && later.expires_in <= 600, 'lifetimes are relative, so client clock skew cannot misread them');
});

test('a reconnect storm from one approved connector is budgeted and never disturbs another browser', { timeout: 60000 }, async t => {
  const f = await fixture(t, true), key = randomBytes(32).toString('base64url');
  const steady = await f.browser('steady'), stormy = await f.browser('stormy', false, {}, key);
  const cs = await f.client(), cy = await f.client();
  const ts = await (await f.exchange(cs, await f.authorize(cs, steady))).json();
  assert.equal((await f.exchange(cy, await f.authorize(cy, stormy))).status, 200);
  const sdk = new Client({ name: 'steady-fixture', version: '1' }); t.after(() => sdk.close());
  await sdk.connect(new StreamableHTTPClientTransport(new URL(f.origin + '/mcp'), { requestInit: { headers: { Authorization: 'Bearer ' + ts.access_token } } }));
  let closed = once(stormy.socket, 'close'); stormy.socket.close(); await closed;
  const url = f.origin.replace('http:', 'ws:') + '/connect';
  let accepted = 0, refused;
  for (let i = 0; i < 200 && !refused; i++) {
    const socket = new WebSocket(url, { headers: { 'X-Kitsuvo-Connector-Key': key } });
    const outcome = await new Promise(resolve => { socket.once('open', () => resolve('open')); socket.once('unexpected-response', (_req, res) => resolve(res.statusCode)); socket.once('error', () => resolve('error')); });
    if (outcome === 'open') { accepted++; closed = once(socket, 'close'); socket.close(); await closed; } else refused = outcome;
  }
  assert.equal(refused, 429, 'a tight reconnect loop is throttled');
  assert.ok(accepted >= 100 && accepted <= 120, `reconnect budget (${accepted})`);
  assert.equal((await sdk.callTool({ name: 'fixture', arguments: {} })).content[0].text, 'steady', 'other browsers keep working');
});

// A controllable clock: `advance` moves both wall and monotonic time.
// Compressed time would trip the SDK's real-time per-address /token rate limit,
// so each simulated refresh arrives from its own forwarded address.
let refreshAddress = 0;
const refreshFrom = (f, registration, token) => fetch(f.origin + '/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Forwarded-For': `10.9.${(++refreshAddress >> 8) & 255}.${refreshAddress & 255}` }, body: new URLSearchParams({ grant_type: 'refresh_token', client_id: registration.client_id, refresh_token: token.refresh_token }) });
function fakeClock() {
  const start = Date.now(); let offset = 0;
  return { wall: () => start + offset, monotonic: () => offset, advance: ms => { offset += ms; } };
}

test('a temporary connector can refresh every few minutes for over 24 hours; idle tokens still expire', { timeout: 30000 }, async t => {
  const clock = fakeClock(), f = await fixture(t, false, { clock, trustedProxyHops: 1 });
  const browser = await f.browser('long-lived');
  const registration = await f.client();
  let token = await (await f.exchange(registration, await f.authorize(registration, browser))).json();
  const refresh = () => refreshFrom(f, registration, token);
  // 9-minute cycles (inside the 10-minute access lifetime) for 30 hours.
  for (let minute = 0; minute < 30 * 60; minute += 9) {
    clock.advance(9 * 60000);
    assert.equal((await fetch(f.origin + '/userinfo', { headers: { Authorization: 'Bearer ' + token.access_token } })).status, 200, `access still valid at minute ${minute + 9}`);
    const response = await refresh(); assert.equal(response.status, 200, `refresh at minute ${minute + 9}`);
    token = await response.json();
  }
  clock.advance(11 * 60000);
  assert.equal((await fetch(f.origin + '/userinfo', { headers: { Authorization: 'Bearer ' + token.access_token } })).status, 401, 'an unrefreshed access token expires after 10 minutes');
  const renewed = await refresh(); assert.equal(renewed.status, 200, 'its refresh token is still good');
  token = await renewed.json();
  clock.advance(25 * 3600000);
  assert.equal((await refresh()).status, 400, 'a temporary refresh token expires after a day idle');
  browser.socket.close();
});

test('an installed connector keeps refreshing across 100 days and a relay restart mid-session, then expires after 90 idle days', { timeout: 30000 }, async t => {
  const clock = fakeClock(), f = await fixture(t, true, { clock, trustedProxyHops: 1 }), key = randomBytes(32).toString('base64url');
  let browser = await f.browser('installed', false, {}, key);
  const registration = await f.client();
  let token = await (await f.exchange(registration, await f.authorize(registration, browser))).json();
  const refresh = () => refreshFrom(f, registration, token);
  for (let day = 1; day <= 100; day++) {
    clock.advance(86400000);
    const response = await refresh(); assert.equal(response.status, 200, `refresh on day ${day}`);
    token = await response.json();
    if (day === 50) {
      // A Fly machine restart mid-session: the connector drops and comes back.
      const closed = once(browser.socket, 'close');
      await f.restart();
      await closed;
      browser = await f.browser('installed-after-restart', false, {}, key);
      assert.equal((await fetch(f.origin + '/userinfo', { headers: { Authorization: 'Bearer ' + token.access_token } })).status, 200, 'the access token issued before the restart still works');
    }
  }
  const closed = once(browser.socket, 'close'); browser.socket.close(); await closed;
  clock.advance(91 * 86400000);
  await f.restart();
  assert.equal((await refresh()).status, 400, '90 days without a refresh ends the grant');
});

test('two concurrent exchanges of one authorization code issue at most one usable grant', { timeout: 10000 }, async t => {
  const f = await fixture(t, true), key = randomBytes(32).toString('base64url');
  const browser = await f.browser('race', false, {}, key);
  const registration = await f.client(), auth = await f.authorize(registration, browser);
  const responses = await Promise.all([f.exchange(registration, auth), f.exchange(registration, auth)]);
  const statuses = responses.map(r => r.status).sort();
  assert.deepEqual(statuses, [200, 400]);
  const issued = await responses.find(r => r.status === 200).json();
  assert.equal((await fetch(f.origin + '/userinfo', { headers: { Authorization: 'Bearer ' + issued.access_token } })).status, 401, 'the replay revoked what the first exchange issued');
  browser.socket.close();
});

test('connector revocation is on disk when it is acknowledged', { timeout: 10000 }, async t => {
  const f = await fixture(t, true), key = randomBytes(32).toString('base64url');
  const browser = await f.browser('durable-revoke', false, {}, key);
  const registration = await f.client();
  await (await f.exchange(registration, await f.authorize(registration, browser))).json();
  assert.ok(JSON.parse(await readFile(f.stateFile, 'utf8')).tokens.length >= 2);
  const revoked = once(browser.events, 'revoked'); browser.revoke(); await revoked;
  assert.deepEqual(JSON.parse(await readFile(f.stateFile, 'utf8')).tokens, [], 'the WebSocket acknowledgement follows the durable write');
  browser.socket.close();
});

test('the relay is deployed as exactly one machine because its authorization state is a single local file', async () => {
  // Fly volumes attach to one machine. A second machine would get its own empty
  // volume: tokens issued by one would be unknown to the other and a revocation
  // on one would not reach the other. The deployment must stay single-instance.
  const config = await readFile(new URL('../fly.toml', import.meta.url), 'utf8');
  assert.match(config, /^\s*min_machines_running\s*=\s*1\s*$/m);
  assert.match(config, /^\s*destination\s*=\s*"\/data"\s*$/m);
  assert.match(config, /KITSUVO_CLOUD_STATE_FILE\s*=\s*"\/data\//);
  assert.match(config, /single machine/i, 'fly.toml documents the single-instance requirement');
  assert.doesNotMatch(config, /^\s*(min_machines_running|count)\s*=\s*([2-9]|\d{2,})/m);
});
