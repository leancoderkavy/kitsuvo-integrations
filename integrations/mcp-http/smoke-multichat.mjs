import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdtemp,mkdir,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
const profile=await mkdtemp(join(tmpdir(),'kitsuvo-multichat-'));
await mkdir(join(profile,'agent'));
await writeFile(join(profile,'agent/state.json'),JSON.stringify({settings_version:4,settings:{local_only:true,auto_update:false,block_ai:false,spoof_warn:false,jev_auto:false,claude_auto:false}}));
const fixture=createServer((req,res)=>{res.setHeader('Content-Type','text/html');res.end(`<title>Stress ${req.url}</title><h1>Session marker ${req.url}</h1><a href="/next">Next</a>`);});
await new Promise(r=>fixture.listen(0,'127.0.0.1',r));
const base=`http://127.0.0.1:${fixture.address().port}`;
const clients=[],results=[],failures=[];let calls=0;
const call=async(c,name,args)=>{let start=performance.now();let r=await c.callTool({name,arguments:args},undefined,{timeout:120000});calls++;assert.notEqual(r.isError,true,JSON.stringify(r.content));results.push(Math.round(performance.now()-start));return r.structuredContent;};
try{
 for(let i=0;i<6;i++){const c=new Client({name:`stress-chat-${i}`,version:'1'});clients.push(c);await c.connect(new StdioClientTransport({command:'/opt/homebrew/bin/node',args:[new URL('./server.mjs',import.meta.url).pathname,'--stdio'],env:{...process.env,KITSUVO_BINARY:process.env.KITSUVO_BINARY || 'kitsuvo',KITSUVO_PROFILE_DIR:profile},stderr:'pipe'}));}
 const states=await Promise.all(clients.map((c,i)=>call(c,'kitsuvo_browser',{url:`${base}/chat-${i}/start`})));
 assert.equal(new Set(states.map(s=>s.tab)).size,6,'distinct session tabs');
 console.log('Six sessions opened distinct tabs:',states.map(s=>s.tab));
 for(let round=0;round<5;round++)await Promise.all(clients.map(async(c,i)=>{let url=`${base}/chat-${i}/round-${round}`;let s=await call(c,'kitsuvo_browser_action',{action:'navigate',tab:states[i].tab,url});assert.equal(s.tab,states[i].tab);assert.equal(s.url,url);assert.match(s.snapshot,new RegExp(`/chat-${i}/round-${round}`));let r=await call(c,'kitsuvo_browser_action',{action:'refresh',tab:states[i].tab});assert.equal(r.url,url);assert.equal(r.tab,states[i].tab);}));
 await clients[0].close();
 await Promise.all(clients.slice(1).map(async(c,j)=>{let i=j+1;let s=await call(c,'kitsuvo_browser_action',{action:'refresh',tab:states[i].tab});assert.equal(s.url,`${base}/chat-${i}/round-4`);}));
 const same=clients[1],tabs=states.slice(1).map(s=>s.tab);
 await Promise.all(tabs.map(async(tab,i)=>{let s=await call(same,'kitsuvo_browser_action',{action:'navigate',tab,url:`${base}/same-transport-${i}`});assert.equal(s.tab,tab);assert.equal(s.url,`${base}/same-transport-${i}`);}));
 const shared=await Promise.all([0,1,2].map(i=>call(same,'kitsuvo_browser',{url:`${base}/shared-panel-${i}`})));
 assert.equal(new Set(shared.map(s=>s.tab)).size,3);
 const changed=await call(same,'kitsuvo_browser_action',{action:'new',tab:shared[0].tab,panelId:shared[0].panelId,url:`${base}/shared-panel-0/latest`});
 const restored=await call(same,'kitsuvo_browser_action',{action:'refresh',tab:shared[0].tab,panelId:shared[0].panelId});
 assert.equal(restored.tab,changed.tab);assert.equal(restored.url,`${base}/shared-panel-0/latest`);
 const closed=await call(same,'kitsuvo_browser_action',{action:'close',tab:changed.tab,panelId:shared[0].panelId});
 assert.equal(closed.tab,shared[0].tab);
 for(let i=1;i<3;i++){const s=await call(same,'kitsuvo_browser_action',{action:'refresh',tab:shared[i].tab,panelId:shared[i].panelId});assert.equal(s.url,`${base}/shared-panel-${i}`);}
 console.log('Three panels sharing one transport: distinct tabs, canonical restore after new tab, close returns only its own tab.');
 const summary={sessions:6,calls,distinctTabs:states.map(s=>s.tab),sharedPanelTabs:shared.map(s=>s.tab),rounds:5,passed:true,latencyMs:{min:Math.min(...results),max:Math.max(...results),mean:Math.round(results.reduce((a,b)=>a+b)/results.length)},profile};console.log(JSON.stringify(summary));
 await writeFile('/tmp/kitsuvo-multichat-results.json',JSON.stringify(summary,null,2));
}catch(e){failures.push(e.stack);console.error(e.stack);await writeFile('/tmp/kitsuvo-multichat-results.json',JSON.stringify({passed:false,calls,failures,profile},null,2));process.exitCode=1;}
finally{await Promise.allSettled(clients.map(c=>c.close()));fixture.closeAllConnections();await new Promise(r=>fixture.close(r));}
