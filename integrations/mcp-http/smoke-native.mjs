// Qualify the installed native executable and the HTTP adapter without an AI
// model or a user's browsing profile. Close only this run's disposable browser.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createBridge } from './server.mjs';
import { APP_URI, appTools } from './browser-app.mjs';

const profile = await mkdtemp(join(tmpdir(), 'kitsuvo-mcp-qualification-'));
const native = new Client({ name: 'kitsuvo-native-qualification', version: '1.0.0' });
const fixture = createServer((req, res) => {
  res.setHeader('Content-Type', 'text/html');
  res.end(req.url === '/password' ? '<title>Password fixture</title><input type="password">'
    : '<title>Kitsuvo MCP fixture</title><main><h1>Browser qualification</h1><input aria-label="Message"><button onclick="document.querySelector(\'h1\').textContent=\'Clicked successfully\'">Test button</button></main>');
});
let bridge, httpClient;
try {
  await native.connect(new StdioClientTransport({ command: process.env.KITSUVO_BINARY || 'kitsuvo',
    args: ['mcp'], env: { ...process.env, KITSUVO_PROFILE_DIR: profile }, stderr: 'inherit' }));
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
  bridge = createBridge(native, { port });
  await new Promise(resolve => bridge.listen(port, '127.0.0.1', resolve));
  httpClient = new Client({ name: 'kitsuvo-http-qualification', version: '1.0.0' });
  await httpClient.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`)));
  const bridgedTools = (await httpClient.listTools()).tools;
  assert.deepEqual(bridgedTools.map(tool => tool.name).sort(), [...tools, ...appTools].map(tool => tool.name).sort());
  const resources = (await httpClient.listResources()).resources;
  assert.ok(resources.some(resource => resource.uri === APP_URI));
  const app = await httpClient.readResource({ uri: APP_URI });
  assert.ok(app.contents.some(content => content.text?.includes('<html') && !content.text.includes('/* BROWSER_APP */')));
  await call(httpClient, 'browser_navigate', { url: base });
  const snapshot = await call(httpClient, 'browser_snapshot');
  assert.match(JSON.stringify(snapshot.content), /Browser qualification/);
  await call(httpClient, 'kitsuvo_report');
  const panel = await call(httpClient, 'kitsuvo_browser', { url: base });
  assert.match(JSON.stringify(panel.structuredContent), /Browser qualification/);
  assert.equal(panel.structuredContent.tabs.length > 0, true);
  console.log(`Native MCP ${native.getServerVersion().version}: ${tools.length} native tools plus ${appTools.length} App tools, isolated profile, navigation, snapshot, report, responsive mode, sensitive-page refusal, HTTP forwarding and browser panel passed.`);
} finally {
  await httpClient?.close();
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
