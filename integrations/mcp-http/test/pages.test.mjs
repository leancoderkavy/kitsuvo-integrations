import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {createBridge} from '../server.mjs';
import {exampleHtml} from '../embed-server.mjs';
import {token,authorization} from './auth-fixture.mjs';

// WCAG relative luminance contrast for #rrggbb colours.
const contrast=(a,b)=>{const l=hex=>{const [r,g,bl]=[1,3,5].map(i=>{const c=parseInt(hex.slice(i,i+2),16)/255;return c<=0.03928?c/12.92:((c+0.055)/1.055)**2.4;});return 0.2126*r+0.7152*g+0.0722*bl;};const [x,y]=[l(a),l(b)].sort((m,n)=>n-m);return (x+0.05)/(y+0.05);};

test('every bridge response, including plain-text errors, carries anti-framing, nosniff and referrer headers',async()=>{
 const reservation=createServer();await new Promise(r=>reservation.listen(0,'127.0.0.1',r));const port=reservation.address().port;await new Promise(r=>reservation.close(r));
 const backend={listTools:async()=>({tools:[]}),callTool:async()=>({content:[]}),close:async()=>{}};
 const bridge=createBridge(backend,{token,port,embed:true});await new Promise(r=>bridge.listen(port,'127.0.0.1',r));
 try{
  const base=`http://127.0.0.1:${port}`;
  for(const [path,headers,status] of [['/mcp',{},401],['/nowhere',{Authorization:authorization},404],['/mcp',{Origin:'https://evil.example'},403]]){
   const response=await fetch(base+path,{headers});assert.equal(response.status,status,path);
   assert.equal(response.headers.get('x-content-type-options'),'nosniff');assert.equal(response.headers.get('referrer-policy'),'no-referrer');
   assert.match(response.headers.get('content-security-policy'),/frame-ancestors 'none'/);assert.match(response.headers.get('content-type'),/^text\/plain; charset=utf-8/);
  }
  const shell=await fetch(base+'/embed');assert.equal(shell.status,200);
  assert.match(shell.headers.get('content-security-policy'),/frame-ancestors 'self'/);assert.doesNotMatch(shell.headers.get('content-security-policy'),/frame-ancestors 'none'/);
  assert.equal(shell.headers.get('referrer-policy'),'no-referrer');assert.match(shell.headers.get('content-type'),/text\/html/);
 }finally{await bridge.closeSessions?.();bridge.closeAllConnections();await new Promise(r=>bridge.close(r));}
});

test('bridge pages declare language and direction, label controls, keep focus and meet text contrast',async()=>{
 const panel=await readFile(new URL('../ui/browser.html',import.meta.url),'utf8');
 for(const html of [panel,exampleHtml]){assert.match(html,/<html lang="en" dir="ltr">/);assert.match(html,/name="viewport" content="width=device-width,\s?initial-scale=1"/);assert.doesNotMatch(html,/user-scalable|maximum-scale/);}
 assert.match(exampleHtml,/<label>Local bridge credential <input/);assert.match(exampleHtml,/role="status" aria-live="polite"/);
 assert.match(exampleHtml,/disconnect\.focus\(\)/);assert.match(exampleHtml,/button\.focus\(\)/);
 const primary=/\.primary\{background:(#[0-9a-f]{6});color:(#[0-9a-f]{3,6})/.exec(panel);assert.ok(primary);
 const full=primary[2].length===4?'#'+[...primary[2].slice(1)].map(c=>c+c).join(''):primary[2];
 assert.ok(contrast(primary[1],full)>=4.5,`primary button contrast ${contrast(primary[1],full).toFixed(2)}`);
 // Every control the panel declares has an accessible name.
 for(const [, tag, attrs, text] of panel.matchAll(/<(button|input|select)([^>]*)>([^<]*)/g)) assert.ok(/aria-label=/.test(attrs)||text.trim(),`${tag} ${attrs}`);
 assert.match(panel,/@media\(max-width:420px\)/,'narrow panels reflow controls');
 const script=await readFile(new URL('../ui/browser.mjs',import.meta.url),'utf8');assert.match(script,/returnFocus/,'busy state returns keyboard focus');
});
