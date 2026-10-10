import { test } from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { createBridge } from '../server.mjs';
import { mountKitsuvo } from '../embed-host.mjs';
import { APP_URI } from '../browser-app.mjs';

test('embed initialization validates its host and client before reading resources', async () => {
  await assert.rejects(mountKitsuvo(null), /DOM container/);
  await assert.rejects(mountKitsuvo({ append() {}, ownerDocument: {} }), /authorized MCP client/);
  const client = { readResource() { throw new Error('must not be called'); }, callTool() {} };
  await assert.rejects(mountKitsuvo({ append() {}, ownerDocument: {} }, { client, theme: 'unknown' }), /Theme/);
  await assert.rejects(mountKitsuvo({ append() {}, ownerDocument: {} }, { client, timeout: 0 }), /timeout/);
});

test('opt-in embed routes serve a bounded panel bridge and preserve local request restrictions', async t => {
  const calls = [];
  const backend = { callTool: async params => {
    calls.push(params);
    const text = params.name === 'browser_snapshot' ? 'Page: https://example.com/\nTitle: Example\n- link "Next" [ref=e1]'
      : params.name === 'browser_tabs' ? '- tab 3 [active]: Example (https://example.com/)' : 'Screenshots unavailable';
    return { content: [{ type: 'text', text }], isError: params.name === 'browser_take_screenshot' };
  } };
  const reservation = createBridge(backend);
  await new Promise(resolve => reservation.listen(0, '127.0.0.1', resolve));
  const port = reservation.address().port;
  await new Promise(resolve => reservation.close(resolve));
  const bridge = createBridge(backend, { port, embed: true });
  await new Promise(resolve => bridge.listen(port, '127.0.0.1', resolve));
  t.after(() => { bridge.closeAllConnections(); bridge.close(); });
  const base = `http://127.0.0.1:${port}`;
  const post = (params, extra = {}) => fetch(base + '/embed/action', { method: 'POST',
    headers: { 'Content-Type': 'application/json', ...extra }, body: JSON.stringify(params) });
  const page = await fetch(base + '/embed');
  assert.equal(page.status, 200);
  assert.match(page.headers.get('content-security-policy'), /frame-ancestors 'self'/);
  assert.match(await page.text(), /Connect local browser/);
  assert.match(await (await fetch(base + '/embed/sdk.js')).text(), /mountKitsuvo/);
  const resource = await (await fetch(base + '/embed/resource')).json();
  assert.equal(resource.contents[0].uri, APP_URI);
  assert.match(resource.contents[0].text, /Content-Security-Policy/);
  assert.equal((await post({ name: 'browser_evaluate', arguments: { expression: 'document.cookie' } })).status, 403);
  assert.equal(calls.length, 0);
  assert.equal((await post({ name: 'kitsuvo_browser' }, { Origin: 'https://evil.example' })).status, 403);
  const foreignHost = await new Promise((resolve, reject) => {
    const req = request(base + '/embed/action', { method: 'POST', headers: { Host: 'evil.example' } }, res => {
      res.resume(); resolve(res.statusCode);
    });
    req.on('error', reject); req.end();
  });
  assert.equal(foreignHost, 403);
  assert.equal((await fetch(base + '/embed/action', { method: 'POST', body: '{}' })).status, 415);
  assert.equal((await fetch(base + '/embed/action', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: 'invalid' })).status, 400);
  assert.equal((await post({ name: 'kitsuvo_browser', arguments: { url: 'x'.repeat(17000) } })).status, 413);
  const result = await (await post({ name: 'kitsuvo_browser', arguments: {} })).json();
  assert.equal(result.structuredContent.title, 'Example');
  assert.equal(result.structuredContent.tab, 3);
  assert.ok(result._meta.previewNote);
  const disabledReservation = createBridge(backend);
  await new Promise(resolve => disabledReservation.listen(0, '127.0.0.1', resolve));
  const disabledPort = disabledReservation.address().port;
  await new Promise(resolve => disabledReservation.close(resolve));
  const disabled = createBridge(backend, { port: disabledPort });
  bridge.closeAllConnections();
  await new Promise(resolve => bridge.close(resolve));
  await new Promise(resolve => disabled.listen(disabledPort, '127.0.0.1', resolve));
  t.after(() => { disabled.closeAllConnections(); disabled.close(); });
  assert.equal((await fetch(`http://127.0.0.1:${disabledPort}/embed`)).status, 404);
});
