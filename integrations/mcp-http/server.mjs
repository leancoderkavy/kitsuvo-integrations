import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';
import { execFile } from 'node:child_process';
import { timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport, getDefaultEnvironment } from '@modelcontextprotocol/sdk/client/stdio.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema, ListResourcesRequestSchema, ReadResourceRequestSchema, ToolListChangedNotificationSchema } from '@modelcontextprotocol/sdk/types.js';
import { panelStore } from './panel-store.mjs';
import { APP_URI, APP_MIME, appTools, browserHtml, callBrowserApp } from './browser-app.mjs';
import { serveEmbed, embedSdk } from './embed-server.mjs';
import { operationQueue } from './operation-queue.mjs';
import { sessionHandler, bodyOf } from './sessions.mjs';
import { createSessions } from './protocol-sessions.mjs';

// SDK 1.32 parses the registered schema before its own tools/call validation,
// so malformed params surface as -32603. Register a method-only schema and let
// the SDK's wrapper reject bad params with -32602 (Invalid params).
const ToolCallRequestSchema = CallToolRequestSchema.pick({ method: true }).passthrough();

const catalogues = new WeakMap();
function cachedCatalogue(backend) {
  let cache = catalogues.get(backend);
  if (!cache) {
    cache = {}; catalogues.set(backend,cache);
    backend.setNotificationHandler?.(ToolListChangedNotificationSchema,()=>{cache.promise=undefined;});
  }
  return cache.promise ||= backend.listTools().catch(error=>{cache.promise=undefined;throw error;});
}

export function createAppServer(backend, serialize = (operation, options) => operation(options?.signal)) {
  const server = new Server(
    { name: 'kitsuvo', title: 'Kitsuvo', version: '0.2.3',
      icons: [{ src: `data:image/png;base64,${readFileSync(new URL('./icon-256.png', import.meta.url)).toString('base64')}`, mimeType: 'image/png', sizes: ['256x256'] }] },
    { capabilities: { tools: {}, resources: {} },
      instructions: `${backend.getInstructions?.() ?? ''}\nCall kitsuvo_browser to display the interactive browser inside chat. Native tools remain available for automation.` },
  );
  const tools = () => cachedCatalogue(backend);
  // Stdio and shared HTTP bridges reuse one native connection, which only saw
  // the bridge's own initialize. Name the upstream client on every call.
  const caller = () => {
    const info = server.getClientVersion();
    const name = [info?.title, info?.name].find(value => typeof value === 'string' && value.trim());
    return name ? { 'kitsuvo/client': name.trim().slice(0, 120) } : {};
  };
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    const result = await tools();
    return { ...result, tools: [...result.tools, ...appTools] };
  });
  server.setRequestHandler(ListResourcesRequestSchema, () => ({ resources: [
    { uri: APP_URI, name: 'kitsuvo-browser', title: 'Kitsuvo browser', mimeType: APP_MIME },
  ] }));
  server.setRequestHandler(ReadResourceRequestSchema, async request => {
    if (request.params.uri !== APP_URI) throw new Error('Unknown UI resource.');
    return { contents: [{ uri: APP_URI, mimeType: APP_MIME, text: await browserHtml(),
      _meta: { ui: { csp: { connectDomains: [], resourceDomains: [], frameDomains: [] }, prefersBorder: true } },
    }] };
  });
  server.setRequestHandler(ToolCallRequestSchema, (request, extra) => serialize((signal, remainingMs = () => 180000) =>
    appTools.some(tool => tool.name === request.params.name)
      ? callBrowserApp(backend, request.params.name, request.params.arguments, signal, caller())
      : backend.callTool({...request.params,_meta:{...request.params._meta,...caller(),'kitsuvo/deadlineMs':remainingMs()}}, undefined, { timeout: remainingMs(), signal }),
    { signal: extra.signal },
  ));
  return server;
}

const tokenPattern = /^[A-Za-z0-9_-]{43}$/;
function bridgeToken(value) {
  if (!tokenPattern.test(value || '')) throw new Error('HTTP access requires KITSUVO_MCP_TOKEN: a private 32-byte base64url credential. Configure the same bearer credential in your MCP client or tunnel. Stdio does not require it.');
  return value;
}
export function readConfig(env = process.env) {
  const port = Number(env.KITSUVO_MCP_PORT ?? 8787);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('KITSUVO_MCP_PORT must be an integer between 1 and 65535.');
  }
  if (env.KITSUVO_MCP_TOKEN !== undefined) bridgeToken(env.KITSUVO_MCP_TOKEN);
  return { port, binary: env.KITSUVO_BINARY || 'kitsuvo', headless: env.KITSUVO_HEADLESS === '1', token: env.KITSUVO_MCP_TOKEN };
}

