import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
const source=(await readFile(new URL('../ui/browser.mjs',import.meta.url),'utf8')).replace(/^import .*;\r?\n/,'');
const panelId='12345678-1234-1234-1234-123456789012';
const result=(url,tab=3)=>({structuredContent:{url,title:url,tab,panelId,snapshot:`Page: ${url}\nTab: ${tab}`,tabs:[{tab,title:url,url}]}});
const tick=()=>new Promise(r=>setImmediate(r));
function harness(storage=new Map()) {
 const nodes=new Map(),calls=[];let app;
 const node=()=>({children:[],dataset:{},setAttribute(){},removeAttribute(){},replaceChildren(...x){this.children=x;},append(...x){this.children.push(...x);}});
 const get=id=>{if(!nodes.has(id))nodes.set(id,node());return nodes.get(id);};
 class App{constructor(){app=this;}async connect(){}getHostContext(){return {};}async callServerTool(p){calls.push(p);return result('https://live.example/',p.arguments.action==='new'?8:p.arguments.tab);}}
 const context=vm.createContext({App,applyHostStyleVariables(){},document:{getElementById:get,querySelectorAll:()=>[],createElement:node,documentElement:{style:{}}},localStorage:{getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,v)}});
 vm.runInContext(source,context);return {app,calls,nodes,get,storage};
}
test('connection waits for the originating panel, refreshes live state, and ignores stale replay',async()=>{
 const h=harness();await tick();assert.equal(h.calls.length,0);
 h.app.ontoolresult(result('https://stale.example/'));await tick();
 assert.equal(h.calls[0].arguments.tab,3);assert.equal(h.calls[0].arguments.panelId,panelId);
 assert.equal(h.get('url').value,'https://live.example/');
 h.app.ontoolresult(result('https://stale.example/'));await tick();
 assert.equal(h.get('url').value,'https://live.example/');assert.equal(h.calls.length,1);
});
test('result before handshake still refreshes, and remount uses the saved changed tab',async()=>{
 const h=harness();h.app.ontoolresult(result('https://stale.example/'));await tick();
 assert.equal(h.calls.length,1);
 // Simulate the same panel after a tab change; host replay still names tab 3.
 h.storage.set(`kitsuvo-panel-tab:${panelId}`,'8');
 const remounted=harness(h.storage);await tick();remounted.app.ontoolresult(result('https://stale.example/'));await tick();
 assert.equal(remounted.calls[0].arguments.tab,8);assert.equal(remounted.get('url').value,'https://live.example/');
});
