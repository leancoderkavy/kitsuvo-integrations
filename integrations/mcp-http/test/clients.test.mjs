import test from 'node:test';
import assert from 'node:assert/strict';
import { clients, clientConfiguration as config, relayUrl } from '../clients.mjs';

test('every remote recipe uses HTTPS and never launches a local process or contains a credential', () => {
  for (const client of Object.keys(clients)) {
    const output = config({ client, transport: 'remote' });
    const text = typeof output === 'string' ? output : JSON.stringify(output);
    assert.ok(text.includes(relayUrl), client);
    assert.doesNotMatch(text, /"command"|"args"|Bearer |clientSecret|access_token/);
    assert.throws(() => config({ client, transport: 'remote', binary: '/kitsuvo' }), /Remote/);
  }
});
test('client formats retain Windows/Mac absolute executable paths and the protected local default', () => {
  for (const binary of ['/Applications/Kitsuvo.app/Contents/MacOS/kitsuvo', 'C:\\Program Files\\Kitsuvo\\kitsuvo.exe']) {
    for (const [client, routes] of Object.entries(clients).filter(([, routes]) => routes.includes('local'))) {
      const output = config({ client, binary });
      const text = typeof output === 'string' ? output : JSON.stringify(output);
      assert.ok(text.includes(JSON.stringify(binary)), client);
      assert.doesNotMatch(text, /separate-profile|allow-sensitive|main-profile/);
      const isolated = config({ client, binary, isolated: true, profile: '/private/agent profile' });
      assert.ok(JSON.stringify(isolated).includes('--separate-profile'), client);
    }
  }
});
test('provider-specific keys cannot be mistaken for a generic mcpServers object', () => {
  assert.equal(config({ client: 'gemini', transport: 'remote' }).mcpServers.kitsuvo.httpUrl, relayUrl);
  assert.equal(config({ client: 'vscode', transport: 'remote' }).servers.kitsuvo.type, 'http');
  assert.equal(config({ client: 'opencode', binary: '/kitsuvo' }).mcp.kitsuvo.type, 'local');
  assert.match(config({ client: 'continue', binary: '/kitsuvo' }), /schema: v1/);
  assert.match(config({ client: 'codex', transport: 'remote' }), /^\[mcp_servers.kitsuvo\]/);
  assert.match(config({ client: 'grokbot' }).instructions, /account-wide/);
  assert.equal(config({ client: 'openai-api' }).tools[0].require_approval, 'always');
  assert.equal(config({ client: 'xai-api' }).tools[0].require_approval, undefined);
  assert.ok(config({ client: 'openai-api' }).tools[0].allowed_tools.includes('browser_navigate'));
  assert.ok(!config({ client: 'xai-api' }).tools[0].allowed_tools.includes('browser_navigate'));
  assert.ok(!config({ client: 'xai-api' }).tools[0].allowed_tools.includes('browser_run_script'));
});
test('unsafe and ambiguous configurations fail before producing installation metadata', () => {
  for (const binary of ['kitsuvo', '/path\ncommand', '/path\0']) assert.throws(() => config({ client: 'codex', binary }));
  for (const url of ['http://127.0.0.1/mcp', 'https://u:p@example.com/mcp', 'https://example.com/mcp?token=x', 'https://example.com/mcp#x'])
    assert.throws(() => config({ client: 'grokbot', url }));
  assert.throws(() => config({ client: 'grokbot', transport: 'local', binary: '/kitsuvo' }));
  assert.throws(() => config({ client: 'codex', binary: '/kitsuvo', profile: '/profile' }));
  assert.throws(() => config({ client: '__proto__' }));
});
