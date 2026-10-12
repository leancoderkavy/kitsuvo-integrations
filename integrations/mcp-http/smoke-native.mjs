// Qualify the installed native executable and the HTTP adapter without an AI
// model or a user's browsing profile. Close only this run's disposable browser.
import assert from 'node:assert/strict';
import { createServer, request } from 'node:http';
import { mkdtemp, readFile, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createBridge, createNativeBackend } from './server.mjs';
import { APP_URI, appTools } from './browser-app.mjs';

const headless = process.env.KITSUVO_HEADLESS === '1';
const profile = await mkdtemp(join(tmpdir(), 'kitsuvo-mcp-qualification-'));
process.env.KITSUVO_PROFILE_DIR = profile;
await mkdir(join(profile, 'agent'));
await writeFile(join(profile, 'agent/state.json'), JSON.stringify({ settings_version: 4, settings: {
  local_only: true, auto_update: false, block_ai: false, spoof_warn: false, jev_auto: false, claude_auto: false,
} }));
const native = new Client({ name: 'kitsuvo-native-qualification', version: '1.0.0' });
const fixture = createServer((req, res) => {
  res.setHeader('Content-Type', 'text/html');
  res.end(req.url === '/password' ? '<title>Password fixture</title><input type="password">'
    : '<title>Kitsuvo MCP fixture</title><main><h1>Browser qualification</h1><input aria-label="Message"><button onclick="document.querySelector(\'h1\').textContent=\'Clicked successfully\'">Test button</button></main>');
});
let bridge, httpClient, parallelClient;
try {
  await native.connect(new StdioClientTransport({ command: process.env.KITSUVO_BINARY || 'kitsuvo',
    args: ['mcp', '--separate-profile', ...(headless ? ['--headless'] : [])], env: { ...process.env, KITSUVO_PROFILE_DIR: profile }, stderr: 'inherit' }));
  assert.equal(native.getServerVersion().name, 'kitsuvo');
  const tools = (await native.listTools()).tools;
  assert.ok(tools.some(tool => tool.name === 'kitsuvo_report'));
  assert.ok(tools.some(tool => tool.name === 'browser_resize'));
  await new Promise(resolve => fixture.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${fixture.address().port}`;
  const call = async (client, name, args = {}) => {
    const result = await client.callTool({ name, arguments: args }, undefined, { timeout: 60000 });
    assert.notEqual(result.isError, true, JSON.stringify(result));
    return result;
  };
  await call(native, 'browser_tabs', { action: 'list' });
  const page = await call(native, 'browser_navigate', { url: base });
  assert.match(JSON.stringify(page.content), /Browser qualification/);
  await call(native, 'kitsuvo_report');
  await call(native, 'browser_resize', { device: 'iphone-16' });
  await call(native, 'browser_resize', { off: true });
  const denied = await native.callTool({ name: 'browser_navigate', arguments: { url: 'https://accounts.google.com/' } });
  assert.equal(denied.isError, true, JSON.stringify(denied));
  // Reserve an available port, then preserve the adapter's exact Host check.
  const reservation = createServer();
  await new Promise(resolve => reservation.listen(0, '127.0.0.1', resolve));
  const port = reservation.address().port;
  await new Promise(resolve => reservation.close(resolve));
  bridge = createBridge(native, { port, embed: true, createBackend: info => createNativeBackend({ binary: process.env.KITSUVO_BINARY || 'kitsuvo', headless }, info) });
  await new Promise(resolve => bridge.listen(port, '127.0.0.1', resolve));
  httpClient = new Client({ name: 'kitsuvo-http-qualification', version: '1.0.0' });
  const httpTransport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`));
  parallelClient = new Client({ name: 'kitsuvo-parallel-qualification', version: '1.0.0' });
  const parallelTransport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`));
  await Promise.all([httpClient.connect(httpTransport), parallelClient.connect(parallelTransport)]);
  assert.notEqual(httpTransport.sessionId, parallelTransport.sessionId);
  const bridgedTools = (await httpClient.listTools()).tools;
  assert.deepEqual(bridgedTools.map(tool => tool.name).sort(), [...tools, ...appTools].map(tool => tool.name).sort());
  const resources = (await httpClient.listResources()).resources;
  assert.ok(resources.some(resource => resource.uri === APP_URI));
  const app = await httpClient.readResource({ uri: APP_URI });
  assert.ok(app.contents.some(content => content.text?.includes('<html') && !content.text.includes('/* BROWSER_APP */')));
  const parallelPages = await Promise.all([
    call(httpClient, 'browser_navigate', { url: base }),
    call(parallelClient, 'browser_navigate', { url: base }),
  ]);
  const tabOf = page => Number(page.content[0].text.match(/Tab: (\d+)/)[1]);
  assert.notEqual(tabOf(parallelPages[0]), tabOf(parallelPages[1]));
  let slowFinished = false;
  const slow = call(httpClient, 'browser_evaluate', { expression: 'new Promise(resolve => { const marker = document.createElement("p"); marker.textContent = "HTTP slow started"; document.body.append(marker); setTimeout(() => resolve("slow done"), 2000); })' })
    .then(value => { slowFinished = true; return value; });
  const control = JSON.parse(await readFile(join(profile, 'agent/control.json'), 'utf8'));
  const waiting = await fetch(`${control.url}/v1/wait_for`, { method: 'POST',
    headers: { Authorization: `Bearer ${control.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ tab: tabOf(parallelPages[0]), text: 'HTTP slow started', timeout_ms: 5000 }),
  });
  assert.equal((await waiting.json()).ok, true, 'slow evaluation has entered the native browser');
  // Both requests travel through HTTP and separate native MCP processes.
  const started = performance.now();
  const independent = await call(parallelClient, 'browser_snapshot');
  assert.equal(tabOf(independent), tabOf(parallelPages[1]));
  assert.equal(slowFinished, false, 'slow session must not block another HTTP session');
  console.log(`HTTP independent snapshot while another session evaluates: ${Math.round(performance.now() - started)} ms`);
  await slow;
  const snapshot = await call(httpClient, 'browser_snapshot');
  assert.match(JSON.stringify(snapshot.content), /Browser qualification/);
  await call(httpClient, 'kitsuvo_report');
  const panel = await call(httpClient, 'kitsuvo_browser', { url: base });
  assert.match(JSON.stringify(panel.structuredContent), /Browser qualification/);
  assert.equal(panel.structuredContent.tabs.length > 0, true);
  await parallelTransport.terminateSession();
  await parallelClient.close();
  // Deleting one native connection must leave the other tab context usable.
  assert.equal(tabOf(await call(httpClient, 'browser_snapshot')), tabOf(parallelPages[0]));
  const endpoint = `http://127.0.0.1:${port}`;
  const embedPost = (value, headers = {}) => fetch(endpoint + '/embed/action', { method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(value) });
  assert.equal((await embedPost({ name: 'kitsuvo_browser' }, { Origin: 'https://untrusted.example' })).status, 403);
  assert.equal((await embedPost({ name: 'browser_evaluate', arguments: { expression: 'document.cookie' } })).status, 403);
  const foreignHost = await new Promise((resolve, reject) => {
    const req = request(endpoint + '/embed/action', { method: 'POST', headers: { Host: 'untrusted.example' } }, response => {
      response.resume();resolve(response.statusCode);
    });
    req.on('error', reject);req.end();
  });
  assert.equal(foreignHost, 403);
  const embedded = await embedPost({ name: 'kitsuvo_browser', arguments: { url: base } });
  assert.equal(embedded.status, 200);
  assert.match(JSON.stringify(await embedded.json()), /Browser qualification/);
  if (headless) {
    const control = JSON.parse(await readFile(join(profile, 'agent/control.json'), 'utf8'));
    const status = await fetch(control.url + '/v1/status', { method: 'POST',
      headers: { 'Authorization': 'Bearer ' + control.token, 'Content-Type': 'application/json' }, body: '{}' });
    const result = (await status.json()).result;
    assert.equal(result.agent.headless, true);
    assert.equal(result.window_visible, false);
    const panel = await call(httpClient, 'kitsuvo_browser', { url: base });
    assert.equal(panel._meta.preview.mimeType, 'image/png');
    assert.ok(Buffer.from(panel._meta.preview.data, 'base64').length > 1000);
  }
  console.log(`Native MCP ${native.getServerVersion().version}: ${tools.length} native tools plus ${appTools.length} App tools, local-only isolated profile, navigation, snapshot, report, responsive mode, sensitive-page refusal, concurrent HTTP sessions, session deletion, browser panel and embed Host/origin/tool boundaries passed.`);
} finally {
  await httpClient?.close();
  await parallelClient?.close();
  await bridge?.closeSessions();
  bridge?.closeAllConnections();
  if (bridge) await new Promise(resolve => bridge.close(resolve));
  await native.close();
  fixture.closeAllConnections();
  await new Promise(resolve => fixture.close(resolve));
  try {
    const control = JSON.parse(await readFile(join(profile, 'agent/control.json'), 'utf8'));
    if (Number.isInteger(control.pid) && control.pid !== process.pid) process.kill(control.pid);
  } catch (error) {
    if (!['ENOENT', 'ESRCH'].includes(error.code)) console.error('Close the disposable browser window:', error.message);
  }
  console.log(`Disposable browser profile: ${profile}`);
}
