import assert from 'node:assert/strict';
import { test } from 'node:test';
import { callBrowserApp } from '../browser-app.mjs';

const text = value => ({ content: [{ type: 'text', text: value }] });
function backend({ screenshot = true, denied = false } = {}) {
  const calls = [];
  return { calls, async callTool(params) {
    calls.push(params);
    if (denied) return { ...text('Control stopped or sensitive page refused.'), isError: true };
    if (params.name === 'browser_snapshot') return text('Page: https://example.com/\nTitle: Example\n\n```yaml\n- link "Next" [ref=e1]\n- textbox "Name" [ref=e2]\n```');
    if (params.name === 'browser_tabs') return text(`${params.arguments.action === 'new' ? 'Opened tab 3.\n' : ''}- tab 1 [active]: Example (https://example.com/)\n- tab 2: Other (https://other.example/)\n- tab 3: Panel (https://example.com/)`);
    if (params.name === 'kitsuvo_report') return text('{"gate":"blocked_ai","score":90,"builder":"Lovable"}');
    if (params.name === 'browser_take_screenshot') return screenshot
      ? { content: [{ type: 'image', data: 'cG5n', mimeType: 'image/png' }] }
      : { ...text('Screenshots are Windows-only.'), isError: true };
    return text('Done');
  } };
}

test('opening the panel navigates, reads current state, and keeps preview out of model content', async () => {
  const native = backend();
  const result = await callBrowserApp(native, 'kitsuvo_browser', { url: 'https://example.com/', tab: 1 });
  assert.deepEqual(native.calls[0], { name: 'browser_navigate', arguments: { url: 'https://example.com/', tab: 1 } });
  assert.equal(result.structuredContent.url, 'https://example.com/');
  assert.equal(result.structuredContent.tab, 1);
  assert.equal(result.structuredContent.tabs.length, 3);
  assert.equal(result._meta.preview.data, 'cG5n');
  assert.ok(!JSON.stringify(result.structuredContent).includes('cG5n'));
  assert.match(result.content[0].text, /\[ref=e1\]/, 'hosts without app UI still receive actionable page text');
});

test('new panels sharing a connection allocate distinct tabs and refresh their own latest tab', async () => {
  let next = 10; const pages = new Map(); const calls = [];
  const native = { async callTool(p) {
    calls.push(p);
    if (p.name === 'browser_tabs' && p.arguments.action === 'new') {
      const id = next++; pages.set(id, p.arguments.url ?? 'https://duckduckgo.com/');
      return text(`Opened tab ${id}.\n`);
    }
    if (p.name === 'browser_tabs' && p.arguments.action === 'close') pages.delete(p.arguments.tab);
    if (p.name === 'browser_navigate') pages.set(p.arguments.tab, p.arguments.url);
    if (p.name === 'browser_snapshot') return text(`Page: ${pages.get(p.arguments.tab)}\nTitle: Test\nTab: ${p.arguments.tab}\n- heading "Test"`);
    if (p.name === 'browser_tabs') return text([...pages].map(([id,url]) => `- tab ${id}: Test (${url})`).join('\n'));
    return text('Done');
  }};
  const a = (await callBrowserApp(native,'kitsuvo_browser',{url:'https://a.example/'})).structuredContent;
  const b = (await callBrowserApp(native,'kitsuvo_browser',{url:'https://b.example/'})).structuredContent;
  assert.notEqual(a.tab,b.tab); assert.notEqual(a.panelId,b.panelId);
  await callBrowserApp(native,'kitsuvo_browser_action',{action:'navigate',tab:a.tab,panelId:a.panelId,url:'https://a.example/latest'});
  const restored = (await callBrowserApp(native,'kitsuvo_browser_action',{action:'refresh',tab:b.tab,panelId:a.panelId})).structuredContent;
  assert.equal(restored.tab,a.tab); assert.equal(restored.url,'https://a.example/latest');
  assert.equal(pages.get(b.tab),'https://b.example/');
  const nextTab = (await callBrowserApp(native,'kitsuvo_browser_action',{action:'new',tab:a.tab,panelId:a.panelId,url:'https://a.example/new'})).structuredContent;
  const current = (await callBrowserApp(native,'kitsuvo_browser_action',{action:'refresh',tab:a.tab,panelId:a.panelId})).structuredContent;
  assert.equal(current.tab,nextTab.tab);
  const closed = (await callBrowserApp(native,'kitsuvo_browser_action',{action:'close',tab:nextTab.tab,panelId:a.panelId})).structuredContent;
  assert.equal(closed.tab,a.tab); assert.equal(closed.url,'https://a.example/latest');
  assert.equal(pages.get(b.tab),'https://b.example/');
});

