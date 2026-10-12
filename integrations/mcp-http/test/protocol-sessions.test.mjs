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
