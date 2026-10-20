import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createRelay } from '../server.mjs';

async function relayFixture(t) {
  const reserve = createServer();
  await new Promise(r => reserve.listen(0, '127.0.0.1', r));
  const origin = `http://127.0.0.1:${reserve.address().port}`;
  await new Promise(r => reserve.close(r));
  const relay = createRelay({ origin, trustedProxyHops: 1 });
  await new Promise(r => relay.http.listen(new URL(origin).port, '127.0.0.1', r));
  t.after(() => relay.close());
  return { origin, relay };
}

const register = (origin, ip) => fetch(origin + '/register', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': ip, Connection: 'close' },
  body: JSON.stringify({ redirect_uris: ['https://claude.ai/api/mcp/auth_callback'], client_name: 'x' }),
});

test('trusts exactly one proxy hop (Fly)', async t => {
  const { relay } = await relayFixture(t);
  assert.equal(relay.http.app.get('trust proxy'), 1);
});

test('rate limiter buckets clients by X-Forwarded-For, not proxy IP', async t => {
  const { origin } = await relayFixture(t);
  const warnings = [];
  const orig = console.error; console.error = (...a) => { warnings.push(a.join(' ')); };
  t.after(() => { console.error = orig; });
  let limited = false;
  for (let i = 0; i < 40 && !limited; i++) limited = (await register(origin, '203.0.113.7')).status === 429;
  assert.ok(limited, 'client A should eventually be rate limited');
  const other = await register(origin, '198.51.100.9');
  assert.notEqual(other.status, 429, 'client B must have its own bucket');
  assert.ok(!warnings.some(w => w.includes('ERR_ERL_UNEXPECTED_X_FORWARDED_FOR')));
});

test('unproxied relays never trust client-supplied forwarding headers',async t=>{
 const reserve=createServer();await new Promise(r=>reserve.listen(0,'127.0.0.1',r));const origin=`http://127.0.0.1:${reserve.address().port}`;await new Promise(r=>reserve.close(r));
 const relay=createRelay({origin});assert.equal(relay.http.app.get('trust proxy'),0);await new Promise(r=>relay.http.listen(new URL(origin).port,'127.0.0.1',r));t.after(()=>relay.close());
});

test('WebSocket budgets use the trusted rightmost client and cannot be evaded by prepending addresses',async t=>{
 const {origin}=await relayFixture(t);
 const {request}=await import('node:http'),{default:WebSocket}=await import('ws'),{once}=await import('node:events');
 const invalid=forwarded=>new Promise((resolve,reject)=>{const req=request(origin+'/connect',{headers:{Connection:'Upgrade',Upgrade:'websocket','Sec-WebSocket-Version':'13','Sec-WebSocket-Key':'invalid','X-Forwarded-For':forwarded}},res=>{res.resume();resolve(res.statusCode);});req.on('error',reject);req.end();});
 for(let i=0;i<20;i++)assert.equal(await invalid(`198.51.100.${i+1}, 203.0.113.7`),400);
 assert.equal(await invalid('192.0.2.99, 203.0.113.7'),429);
 const other=new WebSocket(origin.replace('http:','ws:')+'/connect',{headers:{'X-Forwarded-For':'198.51.100.9'}});await once(other,'open');other.close();await once(other,'close');
});

test('WebSocket budgets group equivalent IPv6 addresses and rotated hosts in the same /56',async t=>{
 const {origin}=await relayFixture(t),{request}=await import('node:http');
 const invalid=ip=>new Promise((resolve,reject)=>{const req=request(origin+'/connect',{headers:{Connection:'Upgrade',Upgrade:'websocket','Sec-WebSocket-Version':'13','Sec-WebSocket-Key':'invalid','X-Forwarded-For':ip}},res=>{res.resume();resolve(res.statusCode);});req.on('error',reject);req.end();});
 for(let i=0;i<20;i++)assert.equal(await invalid(`2001:db8:1234:5600::${i+1}`),400);
 assert.equal(await invalid('2001:0db8:1234:56ff:0000:0000:0000:0001'),429);
 assert.equal(await invalid('2001:db8:1234:5700::1'),400);
});
