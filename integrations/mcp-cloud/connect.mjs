import WebSocket from 'ws';
import { operationQueue } from './operation-queue.mjs';
import { createInterface } from 'node:readline';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { release as osRelease } from 'node:os';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { ToolListChangedNotificationSchema } from '@modelcontextprotocol/sdk/types.js';
import { StdioClientTransport, getDefaultEnvironment } from '@modelcontextprotocol/sdk/client/stdio.js';

// Cloud access is disclosed as using the isolated agent profile, but plain
// `kitsuvo mcp` uses the normal signed-in profile. Request isolation explicitly,
// like the HTTP bridge (keep identical to mcp-http nativeArguments). Older
// builds isolate MCP by default and do not understand the later flag.
export function nativeArguments(help = '', headless = false) {
  const legacy = /(?:^|\n)\s*--agent[^\n]*separate profile/.test(help) && !help.includes('--separate-profile');
  if (legacy && headless && !help.includes('--headless')) throw new Error('This Kitsuvo build does not support headless mode. Update Kitsuvo or leave KITSUVO_HEADLESS unset.');
  return ['mcp', ...(legacy ? [] : ['--separate-profile']), ...(headless ? ['--headless'] : [])];
}

// Cloud clients may reach only the isolated agent profile. macOS keeps one only
// from macOS 14 (Darwin 23); earlier releases would expose the signed-in
// profile, so the native browser refuses and the connector must not start.
export class ConnectorError extends Error {}
export const isolationMessage = 'Kitsuvo cloud access needs macOS 14 (Sonoma) or later. Cloud clients may only reach Kitsuvo\'s isolated agent profile, and macOS 13 and earlier cannot keep one, so connecting would expose your normal signed-in browser. Nothing was connected. Update macOS to use cloud access, or use local MCP on this Mac instead: `kitsuvo mcp` runs on this computer only and uses your normal signed-in profile.';
export function checkIsolationSupport(platform = process.platform, release = osRelease()) {
  if (platform === 'darwin' && Number.parseInt(release, 10) < 23) throw new ConnectorError(isolationMessage);
}

export function browserTransportConfig(env = process.env, app = false, help = '') {
  return {
    command: app ? process.execPath : env.KITSUVO_BINARY || 'kitsuvo',
    args: app ? [fileURLToPath(new URL('../mcp-http/server.mjs', import.meta.url)), '--stdio'] : nativeArguments(help, env.KITSUVO_HEADLESS === '1'),
    stderr: 'inherit',
    env: { ...getDefaultEnvironment(),
      ...(env.KITSUVO_HEADLESS === '1' ? { KITSUVO_HEADLESS: '1' } : {}),
      ...(env.KITSUVO_BINARY ? { KITSUVO_BINARY: env.KITSUVO_BINARY } : {}),
      ...(env.KITSUVO_PANEL_STATE_FILE ? { KITSUVO_PANEL_STATE_FILE: env.KITSUVO_PANEL_STATE_FILE } : {}),
      ...(env.KITSUVO_PROFILE_DIR ? { KITSUVO_PROFILE_DIR: env.KITSUVO_PROFILE_DIR } : {}),
    },
  };
}

