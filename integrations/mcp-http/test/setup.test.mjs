import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hostConfiguration } from '../setup.mjs';

test('local hosts use the UI bridge with preserved Windows and Mac paths', () => {
  for (const host of ['cursor', 'claude', 't3code']) {
    for (const paths of [
      { binary: '/Applications/Kitsuvo.app/Contents/MacOS/kitsuvo', node: '/usr/local/bin/node', bridge: '/Users/test/My Integrations/server.mjs', profile: '/Users/test/Agent profile' },
      { binary: 'C:\\Program Files\\Kitsuvo\\kitsuvo.exe', node: 'C:\\Program Files\\nodejs\\node.exe', bridge: 'D:\\My Integrations\\server.mjs', profile: 'D:\\Agent profile' },
    ]) {
      const result = hostConfiguration({ host, provider: 'claude', ...paths });
      assert.deepEqual(result.mcpServers.kitsuvo, { command: paths.node, args: [paths.bridge, '--stdio'],
        env: { KITSUVO_BINARY: paths.binary, KITSUVO_PROFILE_DIR: paths.profile } });
    }
  }
});

test('T3 Code Codex provider receives TOML for its configured Codex home', () => {
  const config = hostConfiguration({ host: 't3code', binary: 'C:\\Program Files\\Kitsuvo\\kitsuvo.exe',
    node: 'C:\\node.exe', bridge: 'D:\\bridge\\server.mjs' });
  assert.match(config, /^\[mcp_servers.kitsuvo\]/);
  assert.match(config, /--stdio/);
  assert.equal(JSON.parse(config.match(/^KITSUVO_BINARY = (.+)$/m)[1]), 'C:\\Program Files\\Kitsuvo\\kitsuvo.exe');
});

test('ChatGPT setup requires authenticated remote MCP and app mode', () => {
  const result = hostConfiguration({ host: 'chatgpt' });
  assert.equal(result.authentication, 'OAuth');
  assert.equal(result.connectorMode, '--app');
  for (const url of ['http://localhost:8787/mcp', 'https://user:secret@example.com/mcp', 'https://example.com/mcp?token=secret'])
    assert.throws(() => hostConfiguration({ host: 'chatgpt', url }));
});

test('configuration rejects unsupported hosts, providers and relative paths', () => {
  assert.throws(() => hostConfiguration({ host: 'unknown' }));
  assert.throws(() => hostConfiguration({ host: 'cursor', binary: 'kitsuvo' }), /absolute/);
  assert.throws(() => hostConfiguration({ host: 't3code', binary: '/kitsuvo', provider: 'unknown' }), /provider/);
});
