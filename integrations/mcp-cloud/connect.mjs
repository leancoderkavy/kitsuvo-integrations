import WebSocket from 'ws';
import { createInterface } from 'node:readline';
import { pathToFileURL } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const display = value => JSON.stringify(value).replace(/[\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, char => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`);

export function connectBrowser({ origin, backend, onMessage = () => {} }) {
  const url = new URL(origin);
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/' ||
      (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))) {
    throw new Error('Use an HTTPS relay origin, or explicit loopback HTTP for development.');
  }
  url.pathname = '/connect'; url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  const socket = new WebSocket(url, { maxPayload: 8 * 1024 * 1024, followRedirects: false });
  let queue = Promise.resolve();
  const send = value => { if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(value)); };
  socket.on('message', data => {
    let message;
    try { message = JSON.parse(data.toString()); } catch { socket.close(1008, 'Invalid message'); return; }
    if (message.type !== 'call') { onMessage(message); return; }
    queue = queue.then(async () => {
      try {
        let result;
        if (message.method === 'tools/list') result = await backend.listTools();
        else if (message.method === 'tools/call') {
          const catalog = await backend.listTools();
          if (!catalog.tools.some(tool => tool.name === message.params?.name)) throw new Error('Unknown tool');
          result = await backend.callTool(message.params, undefined, { timeout: 180000 });
        } else throw new Error('Unsupported operation');
        send({ type: 'result', id: message.id, result });
      } catch { send({ type: 'result', id: message.id, error: 'Browser request failed.' }); }
    });
  });
  return { socket, review: id => send({ type: 'review', id }), approve: id => send({ type: 'approve', id }) };
}

async function main() {
  const origin = process.env.KITSUVO_CLOUD_ORIGIN;
  if (!origin) throw new Error('Set KITSUVO_CLOUD_ORIGIN to the trusted relay origin.');
  if (!process.stdin.isTTY) throw new Error('Cloud connection requires an interactive terminal for browser-access consent.');
  const terminal = createInterface({ input: process.stdin, output: process.stderr });
  const ask = prompt => new Promise(resolve => terminal.question(prompt, resolve));
  console.error('Cloud access forwards selected tool arguments, page snapshots and reports to the relay and your authorized MCP client.\nIt uses Kitsuvo\'s isolated agent profile. Closing this connector revokes its grants.');
  if ((await ask(`Connect to ${new URL(origin).origin}? Type CONNECT: `)) !== 'CONNECT') { terminal.close(); return; }
  const backend = new Client({ name: 'kitsuvo-cloud-connector', version: '0.1.0' });
  const native = new StdioClientTransport({ command: process.env.KITSUVO_BINARY || 'kitsuvo', args: ['mcp'], stderr: 'inherit' });
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
    connection.socket.on('close', () => { console.error('Relay disconnected; browser grants revoked.'); void stop(); });
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
  main().catch(() => { console.error('Cloud connector failed. Check the trusted relay URL and installed Kitsuvo executable.'); process.exitCode = 1; });
}