const display = value => JSON.stringify(value).replace(/[\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, char => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`);

export function connectBrowser({ origin, backend, onMessage = () => {}, connectorKey }) {
  const url = new URL(origin);
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/' ||
      (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))) {
    throw new Error('Use an HTTPS relay origin, or explicit loopback HTTP for development.');
  }
  url.pathname = '/connect'; url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  if (connectorKey !== undefined && !/^[A-Za-z0-9_-]{43}$/.test(connectorKey)) throw new Error('Invalid connector identity.');
  const socket = new WebSocket(url, { headers: connectorKey ? { 'X-Kitsuvo-Connector-Key': connectorKey } : {}, maxPayload: 8 * 1024 * 1024, followRedirects: false });
  const queue = operationQueue(), requests = new Map();
  let tools;
  const catalogue = () => tools ??= backend.listTools().catch(error => { tools = undefined; throw error; });
  backend.setNotificationHandler?.(ToolListChangedNotificationSchema, () => { tools = undefined; });
  socket.on('close', () => { queue.close(); requests.clear(); });
  const send = value => { if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(value)); };
  socket.on('message', data => {
    let message;
    try { message = JSON.parse(data.toString()); } catch { socket.close(1008, 'Invalid message'); return; }
    if (message.type === 'cancel') { requests.get(message.id)?.abort(); return; }
    if (message.type !== 'call') { onMessage(message); return; }
    if (requests.has(message.id)) { socket.close(1008, 'Duplicate call'); return; }
    const request = new AbortController(); requests.set(message.id, request);
    queue.run(async (signal,remainingMs) => {
      try {
        let result;
        if (message.method === 'tools/list') result = await catalogue();
        else if (message.method === 'resources/list') {
          result = backend.listResources && backend.getServerCapabilities?.()?.resources
            ? await backend.listResources() : { resources: [] };
        } else if (message.method === 'resources/read') {
          const catalog = backend.listResources && backend.getServerCapabilities?.()?.resources
            ? await backend.listResources() : { resources: [] };
          if (!catalog.resources.some(resource => resource.uri === message.params?.uri)) throw new Error('Unknown browser resource.');
          result = await backend.readResource(message.params);
        }
        else if (message.method === 'tools/call') {
          const catalog = await catalogue();
          signal.throwIfAborted();
          if (!catalog.tools.some(tool => tool.name === message.params?.name)) throw new Error('Unknown tool');
          result = await backend.callTool({...message.params,_meta:{...message.params?._meta,'kitsuvo/deadlineMs':remainingMs()}}, undefined, { timeout:remainingMs(),signal });
        } else throw new Error('Unsupported operation');
        send({ type: 'result', id: message.id, result });
      } catch { send({ type: 'result', id: message.id, error: 'Browser request failed.' }); }
    }, { signal: request.signal, timeoutMs: message.deadlineMs ?? 180000 }).catch(() => send({ type: 'result', id: message.id, error: 'Browser request cancelled or deadline exceeded.' })).finally(() => requests.delete(message.id));
  });
  return { socket, review: id => send({ type: 'review', id }), approve: id => send({ type: 'approve', id }), revoke: () => send({ type: 'revoke' }) };
}

async function main() {
  checkIsolationSupport();
  const origin = process.env.KITSUVO_CLOUD_ORIGIN;
  if (!origin) throw new ConnectorError('Set KITSUVO_CLOUD_ORIGIN to the trusted relay origin, for example https://kitsuvo-mcp-relay.fly.dev.');
  if (!process.stdin.isTTY) throw new ConnectorError('Cloud connection requires an interactive terminal for browser-access consent. Run it in Terminal (macOS) or PowerShell (Windows), not from a script or service.');
  const terminal = createInterface({ input: process.stdin, output: process.stderr });
  const ask = prompt => new Promise(resolve => terminal.question(prompt, resolve));
  console.error('Cloud access forwards selected tool arguments, page snapshots and reports to the relay and your authorized MCP client.\nIt uses Kitsuvo\'s isolated agent profile. Closing this connector revokes its grants.');
  if ((await ask(`Connect to ${new URL(origin).origin}? Type CONNECT: `)) !== 'CONNECT') { terminal.close(); return; }
  const backend = new Client({ name: 'kitsuvo-cloud-connector', version: '0.1.0' });
  const app = process.argv.includes('--app');
  const help = app ? '' : (await promisify(execFile)(process.env.KITSUVO_BINARY || 'kitsuvo', ['--help'], { timeout: 5000, maxBuffer: 65536, windowsHide: true })).stdout;
  const native = new StdioClientTransport(browserTransportConfig(process.env, app, help));
  let connection, stopping = false, approvalPending = false;
  const stop = async () => {
    if (stopping) return; stopping = true;
    connection?.socket.close(); terminal.close(); await backend.close();
  };
  try {
    await backend.connect(native);
    connection = connectBrowser({ origin, backend, onMessage: async message => {
      if (message.type === 'connected') console.error('Connected. When linking an MCP client, type: approve <code shown by the relay>');
      else if (message.type === 'review') {
        if (approvalPending) return;
        approvalPending = true;
        // JSON quoting prevents untrusted client metadata from writing terminal
        // control characters. Never print token, native control key or page data.
        console.error(`Client: ${display(message.clientName)}\nRedirect: ${display(message.redirectUri)}\nPermission: navigate, manage tabs, click, type, run page JavaScript, and read snapshots, reports and supported screenshots in your isolated agent profile.`);
        if ((await ask('Grant this client access? Type APPROVE: ')) === 'APPROVE') connection.approve(message.id);
        approvalPending = false;
      } else if (message.type === 'approved') console.error('Approved. Refresh the authorization page to finish linking.');
      else if (message.type === 'rejected') console.error('Approval expired or already used. Restart linking.');
    } });
    connection.socket.on('close', code => {
      // 1012: the relay is restarting (deploy or maintenance), not a local fault.
      console.error(code === 1012 ? 'The relay is restarting, so this temporary connection ended and its grants were revoked. Start the connector again in a minute and re-approve your client.' : 'Relay disconnected; browser grants revoked.');
      void stop();
    });
    connection.socket.on('error', () => { console.error('Relay connection failed.'); void stop(); });
    terminal.on('line', line => {
      if (approvalPending) return;
      const match = /^approve ([A-Za-z0-9_-]{43})$/.exec(line.trim());
      if (match) connection.review(match[1]);
      else console.error('Use: approve <authorization code>');
    });
    process.once('SIGINT', () => { void stop(); });
    process.once('SIGTERM', () => { void stop(); });
  } catch (error) { await stop(); throw error; }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  // Only messages written for users are shown; other errors may carry paths or relay detail.
  main().catch(error => { console.error(error instanceof ConnectorError ? error.message : 'Cloud connector failed. Check the trusted relay URL and installed Kitsuvo executable.'); process.exitCode = 1; });
}
