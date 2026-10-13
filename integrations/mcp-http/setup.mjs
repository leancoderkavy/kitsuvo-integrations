import { parseArgs } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const hosts = ['chatgpt', 'claude', 'cursor', 't3code'];
const absolute = value => typeof value === 'string' && value.length > 0 &&
  (path.posix.isAbsolute(value) || path.win32.isAbsolute(value)) && !/[\r\n\0]/.test(value);

// Prints a reviewable configuration; never overwrites the host's other servers.
export function hostConfiguration({ host, binary, profile, provider = 'codex',
  node = process.execPath, bridge = fileURLToPath(new URL('./server.mjs', import.meta.url)), url } = {}) {
  if (!hosts.includes(host)) throw new Error(`Host must be ${hosts.join(', ')}.`);
  if (host === 'chatgpt') {
    const endpoint = new URL(url || 'https://kitsuvo-mcp-relay.fly.dev/mcp');
    if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password || endpoint.search || endpoint.hash)
      throw new Error('Use an HTTPS MCP endpoint without credentials, query, or fragment.');
    return { url: endpoint.href, authentication: 'OAuth', connectorMode: '--app',
      instructions: 'Start the cloud connector with --app, approve this client in its terminal, then add this URL as a custom ChatGPT MCP app. Ask: Open Kitsuvo in chat.' };
  }
  if (![binary, node, bridge].every(absolute) || (profile !== undefined && !absolute(profile)))
    throw new Error('Binary, Node, bridge, and optional profile paths must be absolute.');
  if (host === 't3code' && !['codex', 'claude'].includes(provider)) throw new Error('T3 Code provider must be codex or claude.');
  const entry = { command: node, args: [bridge, '--stdio'],
    env: { KITSUVO_BINARY: binary, ...(profile ? { KITSUVO_PROFILE_DIR: profile } : {}) } };
  if (host === 't3code' && provider === 'codex') {
    // JSON basic strings are valid TOML basic strings for these validated paths.
    return `[mcp_servers.kitsuvo]\ncommand = ${JSON.stringify(entry.command)}\nargs = ${JSON.stringify(entry.args)}\n\n[mcp_servers.kitsuvo.env]\n` +
      Object.entries(entry.env).map(([key, value]) => `${key} = ${JSON.stringify(value)}\n`).join('');
  }
  return { mcpServers: { kitsuvo: entry } };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const { values } = parseArgs({ options: Object.fromEntries(
      ['host', 'binary', 'profile', 'provider', 'node', 'bridge', 'url'].map(name => [name, { type: 'string' }])) });
    const result = hostConfiguration(values);
    process.stdout.write(typeof result === 'string' ? result : JSON.stringify(result, null, 2) + '\n');
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
