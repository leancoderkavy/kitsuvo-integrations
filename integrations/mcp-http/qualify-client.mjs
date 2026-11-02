// Opt-in, model-free qualification of the actual browser through an MCP client.
// All page content, profiles, targets and approvals belong to this disposable run.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport, getDefaultEnvironment } from '@modelcontextprotocol/sdk/client/stdio.js';
import { browserFunctionTools } from './function-tools.mjs';

const { values } = parseArgs({ options: { binary: { type: 'string' }, app: { type: 'boolean' }, output: { type: 'string' } } });
if (!values.binary || !path.isAbsolute(values.binary)) throw new Error('--binary must name the absolute browser executable.');
const profile = await mkdtemp(path.join(tmpdir(), 'kitsuvo-client-qualification-'));
await mkdir(path.join(profile, 'agent'));
await writeFile(path.join(profile, 'agent/state.json'), JSON.stringify({ settings_version: 4,
  settings: { local_only: true, auto_update: false, block_ai: false, spoof_warn: false, jev_auto: false, claude_auto: false } }));
const fixture = createServer((req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.end(`<title>Compatibility ${req.url}</title><h1>Owned fixture ${req.url}</h1><a href="/next">Next page</a>`);
});
await new Promise(resolve => fixture.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${fixture.address().port}`, clients = [], checks = [];
const check = (name, condition) => { assert.ok(condition, name); checks.push(name); };
const json = result => JSON.parse(result.content.find(item => item.type === 'text').text);
const call = async (client, name, arguments_ = {}) => {
  const result = await client.callTool({ name, arguments: arguments_ }, undefined, { timeout: 90_000 });
  assert.notEqual(result.isError, true, `Fixture tool failed: ${name}`); return result;
};
let result, status;
try {
  for (const name of ['compatibility-task-a', 'compatibility-task-b']) {
    const client = new Client({ name, version: '1' }); clients.push(client);
    await client.connect(new StdioClientTransport({ command: values.app ? process.execPath : values.binary,
      args: values.app ? [fileURLToPath(new URL('./server.mjs', import.meta.url)), '--stdio'] : ['mcp', '--separate-profile', '--headless'],
      env: { ...getDefaultEnvironment(), KITSUVO_PROFILE_DIR: profile, KITSUVO_BINARY: values.binary, KITSUVO_HEADLESS: '1' }, stderr: 'ignore' }));
    check(`${name}: critical instructions`, client.getInstructions().slice(0, 512).includes('uncertain mutations'));
    check(`${name}: tools discovered`, (await client.listTools()).tools.some(tool => tool.name === 'browser_find'));
  }
  const targets = [];
  for (const [index, client] of clients.entries()) {
    const url = `${base}/task-${index}`;
    await call(client, 'browser_navigate', { url });
    const match = json(await call(client, 'browser_find', { url }));
    check(`task-${index}: unique browser target`, match.code === 'MATCH' && typeof match.match?.browser === 'string');
    targets.push(match.match.browser);
    await call(client, 'browser_attach', { browser: targets[index] });
  }
  check('tasks retain different target selections', targets[0] !== targets[1]);
  for (const [index, client] of clients.entries()) {
    const browser = targets[index];
    const adapter = await browserFunctionTools(client, { browser,
      allowedTools: ['browser_snapshot', 'kitsuvo_report'],
      approve: async request => request.arguments.browser === browser && ['browser_snapshot', 'kitsuvo_report'].includes(request.name) });
    const observed = await adapter.call('browser_snapshot');
    check(`task-${index}: independent observed page`, JSON.stringify(observed.content).includes(`Owned fixture /task-${index}`));
    await adapter.call('kitsuvo_report'); check(`task-${index}: detection report`, true);
    await assert.rejects(adapter.call('browser_snapshot', { browser: targets[1 - index] }), /substitute/);
    check(`task-${index}: adapter cannot retarget`, true);
    status ??= json(await call(client, 'browser_status', { browser }));
    const denied = await client.callTool({ name: 'browser_navigate', arguments: { browser, url: 'https://accounts.google.com/' } });
    check(`task-${index}: protected sign-in refused`, denied.isError === true);
    if (values.app) {
      check(`task-${index}: App resource discovered`, (await client.listResources()).resources.some(resource => resource.uri === 'ui://kitsuvo/browser.html'));
      const resource = await client.readResource({ uri: 'ui://kitsuvo/browser.html' });
      check(`task-${index}: App resource bundled`, resource.contents.some(item => item.text?.includes('<html')));
    }
    adapter.close();
  }
  result = { passed: true, evidence: 'native MCP client and function adapter; no LLM/provider account',
    platform: process.platform, nativeVersion: status?.version, appMode: !!values.app, checks };
} catch (error) {
  result = { passed: false, platform: process.platform, appMode: !!values.app, checks, error: error.message };
  process.exitCode = 1;
} finally {
  await Promise.allSettled(clients.map(client => client.close()));
  fixture.closeAllConnections(); await new Promise(resolve => fixture.close(resolve));
  // Headless native MCP owns its spawned process and shuts it down on disconnect.
  // Retain this run's private directory for failure investigation, never read
  // or remove a user's normal profile or an unrelated browser's state.
  result.profile = profile;
  if (values.output) await writeFile(values.output, JSON.stringify(result, null, 2) + '\n', { mode: 0o600 });
  console.log(JSON.stringify(result));
}
