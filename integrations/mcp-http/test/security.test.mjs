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
