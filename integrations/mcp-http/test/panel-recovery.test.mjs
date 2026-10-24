import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, stat, readFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { panelStore } from '../panel-store.mjs';
import { callBrowserApp } from '../browser-app.mjs';
const text = value => ({content:[{type:'text',text:value}]});

test('restart restores each panel URL into distinct new tabs and refuses stale mutations', async t => {
  const dir=await mkdtemp(path.join(tmpdir(),'kitsuvo-panel-recovery-')); t.after(()=>rm(dir,{recursive:true,force:true}));
  const file=path.join(dir,'panels.json'), profile=path.join(dir,'profile');
  function backend(store) {
    let id=0; const pages=new Map(), calls=[];
    return {_kitsuvoPanelRecovery:store,pages,calls,async callTool(p) {
      calls.push(p);
      if(p.name==='browser_tabs' && p.arguments.action==='new') {pages.set(++id,p.arguments.url);return text(`Opened tab ${id}.`);}
      if(p.name==='browser_tabs') return text([...pages].map(([id,url])=>`- tab ${id}: Test (${url})`).join('\n'));
      if(p.name==='browser_snapshot') return text(`Page: ${pages.get(p.arguments.tab)}\nTitle: Test\nTab: ${p.arguments.tab}\n- heading "Test"`);
      return text('Done');
    }};
  }
  const first=backend(await panelStore(file,profile));
  const a=(await callBrowserApp(first,'kitsuvo_browser',{url:'https://a.example/'})).structuredContent;
  const b=(await callBrowserApp(first,'kitsuvo_browser',{url:'https://b.example/'})).structuredContent;
  const restarted=backend(await panelStore(file,profile));
  const denied=await callBrowserApp(restarted,'kitsuvo_browser_action',{action:'click',panelId:a.panelId,tab:a.tab,ref:'e1'});
  assert.equal(denied.isError,true); assert.equal(restarted.calls.length,0);
  const observed=await callBrowserApp(restarted,'kitsuvo_browser_refresh',{panelId:a.panelId,tab:a.tab});
  assert.equal(observed.isError,true); assert.equal(observed._meta.recoveryRequired,true);
  assert.equal(restarted.calls.length,0,'read-only refresh cannot reopen a saved URL');
  // Resume B before A: numeric IDs deliberately reverse their previous meaning.
  const resumedB=(await callBrowserApp(restarted,'kitsuvo_browser_action',{action:'refresh',panelId:b.panelId,tab:b.tab})).structuredContent;
  const resumedA=(await callBrowserApp(restarted,'kitsuvo_browser_action',{action:'refresh',panelId:a.panelId,tab:a.tab})).structuredContent;
  assert.equal(resumedA.url,'https://a.example/'); assert.equal(resumedB.url,'https://b.example/');
  assert.notEqual(resumedA.tab,resumedB.tab); assert.equal(resumedA.tab,b.tab);
  if(process.platform!=='win32') assert.equal((await stat(file)).mode&0o777,0o600);
  await assert.rejects(panelStore(file,path.join(dir,'different-profile')));
});

test('concurrent panel saves keep every panel on disk and skip unchanged rewrites', async t => {
  const dir=await mkdtemp(path.join(tmpdir(),'kitsuvo-panel-store-')); t.after(()=>rm(dir,{recursive:true,force:true}));
  const file=path.join(dir,'panels.json'), profile=path.join(dir,'profile');
  const store=await panelStore(file,profile);
  const ids=Array.from({length:20},(_,i)=>`00000000-0000-4000-8000-${String(i).padStart(12,'0')}`);
  await Promise.all(ids.map((id,i)=>store.save(id,`https://${i}.example/`)));
  const saved=JSON.parse(await readFile(file,'utf8')).records;
  assert.deepEqual(Object.keys(saved).sort(),ids);
  const before=(await stat(file)).mtimeMs, inode=(await stat(file)).ino;
  await store.save(ids[0],'https://0.example/');
  assert.equal((await stat(file)).ino,inode,'an unchanged URL is not rewritten');
  assert.equal((await stat(file)).mtimeMs,before);
  await store.save(ids[0],'https://moved.example/');
  assert.equal(JSON.parse(await readFile(file,'utf8')).records[ids[0]].url,'https://moved.example/');
  const reopened=await panelStore(file,profile);
  assert.equal(reopened.get(ids[19]).url,'https://19.example/');
});
