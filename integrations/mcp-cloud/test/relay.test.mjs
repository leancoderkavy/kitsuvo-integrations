import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request as httpRequest } from 'node:http';
import { EventEmitter, once } from 'node:events';
import { randomBytes, createHash } from 'node:crypto';
import { createRelay } from '../server.mjs';
import { connectBrowser, browserTransportConfig } from '../connect.mjs';
import { mkdtemp, readFile, stat, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import WebSocket from 'ws';

const fetch = (url, options = {}) => globalThis.fetch(url, {...options, headers:{...options.headers, Connection:'close'}});
async function offline(f, headers) {
  let status;
  for (let i=0;i<50;i++) { status=(await fetch(f.origin+'/mcp',{headers})).status; if(status===503) return; await new Promise(r=>setTimeout(r,10)); }
  assert.equal(status,503);
}

async function fixture(t, durable = false, { telemetry } = {}) {
  const directory = await mkdtemp(path.join(tmpdir(), 'kitsuvo-relay-'));
  t.after(() => rm(directory, {recursive:true,force:true}));
  const stateFile = durable ? path.join(directory, 'state.json') : undefined;
  const reserve = createServer();
  await new Promise(resolve => reserve.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${reserve.address().port}`;
  await new Promise(resolve => reserve.close(resolve));
  let relay = createRelay({ origin, stateFile, telemetry });
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
    async restart() { await relay.close(); relay = createRelay({origin, stateFile, telemetry}); await new Promise(resolve => relay.http.listen(new URL(origin).port, '127.0.0.1', resolve)); }
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
    await client.connect(transport); t.after(() => client.close());
    assert.equal(client.getServerVersion().title, 'Kitsuvo');
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
  assert.deepEqual(native.args, ['mcp', '--headless']);
  assert.equal(native.env.KITSUVO_HEADLESS, '1');
  const app = browserTransportConfig(env, true);
  assert.ok(app.args.includes('--stdio'));
  assert.equal(app.env.KITSUVO_HEADLESS, '1');
  assert.deepEqual(browserTransportConfig({}).args, ['mcp']);
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
