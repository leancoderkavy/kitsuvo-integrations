import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {Server} from '@modelcontextprotocol/sdk/server/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {createSessions} from '../protocol-sessions.mjs';
import {CallToolRequestSchema} from '@modelcontextprotocol/sdk/types.js';

test('sessions enforce capacity, owner isolation, and explicit termination',async t=>{
 const sessions=createSessions({capacity:1});
 const http=createServer((req,res)=>sessions.handle(req,res,req.headers['x-owner']||'a',()=>new Server({name:'fixture',version:'1'},{capabilities:{}})).catch(()=>res.writeHead(500).end()));
 await new Promise(r=>http.listen(0,'127.0.0.1',r));
 t.after(()=>{sessions.close();http.closeAllConnections();http.close();});
 const url=new URL(`http://127.0.0.1:${http.address().port}/mcp`);
 const c=new Client({name:'fixture',version:'1'}), transport=new StreamableHTTPClientTransport(url);
 t.after(()=>c.close());await c.connect(transport);
 assert.equal((await fetch(url,{headers:{'mcp-session-id':transport.sessionId,'x-owner':'b'}})).status,404);
 const second=new Client({name:'second',version:'1'});t.after(()=>second.close());
 await assert.rejects(second.connect(new StreamableHTTPClientTransport(url)),/capacity reached/);
 await transport.terminateSession();
 const third=new Client({name:'third',version:'1'});t.after(()=>third.close());
 await third.connect(new StreamableHTTPClientTransport(url));await third.ping();
});
test('independently shipped session managers stay identical',async()=>{
 assert.equal(await readFile(new URL('../protocol-sessions.mjs',import.meta.url),'utf8'),await readFile(new URL('../../mcp-cloud/protocol-sessions.mjs',import.meta.url),'utf8'));
});

test('cancellation closes the original HTTP response even when its handler is still settling',async t=>{
 const sessions=createSessions();let release,started;
 const gate=new Promise(r=>release=r),began=new Promise(r=>started=r);
 const http=createServer((req,res)=>sessions.handle(req,res,'owner',()=>{
  const server=new Server({name:'fixture',version:'1'},{capabilities:{tools:{}}});
  server.setRequestHandler(CallToolRequestSchema,async()=>{started();await gate;return {content:[]};});return server;
 }).catch(()=>res.end()));
 await new Promise(r=>http.listen(0,'127.0.0.1',r));
 t.after(()=>{release();sessions.close();http.closeAllConnections();http.close();});
 const url=new URL(`http://127.0.0.1:${http.address().port}/mcp`),c=new Client({name:'fixture',version:'1'}),transport=new StreamableHTTPClientTransport(url);
 t.after(()=>c.close());await c.connect(transport);
 const headers={'Content-Type':'application/json',Accept:'application/json, text/event-stream','mcp-session-id':transport.sessionId};
 const original=fetch(url,{method:'POST',headers,body:JSON.stringify({jsonrpc:'2.0',id:100,method:'tools/call',params:{name:'fixture',arguments:{}}})});
 await began;
 await fetch(url,{method:'POST',headers,body:JSON.stringify({jsonrpc:'2.0',method:'notifications/cancelled',params:{requestId:100}})});
 const response=await original;assert.match((await response.json()).error.message,/cancelled/);release();
});

test('per-source caps and heaviest-source eviction stop a few networks from starving others',async t=>{
 const sessions=createSessions({capacity:6,sourceCapacity:3,sourceOf:owner=>owner.split('/')[0]});
 const http=createServer((req,res)=>sessions.handle(req,res,req.headers['x-owner'],()=>new Server({name:'fixture',version:'1'},{capabilities:{}})).catch(()=>res.writeHead(500).end()));
 await new Promise(r=>http.listen(0,'127.0.0.1',r));
 t.after(()=>{sessions.close();http.closeAllConnections();http.close();});
 const url=`http://127.0.0.1:${http.address().port}/mcp`,base={'Content-Type':'application/json',Accept:'application/json, text/event-stream'};
 const init=async owner=>{const r=await fetch(url,{method:'POST',headers:{...base,'x-owner':owner},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-06-18',capabilities:{},clientInfo:{name:'p',version:'1'}}})});await r.text();return r;};
 const alive=async(owner,id)=>(await fetch(url,{method:'POST',headers:{...base,'x-owner':owner,'mcp-session-id':id,'mcp-protocol-version':'2025-06-18'},body:JSON.stringify({jsonrpc:'2.0',id:2,method:'ping'})})).status===200;
 const open=async owner=>{const r=await init(owner);assert.equal(r.status,200,owner);return r.headers.get('mcp-session-id');};
 const a=[];for(let i=0;i<4;i++)a.push(await open('A/'+i));
 assert.equal(await alive('A/0',a[0]),false,'a source over its cap loses its own idlest session');
 assert.ok(await alive('A/1',a[1]));
 const b=[];for(let i=0;i<3;i++)b.push(await open('B/'+i));
 // The table is full (A: 3, B: 3). A new network still gets in; one heavy
 // network's least recently used session is evicted instead of refusing it.
 assert.ok(await alive('A/1',a[1]));
 const c=await open('C/0');
 assert.ok(await alive('C/0',c));
 const living=[...await Promise.all(a.slice(1).map((id,i)=>alive('A/'+(i+1),id))),...await Promise.all(b.map((id,i)=>alive('B/'+i,id)))].filter(Boolean).length;
 assert.equal(living,5,'exactly one session from a heavy network was evicted');
 assert.ok(await alive('B/0',b[0]),'the recently used network kept its touched session');
 const d=await open('D/0');assert.ok(await alive('D/0',d));assert.ok(await alive('C/0',c),'the lightest network is never the eviction target');
});

test('without a source key, a full session table still refuses rather than evicting',async t=>{
 const sessions=createSessions({capacity:1});
 const http=createServer((req,res)=>sessions.handle(req,res,'x',()=>new Server({name:'fixture',version:'1'},{capabilities:{}})).catch(()=>res.writeHead(500).end()));
 await new Promise(r=>http.listen(0,'127.0.0.1',r));
 t.after(()=>{sessions.close();http.closeAllConnections();http.close();});
 const body=JSON.stringify({jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-06-18',capabilities:{},clientInfo:{name:'p',version:'1'}}});
 const headers={'Content-Type':'application/json',Accept:'application/json, text/event-stream'};
 assert.equal((await fetch(`http://127.0.0.1:${http.address().port}/mcp`,{method:'POST',headers,body})).status,200);
 assert.equal((await fetch(`http://127.0.0.1:${http.address().port}/mcp`,{method:'POST',headers,body})).status,503);
});
