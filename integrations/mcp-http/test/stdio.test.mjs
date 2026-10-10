import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
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
  const tools = (await client.listTools()).tools;
  assert.ok(tools.some(tool => tool.name === 'browser_snapshot'));
  assert.equal(tools.find(tool => tool.name === 'kitsuvo_browser')._meta.ui.resourceUri, APP_URI);
  const resource = (await client.readResource({ uri: APP_URI })).contents[0];
  assert.ok(resource.text.includes('id="preview"'));
  assert.equal((await client.callTool({ name: 'browser_snapshot', arguments: {} })).content[0].text, 'Native result');
});
