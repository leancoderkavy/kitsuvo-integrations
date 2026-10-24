import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {createBridge,readConfig} from '../server.mjs';
import {token,authorization} from './auth-fixture.mjs';

test('HTTP startup fails closed without a credential; invalid configured credentials are rejected',()=>{
 for(const bad of [undefined,'','short','x'.repeat(44),'x'.repeat(42)+'!'])assert.throws(()=>createBridge({},{token:bad}),/private 32-byte/);
 assert.throws(()=>readConfig({KITSUVO_MCP_TOKEN:'bad'}),/private 32-byte/);
 assert.equal(readConfig({}).token,undefined,'stdio config remains usable without HTTP credentials');
});
test('anonymous clients cannot initialize, dispatch embed actions, read browser state or reuse an MCP session',async()=>{
 const reservation=createServer();await new Promise(r=>reservation.listen(0,'127.0.0.1',r));const port=reservation.address().port;await new Promise(r=>reservation.close(r));
 let starts=0,calls=0;
 const backend={listTools:async()=>({tools:[{name:'private_read',inputSchema:{type:'object'}}]}),callTool:async()=>{calls++;return {content:[{type:'text',text:'private fixture'}]};},close:async()=>{}};
 const bridge=createBridge(backend,{token,port,embed:true,createBackend:async()=>{starts++;return backend;}});await new Promise(r=>bridge.listen(port,'127.0.0.1',r));
 const url=new URL(`http://127.0.0.1:${port}/mcp`),client=new Client({name:'authenticated-fixture',version:'1'});
 try{
  for(const headers of [{},{Authorization:'Bearer '+'z'.repeat(43)}]){
   const response=await fetch(url,{method:'POST',headers,body:'invalid JSON'});assert.equal(response.status,401);assert.equal(response.headers.get('cache-control'),'no-store');
  }
  for(const endpoint of ['/embed/resource','/embed/action'])assert.equal((await fetch(new URL(endpoint,url),{method:endpoint.endsWith('action')?'POST':'GET'})).status,401);
  assert.equal(starts,0);assert.equal(calls,0);
  const shell=await (await fetch(new URL('/embed',url))).text();assert.ok(shell.includes('Local bridge credential'));assert.ok(!shell.includes(token));
  const transport=new StreamableHTTPClientTransport(url,{requestInit:{headers:{Authorization:authorization}}});await client.connect(transport);
  assert.equal((await client.callTool({name:'private_read',arguments:{}})).content[0].text,'private fixture');assert.equal(starts,1);assert.equal(calls,1);
  assert.equal((await fetch(url,{headers:{'mcp-session-id':transport.sessionId}})).status,401);
  assert.equal((await fetch(url,{method:'POST',headers:{Authorization:authorization,Origin:'https://attacker.example'}})).status,403);
 }finally{await client.close();await bridge.closeSessions();bridge.closeAllConnections();await new Promise(r=>bridge.close(r));}
});
test('shared mode caps MCP request bodies at 1 MiB like per-session mode',async()=>{
 const reservation=createServer();await new Promise(r=>reservation.listen(0,'127.0.0.1',r));const port=reservation.address().port;await new Promise(r=>reservation.close(r));
 const backend={listTools:async()=>({tools:[{name:'echo',inputSchema:{type:'object'}}]}),callTool:async()=>({content:[{type:'text',text:'ok'}]}),close:async()=>{}};
 const bridge=createBridge(backend,{token,port});await new Promise(r=>bridge.listen(port,'127.0.0.1',r));
 const url=new URL(`http://127.0.0.1:${port}/mcp`),client=new Client({name:'size-fixture',version:'1'});
 try{
  const transport=new StreamableHTTPClientTransport(url,{requestInit:{headers:{Authorization:authorization}}});await client.connect(transport);
  const headers={Authorization:authorization,'Content-Type':'application/json',Accept:'application/json, text/event-stream','mcp-session-id':transport.sessionId,'mcp-protocol-version':'2025-06-18'};
  const call=size=>fetch(url,{method:'POST',headers,body:JSON.stringify({jsonrpc:'2.0',id:9,method:'tools/call',params:{name:'echo',arguments:{x:'a'.repeat(size)}}})});
  assert.equal((await call((1<<20)+1)).status,413);
  assert.equal((await call(1000)).status,200);
 }finally{await client.close();bridge.closeAllConnections();await new Promise(r=>bridge.close(r));}
});
test('an oversized MCP body does not stall the next request on the same keep-alive socket',async()=>{
 const {request,Agent}=await import('node:http');
 const backend={listTools:async()=>({tools:[]}),callTool:async()=>({content:[]}),close:async()=>{}};
 for(const shared of [true,false]){
  const reservation=createServer();await new Promise(r=>reservation.listen(0,'127.0.0.1',r));const port=reservation.address().port;await new Promise(r=>reservation.close(r));
  const bridge=createBridge(backend,{token,port,...(shared?{}:{createBackend:async()=>backend})});await new Promise(r=>bridge.listen(port,'127.0.0.1',r));
  const agent=new Agent({keepAlive:true,maxSockets:1});
  const post=body=>new Promise((resolve,reject)=>{const req=request({agent,host:'127.0.0.1',port,method:'POST',path:'/mcp',headers:{Authorization:authorization,'Content-Type':'application/json',Accept:'application/json, text/event-stream'}},res=>{res.resume();res.on('end',()=>resolve(res.statusCode));});req.on('error',reject);req.setTimeout(5000,()=>req.destroy(new Error('stalled keep-alive socket')));req.end(body);});
  try{
   assert.equal(await post(JSON.stringify({x:'a'.repeat(2<<20)})),413);
   assert.equal(await post('{bad'),400);
  }finally{agent.destroy();await bridge.closeSessions();bridge.closeAllConnections();await new Promise(r=>bridge.close(r));}
 }
});
