import test from 'node:test';
import assert from 'node:assert/strict';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';
import {createAppServer} from '../server.mjs';
async function client(t,backend,options){
  const server=createAppServer(backend,undefined,options),client=new Client({name:'same-client-name',version:'1'});
  const [a,b]=InMemoryTransport.createLinkedPair();await server.connect(b);await client.connect(a);
  t.after(async()=>{await client.close();await server.close();});return client;
}
test('shared bridges own distinct caller contexts and overwrite forged scope metadata',async t=>{
  const calls=[];const backend={callTool:async params=>{calls.push(params);return {content:[]};}};
  const a=await client(t,backend),b=await client(t,backend);
  await a.callTool({name:'browser_task',arguments:{action:'status'},_meta:{'kitsuvo/session':'chosen-by-caller'}});const first=calls.at(-1)._meta['kitsuvo/session'];assert.notEqual(first,'chosen-by-caller');
  await b.callTool({name:'browser_task',arguments:{action:'status'},_meta:{'kitsuvo/session':first}});const second=calls.at(-1)._meta['kitsuvo/session'];assert.notEqual(first,second);
  await a.callTool({name:'browser_task',arguments:{action:'status'},_meta:{'kitsuvo/session':second}});assert.equal(calls.at(-1)._meta['kitsuvo/session'],first);
});
test('only an explicitly trusted connector forwards the authenticated upstream context',async t=>{
  const calls=[];const backend={callTool:async params=>{calls.push(params);return {content:[]};}};
  const a=await client(t,backend,{forwardSessions:true});
  await a.callTool({name:'browser_task',arguments:{action:'status'},_meta:{'kitsuvo/session':'authenticated-upstream-owner'}});assert.equal(calls.at(-1)._meta['kitsuvo/session'],'authenticated-upstream-owner');
  await a.callTool({name:'browser_task',arguments:{action:'status'},_meta:{'kitsuvo/session':'../invalid-context'}});assert.notEqual(calls.at(-1)._meta['kitsuvo/session'],'../invalid-context');
});