test('macOS keeps usable page controls when screenshots are unavailable', async () => {
  const result = await callBrowserApp(backend({ screenshot: false }), 'kitsuvo_browser', {});
  assert.equal(result.isError, false);
  assert.match(result.structuredContent.snapshot, /ref=e2/);
  assert.match(result._meta.previewNote, /Windows-only/);
});

test('native Stop and sensitive-page errors are preserved without reading further', async () => {
  const native = backend({ denied: true });
  const result = await callBrowserApp(native, 'kitsuvo_browser_action', { action: 'click', ref: 'e1' });
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /refused/);
  assert.equal(native.calls.length, 1);
});

test('invalid panel actions cannot invoke arbitrary tools or JavaScript', async () => {
  const native = backend();
  for (const args of [{ action: 'evaluate', expression: 'alert(1)' }, { action: '__proto__' },
    { action: 'type', ref: 'e1' }, { action: 'select' }, { action: 'navigate', url: 42 },
    { action: 'option', ref: 'e1', values: 'bad' }, { action: 'refresh', tab: -1 }]) {
    assert.equal((await callBrowserApp(native, 'kitsuvo_browser_action', args)).isError, true);
  }
  assert.equal(native.calls.length, 0);
});

test('typing and selecting forward explicit fields; closing reads the new active tab', async () => {
  const native = backend();
  await callBrowserApp(native, 'kitsuvo_browser_action', { action: 'type', tab: 1, ref: 'e2', text: 'Ada', submit: true, expression: 'ignored' });
  assert.deepEqual(native.calls[0], { name: 'browser_type', arguments: { tab: 1, ref: 'e2', text: 'Ada', submit: true } });
  native.calls.length = 0;
  await callBrowserApp(native, 'kitsuvo_browser_action', { action: 'close', tab: 2 });
  assert.deepEqual(native.calls[0], { name: 'browser_tabs', arguments: { tab: 2, action: 'close' } });
  assert.deepEqual(native.calls[1], { name: 'browser_snapshot', arguments: {} });
});

test('page evidence is requested for the viewed tab and cleared by subsequent views', async () => {
  const native = backend();
  const result = await callBrowserApp(native, 'kitsuvo_browser_action', { action: 'report', tab: 2 });
  assert.deepEqual(native.calls[0], { name: 'kitsuvo_report', arguments: { tab: 2 } });
  assert.match(result.structuredContent.report, /blocked_ai/);
  assert.match(result.structuredContent.report, /Lovable/);
  const refresh = await callBrowserApp(native, 'kitsuvo_browser_action', { action: 'refresh', tab: 1 });
  assert.equal(refresh.structuredContent.report, undefined);
});

test('panel actions target its observed background tab rather than the visible desktop tab', async () => {
  const native = backend();
  const original = native.callTool;
  native.callTool = async params => params.name === 'browser_snapshot'
    ? text('Page: https://other.example/\nTitle: Background\nTab: 2\n- button "Test" [ref=e1]')
    : original(params);
  const view = await callBrowserApp(native, 'kitsuvo_browser', { url: 'https://other.example/' });
  assert.equal(view.structuredContent.tabs.find(tab => tab.active).tab, 1);
  assert.equal(view.structuredContent.tab, 2);
  native.calls.length = 0;
  await callBrowserApp(native, 'kitsuvo_browser_action', { action: 'click', ref: 'e1', tab: view.structuredContent.tab });
  assert.deepEqual(native.calls[0], { name: 'browser_click', arguments: { tab: 2, ref: 'e1' } });
});

test('fitting the preview explicitly lays out the observed tab without custom device spoofing', async () => {
  const native = backend();
  await callBrowserApp(native, 'kitsuvo_browser_action', { action: 'fit', tab: 2 });
  assert.deepEqual(native.calls[0], { name: 'browser_resize', arguments: { tab: 2, off: true } });
});
