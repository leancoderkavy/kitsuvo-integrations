import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, writeFile, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { APP_URI } from '../browser-app.mjs';

test('local stdio entry point serves native tools and the same inline app', { timeout: 15_000 }, async t => {
  const directory = await mkdtemp(join(tmpdir(), 'kitsuvo mcp app '));
  // The wrapper starts `<binary> mcp`; node resolves this fixture from cwd.
  await writeFile(join(directory, 'mcp'), `
    const readline = require('node:readline');
    process.stdin.on('end', () => process.exit(0));
    readline.createInterface({ input: process.stdin }).on('line', line => {
      const msg = JSON.parse(line); if (msg.id === undefined) return;
      let result = {};
      if (msg.method === 'initialize') result = { protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'native-fixture', version: '1' } };
      if (msg.method === 'tools/list') result = { tools: [{ name: 'browser_snapshot', inputSchema: { type: 'object' } }] };
      if (msg.method === 'tools/call') result = { content: [{ type: 'text', text: 'Native result' }] };
      console.log(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result }));
    });
  `);
  const client = new Client({ name: 'claude-desktop-fixture', version: '1' });
  t.after(async () => { await client.close(); await rm(directory, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 }); });
  await client.connect(new StdioClientTransport({ command: process.execPath,
    args: [fileURLToPath(new URL('../server.mjs', import.meta.url)), '--stdio'],
    cwd: directory, env: { KITSUVO_BINARY: process.execPath }, stderr: 'inherit' }));
  const identity = client.getServerVersion();
  assert.equal(identity.name, 'kitsuvo');
  assert.equal(identity.title, 'Kitsuvo');
  assert.equal(identity.icons[0].mimeType, 'image/png');
  assert.deepEqual(Buffer.from(identity.icons[0].src.split(',')[1], 'base64'),
    await readFile(new URL('../icon-256.png', import.meta.url)));
  const tools = (await client.listTools()).tools;
  assert.ok(tools.some(tool => tool.name === 'browser_snapshot'));
  assert.equal(tools.find(tool => tool.name === 'kitsuvo_browser')._meta.ui.resourceUri, APP_URI);
  const resource = (await client.readResource({ uri: APP_URI })).contents[0];
  assert.ok(resource.text.includes('id="preview"'));
  assert.equal((await client.callTool({ name: 'browser_snapshot', arguments: {} })).content[0].text, 'Native result');
});

test('the HTTP bridge reports a busy port clearly and exits before launching the native browser', { timeout: 15_000 }, async t => {
  const { createServer } = await import('node:http');
  const { spawn } = await import('node:child_process');
  const { once } = await import('node:events');
  const { existsSync } = await import('node:fs');
  const directory = await mkdtemp(join(tmpdir(), 'kitsuvo mcp port '));
  const marker = join(directory, 'native-started');
  await writeFile(join(directory, 'mcp'), `require('node:fs').writeFileSync(${JSON.stringify(marker)}, '1'); setTimeout(() => {}, 10000);`);
  const occupied = createServer();
  await new Promise(resolve => occupied.listen(0, '127.0.0.1', resolve));
  t.after(async () => { occupied.close(); await rm(directory, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 }); });
  const port = occupied.address().port;
  const child = spawn(process.execPath, [fileURLToPath(new URL('../server.mjs', import.meta.url))], { cwd: directory,
    env: { ...process.env, KITSUVO_BINARY: process.execPath, KITSUVO_MCP_PORT: String(port), KITSUVO_MCP_TOKEN: 'a'.repeat(43) } });
  let stderr = ''; child.stderr.on('data', chunk => { stderr += chunk; });
  const [code] = await once(child, 'exit');
  assert.equal(code, 1);
  assert.match(stderr, new RegExp(`Port ${port} on 127\\.0\\.0\\.1 is already in use`));
  assert.match(stderr, /KITSUVO_MCP_PORT/);
  assert.equal(existsSync(marker), false, 'no native browser was started');
});
