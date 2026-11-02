// Reviewable host configurations. Never writes client settings or starts a server.
import path from 'node:path';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';

export const starterTools = Object.freeze(['browser_windows', 'browser_find', 'browser_attach', 'browser_status', 'browser_navigate', 'browser_snapshot', 'kitsuvo_report', 'browser_session', 'browser_cleanup']);
export const readTools = Object.freeze(['browser_windows', 'browser_find', 'browser_attach', 'browser_status', 'browser_snapshot', 'kitsuvo_report']);
export const relayUrl = 'https://kitsuvo-mcp-relay.fly.dev/mcp';
export const clients = Object.freeze({
  codex: ['local', 'remote'], 'claude-code': ['local', 'remote'],
  'claude-desktop': ['local', 'remote'], cursor: ['local', 'remote'],
  gemini: ['local', 'remote'], vscode: ['local', 'remote'], copilot: ['local', 'remote'],
  cline: ['local', 'remote'], continue: ['local', 'remote'], 'lm-studio': ['local', 'remote'],
  opencode: ['local', 'remote'], openclaw: ['local', 'remote'],
  grokbot: ['remote'], chatgpt: ['remote'], 'claude-web': ['remote'],
  'openai-api': ['remote'], 'xai-api': ['remote'], 'claude-api': ['remote'],
  n8n: ['remote'], dify: ['remote'],
});
const absolute = value => typeof value === 'string' && value.length > 0 &&
  (path.posix.isAbsolute(value) || path.win32.isAbsolute(value)) && !/[\r\n\0]/.test(value);

export function remoteEndpoint(value = relayUrl) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash)
    throw new Error('Use an HTTPS MCP URL without credentials, query parameters or fragments.');
  return url.href;
}

export function clientConfiguration({ client, transport, binary, profile, isolated = false, url } = {}) {
  if (!Object.hasOwn(clients, client)) throw new Error('Unknown client. Use --list to see supported configuration formats.');
  transport ??= clients[client][0];
  if (!clients[client].includes(transport)) throw new Error(`${client} needs remote MCP; it cannot launch your desktop executable.`);
  const remote = transport === 'remote';
  if (remote && (binary !== undefined || profile !== undefined || isolated))
    throw new Error('Remote clients use a URL. Configure the isolated browser on the connector host.');
  if (!remote && (!absolute(binary) || (profile !== undefined && !absolute(profile))))
    throw new Error('Local binary and optional profile paths must be absolute.');
  if (!remote && url !== undefined) throw new Error('Local stdio uses an executable, not a remote URL.');
  if (profile !== undefined && !isolated) throw new Error('A custom adapter profile requires explicit isolated mode.');
  const endpoint = remote ? remoteEndpoint(url) : undefined;
  const args = ['mcp', ...(isolated ? ['--separate-profile'] : [])];
  const env = profile ? { KITSUVO_PROFILE_DIR: profile } : undefined;
  const local = { command: binary, args, ...(env ? { env } : {}) };
  const entry = remote ? { url: endpoint } : local;
  if (client === 'codex') {
    return '[mcp_servers.kitsuvo]\n' + (remote ? `url = ${JSON.stringify(endpoint)}\n` :
      `command = ${JSON.stringify(binary)}\nargs = ${JSON.stringify(args)}\n`) +
      (env ? `\n[mcp_servers.kitsuvo.env]\nKITSUVO_PROFILE_DIR = ${JSON.stringify(profile)}\n` : '');
  }
  if (client === 'gemini') return { mcpServers: { kitsuvo: remote ? { httpUrl: endpoint } : local } };
  if (client === 'vscode') return { servers: { kitsuvo: { type: remote ? 'http' : 'stdio', ...entry } } };
  if (client === 'continue') return 'name: Kitsuvo\nversion: 1.0.0\nschema: v1\nmcpServers:\n  - name: kitsuvo\n' +
    (remote ? `    type: streamable-http\n    url: ${JSON.stringify(endpoint)}\n` :
      `    command: ${JSON.stringify(binary)}\n    args: ${JSON.stringify(args)}\n`) +
    (env ? `    env:\n      KITSUVO_PROFILE_DIR: ${JSON.stringify(profile)}\n` : '');
  if (client === 'opencode') return { mcp: { kitsuvo: remote ? { type: 'remote', url: endpoint, oauth: true } :
    { type: 'local', command: [binary, ...args], ...(env ? { environment: env } : {}) } } };
  if (client === 'openclaw') return { mcp: { servers: { kitsuvo: remote ?
    { transport: 'streamable-http', url: endpoint, auth: 'oauth' } : { transport: 'stdio', ...local } } } };
  if (['grokbot', 'chatgpt', 'claude-web', 'n8n', 'dify'].includes(client)) return {
    url: endpoint, authentication: 'OAuth',
    instructions: client === 'grokbot'
      ? 'Add an MCP server by URL in Grok Bot, finish OAuth, and approve its request in Kitsuvo Settings > Assistants > Remote access. Attach Kitsuvo to the task. Connections are account-wide across your Bots. Do not install the local stdio variant on its cloud computer.'
      : client === 'claude-web'
        ? 'Add a remote connector, use Sign in and Register automatically, then approve its request in Kitsuvo Remote access. Team policy may require an administrator.'
        : client === 'chatgpt'
          ? 'Add this custom MCP server in Plugins and finish OAuth; approve its request in Kitsuvo Remote access. An in-chat panel separately requires the App-mode connector and a compatible host.'
          : 'Add the remote MCP URL with OAuth in the workflow tool settings. Qualify the installed client version, Streamable HTTP, refresh, workflow access and browser-host availability before scheduling.',
  };
  if (client === 'openai-api' || client === 'xai-api') return { tools: [{ type: 'mcp', server_label: 'kitsuvo',
    server_url: endpoint, allowed_tools: [...(client === 'openai-api' ? starterTools : readTools)], ...(client === 'openai-api' ? { require_approval: 'always' } : {}) }],
    setup: 'Your application supplies the authorized user OAuth access token at runtime, refreshes it securely and restricts allowed_tools. Never put a token in this file or a prompt. xAI does not implement require_approval; this recipe exposes observation/target selection only. Use the function adapter with application approval for page changes.' };
  if (client === 'claude-api') return { mcp_servers: [{ type: 'url', name: 'kitsuvo', url: endpoint }],
    setup: 'Supply the authorized user authorization_token at runtime, enable the documented MCP toolset for your API version, and gate actions in your application. This is connection metadata, not a complete model request.' };
  return { mcpServers: { kitsuvo: entry } };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const { values } = parseArgs({ options: {
      ...Object.fromEntries(['client', 'transport', 'binary', 'profile', 'url'].map(name => [name, { type: 'string' }])),
      list: { type: 'boolean' }, isolated: { type: 'boolean', default: false },
    } });
    const result = values.list ? clients : clientConfiguration(values);
    process.stdout.write(typeof result === 'string' ? result : JSON.stringify(result, null, 2) + '\n');
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
