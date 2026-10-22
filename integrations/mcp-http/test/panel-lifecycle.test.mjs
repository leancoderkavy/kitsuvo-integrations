import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
const source=(await readFile(new URL('../ui/browser.mjs',import.meta.url),'utf8')).replace(/^import .*;\r?\n/,'');
const html=await readFile(new URL('../ui/browser.html',import.meta.url),'utf8');
const panelId='12345678-1234-1234-1234-123456789012';
const result=(url,tab=3)=>({structuredContent:{url,title:url,tab,panelId,snapshot:`Page: ${url}\nTab: ${tab}`,tabs:[{tab,title:url,url}]}});
const tick=()=>new Promise(r=>setImmediate(r));
function harness(storage=new Map()) {
 const nodes=new Map(),calls=[];let app;
 const node=()=>({children:[],dataset:{},attributes:{},setAttribute(k,v){this.attributes[k]=String(v);},removeAttribute(k){delete this.attributes[k];},replaceChildren(...x){this.children=x;},append(...x){this.children.push(...x);}});
 const get=id=>{if(!nodes.has(id))nodes.set(id,node());return nodes.get(id);};
 class App{constructor(){app=this;}async connect(){}getHostContext(){return {};}async callServerTool(p){calls.push(p);return result('https://live.example/',p.arguments.action==='new'?8:p.arguments.tab);}}
 const context=vm.createContext({App,URL,applyHostStyleVariables(){},document:{getElementById:get,querySelectorAll:()=>[],createElement:node,documentElement:{style:{}}},localStorage:{getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,v)}});
 vm.runInContext(source,context);return {app,calls,nodes,get,storage};
}
test('connection waits for the originating panel, refreshes live state, and ignores stale replay',async()=>{
 const h=harness();await tick();assert.equal(h.calls.length,0);
 h.app.ontoolresult(result('https://stale.example/'));await tick();
 assert.equal(h.calls[0].name,'kitsuvo_browser_refresh');
 assert.equal(h.calls[0].arguments.action,undefined);
 assert.equal(h.calls[0].arguments.tab,3);assert.equal(h.calls[0].arguments.panelId,panelId);
 assert.equal(h.get('url').value,'https://live.example/');
 h.app.ontoolresult(result('https://stale.example/'));await tick();
 assert.equal(h.get('url').value,'https://live.example/');assert.equal(h.calls.length,1);
});

test('a restarted backend requires an explicit reconnect before recreating a panel tab',async()=>{
 const h=harness();await tick();
 h.app.ontoolresult(result('https://stale.example/'));await tick();
 h.app.ontoolresult({isError:true,content:[{type:'text',text:'Browser restarted.'}],_meta:{recoveryRequired:true}});
 assert.equal(h.get('reconnect').hidden,false);
 assert.equal(h.calls.length,1,'restart does not automatically dispatch a mutation');
 h.app.ontoolcancelled();
 assert.equal(h.get('reconnect').hidden,true);
});
test('result before handshake still refreshes, and remount uses the saved changed tab',async()=>{
 const h=harness();h.app.ontoolresult(result('https://stale.example/'));await tick();
 assert.equal(h.calls.length,1);
 // Simulate the same panel after a tab change; host replay still names tab 3.
 h.storage.set(`kitsuvo-panel-tab:${panelId}`,'8');
 const remounted=harness(h.storage);await tick();remounted.app.ontoolresult(result('https://stale.example/'));await tick();
 assert.equal(remounted.calls[0].arguments.tab,8);assert.equal(remounted.get('url').value,'https://live.example/');
});
test('inline panel is preview-first with one inspector and no nested scrolling',()=>{
 assert.equal((html.match(/<details\b/g)??[]).length,1);
 assert.match(html,/<details id="inspector"><summary>Page details<\/summary>/);
 assert.match(html,/id="fullscreen"[^>]*>Open full browser<\/button>[\s\S]*data-action="refresh"[^>]*>Refresh<\/button>/);
 assert.doesNotMatch(html,/#elements\{[^}]*(?:overflow:(?:auto|scroll)|max-height)/);
 assert.doesNotMatch(html,/pre\{[^}]*(?:overflow:(?:auto|scroll)|max-height)/);
});
test('preview fallback opens the inspector and generated controls have contextual names',async()=>{
 const h=harness();await tick();
 const page=result('https://example.com/');
 page.structuredContent.snapshot='Page: https://example.com/\nTitle: Example\n- button "Read more" [ref=e1]\n- textbox "Search" [ref=e2]';
 h.app.ontoolresult(page);
 assert.equal(h.get('inspector').open,true);
 assert.equal(h.get('pageMeta').textContent,'example.com · Separate agent profile');
 const rows=h.get('elements').children;
 assert.equal(rows[0].children[1].attributes['aria-label'],'Click button "Read more"');
 assert.equal(rows[1].children[4].attributes['aria-label'],'Type in textbox "Search"');
});
test('an available preview keeps details collapsed and summarizes detection evidence',async()=>{
 const h=harness();await tick();
 const page=result('https://example.com/');
 page.structuredContent.report='{"score":90,"verdict_label":"Likely AI-built","builder":"Lovable"}';
 page._meta={preview:{mimeType:'image/png',data:'cG5n'}};
 h.app.ontoolresult(page);
 assert.equal(Boolean(h.get('inspector').open),false);
 assert.equal(h.get('evidence').hidden,false);
 assert.equal(h.get('evidenceSummary').textContent,'Score 90 · Likely AI-built · Lovable');
 h.get('inspector').open=true;
 h.app.ontoolresult({...page,structuredContent:{...page.structuredContent,panelId:'different-panel'}});
 assert.equal(h.get('inspector').open,true);
});