export function createBridge(backend, { port = 8787, embed = false, token, createBackend, ...sessionOptions } = {}) {
  const expected = Buffer.from(`Bearer ${bridgeToken(token)}`);
  const hosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
  const origins = new Set([...hosts].map(host => `http://${host}`));
  const protocolSessions = createSessions();
  const queue = operationQueue();
  const serialize = (operation, options) => queue.run(operation, options);
  const sessions = createBackend && sessionHandler(createBackend, createAppServer, sessionOptions);
  const bridge = createServer(async (req, res) => {
    // Baseline for every response, including plain-text errors: nothing may be
    // framed, sniffed as markup or leak a referrer. The embed shell overrides CSP.
    res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");
    res.setHeader('Content-Type', 'text/plain; charset=utf-8'); res.setHeader('Content-Language', 'en');
    if (!hosts.has(req.headers.host) || (req.headers.origin && !origins.has(req.headers.origin))) {
      res.writeHead(403).end('Untrusted Host or Origin.');
      return;
    }
    // Public embed shell/SDK contain no browser state. Reading the panel resource
    // or dispatching an action requires the same credential as MCP initialization.
    const publicShell = embed && req.method === 'GET' && ['/embed', '/embed/sdk.js'].includes(req.url);
    if (!publicShell) {
      const supplied = Buffer.from(typeof req.headers.authorization === 'string' ? req.headers.authorization : '');
      if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
        res.writeHead(401, { 'WWW-Authenticate': 'Bearer realm="Kitsuvo local MCP"', 'Cache-Control': 'no-store' }).end('A local bridge credential is required.');
        return;
      }
    }
    if (embed && (req.url === '/embed' || req.url.startsWith('/embed/'))) {
      try { await serveEmbed(req, res, backend, serialize); }
      catch (error) {
        console.error('Kitsuvo embed request failed:', error.message);
        if (!res.headersSent) res.writeHead(500).end('Embed request failed.');
        else if (!res.writableEnded) res.end();
      }
      return;
    }
    if (req.url !== '/mcp') {
      res.writeHead(404).end('Use /mcp.');
      return;
    }
    if (sessions) {
      await sessions.handle(req, res);
      return;
    }
    let body;
    if (req.method === 'POST') { body = await bodyOf(req, res); if (res.writableEnded || res.destroyed) return; }
    try { await protocolSessions.handle(req,res,'local',()=>createAppServer(backend,serialize),body); }
    catch(error) {
      console.error('Kitsuvo MCP request failed:',error.message);
      if (!res.headersSent) res.writeHead(500).end('MCP bridge request failed.');
      else if (!res.writableEnded) res.end();
    }

  });
  bridge.requestTimeout = 30_000;
  bridge.headersTimeout = 10_000;
  bridge.closeSessions = () => sessions?.close() ?? Promise.resolve();
  bridge.once('close', () => { queue.close(); protocolSessions.close(); void bridge.closeSessions(); });
  return bridge;
}

export function nativeArguments(help, headless = false) {
  // Older shipped builds already isolate MCP by default and do not understand
  // the later explicit flag. Only recognize that documented legacy contract.
  const legacy = /(?:^|\n)\s*--agent[^\n]*separate profile/.test(help) && !help.includes('--separate-profile');
  if (legacy && headless && !help.includes('--headless')) throw new Error('This Kitsuvo build does not support headless mode. Update Kitsuvo or leave KITSUVO_HEADLESS unset.');
  return ['mcp', ...(legacy ? [] : ['--separate-profile']), ...(headless ? ['--headless'] : [])];
}

// The SDK's default environment drops host variables. Kitsuvo derives the
// session link from CODEX_THREAD_ID, so pass that through with the profile.
export function nativeEnvironment(env = process.env) {
  const passed = ['KITSUVO_PROFILE_DIR', 'CODEX_THREAD_ID'].filter(key => env[key]);
  return { ...getDefaultEnvironment(), ...Object.fromEntries(passed.map(key => [key, env[key]])) };
}

export async function createNativeBackend(config, clientInfo = { name: 'kitsuvo-http-bridge', version: '0.2.3' }) {
  const { stdout: help } = await promisify(execFile)(config.binary, ['--help'], { timeout: 5000, maxBuffer: 65536, windowsHide: true });
  // Keep the title: Kitsuvo's agent bar prefers it over the package name.
  const title = typeof clientInfo.title === 'string' && clientInfo.title.trim() ? { title: clientInfo.title } : {};
  const backend = new Client({ name: clientInfo.name || 'kitsuvo-http-bridge', version: clientInfo.version || '0', ...title });
  const transport = new StdioClientTransport({ command: config.binary, args: nativeArguments(help, config.headless), stderr: 'inherit',
    env: nativeEnvironment() });
  try {
    await backend.connect(transport, { timeout: 30_000 });
    if (process.env.KITSUVO_PANEL_STATE_FILE) backend._kitsuvoPanelRecovery = await panelStore(process.env.KITSUVO_PANEL_STATE_FILE, process.env.KITSUVO_PROFILE_DIR);
    return backend;
  }
  catch (error) { await backend.close(); throw error; }
}

async function main() {
  const config = readConfig();
  // Reject missing credentials before starting a browser/native backend.
  if (!process.argv.includes('--stdio')) bridgeToken(config.token);
  const backend = await createNativeBackend(config);
  try {
    // Bundle once before accepting connections, so build errors fail at startup.
    await browserHtml();
    if (process.argv.includes('--embed')) await embedSdk();
    if (process.argv.includes('--stdio')) {
      const queue = operationQueue();
      const server = createAppServer(backend, (operation, options) => queue.run(operation, options));
      await server.connect(new StdioServerTransport());
      const stop = () => { void server.close(); void backend.close(); };
      server.onclose = () => { void backend.close(); };
      process.stdin.once('end', stop);
      process.once('SIGINT', stop);
      process.once('SIGTERM', stop);
      return;
    }
    const bridge = createBridge(backend, { ...config, embed: process.argv.includes('--embed'), createBackend: info => createNativeBackend(config, info) });
    bridge.on('error', async error => {
      console.error(error.message);
      await backend.close();
      await bridge.closeSessions();
      process.exitCode = 1;
    });
    bridge.listen(config.port, '127.0.0.1', () => {
      console.error(`Kitsuvo MCP listening at http://127.0.0.1:${config.port}/mcp (bearer authentication required, including through a tunnel).`);
      if (process.argv.includes('--embed')) console.error(`Embed example: http://127.0.0.1:${config.port}/embed`);
    });
    const stop = () => {
      bridge.close();
      bridge.closeAllConnections();
      void backend.close();
      void bridge.closeSessions();
    };
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
  } catch (error) {
    await backend.close();
    throw error;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
