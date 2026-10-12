import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport, getDefaultEnvironment } from '@modelcontextprotocol/sdk/client/stdio.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema, ListResourcesRequestSchema, ReadResourceRequestSchema, ToolListChangedNotificationSchema } from '@modelcontextprotocol/sdk/types.js';
import { APP_URI, APP_MIME, appTools, browserHtml, callBrowserApp } from './browser-app.mjs';
import { serveEmbed, embedSdk } from './embed-server.mjs';
import { operationQueue } from './operation-queue.mjs';
import { sessionHandler } from './sessions.mjs';
import { createSessions } from './protocol-sessions.mjs';

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
    { name: 'kitsuvo', title: 'Kitsuvo browser', version: '0.2.3' },
    { capabilities: { tools: {}, resources: {} },
      instructions: `${backend.getInstructions?.() ?? ''}\nCall kitsuvo_browser to display the interactive browser inside chat. Native tools remain available for automation.` },
  );
  const tools = () => cachedCatalogue(backend);
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
  server.setRequestHandler(CallToolRequestSchema, (request, extra) => serialize((signal, remainingMs = () => 180000) =>
    appTools.some(tool => tool.name === request.params.name)
      ? callBrowserApp(backend, request.params.name, request.params.arguments, signal)
      : backend.callTool({...request.params,_meta:{...request.params._meta,'kitsuvo/deadlineMs':remainingMs()}}, undefined, { timeout: remainingMs(), signal }),
    { signal: extra.signal },
  ));
  return server;
}

// No public bind or arbitrary command-line arguments: the tunnel authenticates
// remote clients, while Kitsuvo keeps its own control API token local.
export function readConfig(env = process.env) {
  const port = Number(env.KITSUVO_MCP_PORT ?? 8787);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('KITSUVO_MCP_PORT must be an integer between 1 and 65535.');
  }
  return { port, binary: env.KITSUVO_BINARY || 'kitsuvo', headless: env.KITSUVO_HEADLESS === '1' };
}

export function createBridge(backend, { port = 8787, embed = false, createBackend, ...sessionOptions } = {}) {
  const hosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
  const origins = new Set([...hosts].map(host => `http://${host}`));
  const protocolSessions = createSessions();
  const queue = operationQueue();
  const serialize = (operation, options) => queue.run(operation, options);
  const sessions = createBackend && sessionHandler(createBackend, createAppServer, sessionOptions);
  const bridge = createServer(async (req, res) => {
    if (!hosts.has(req.headers.host) || (req.headers.origin && !origins.has(req.headers.origin))) {
      res.writeHead(403).end('Untrusted Host or Origin.');
      return;
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
    try { await protocolSessions.handle(req,res,'local',()=>createAppServer(backend,serialize)); }
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

export async function createNativeBackend(config, clientInfo = { name: 'kitsuvo-http-bridge', version: '0.2.3' }) {
  const backend = new Client({ name: clientInfo.name, version: clientInfo.version });
  const transport = new StdioClientTransport({ command: config.binary, args: ['mcp', '--separate-profile', ...(config.headless ? ['--headless'] : [])], stderr: 'inherit',
    env: { ...getDefaultEnvironment(), ...(process.env.KITSUVO_PROFILE_DIR ? { KITSUVO_PROFILE_DIR: process.env.KITSUVO_PROFILE_DIR } : {}) },
  });
  try { await backend.connect(transport, { timeout: 30_000 }); return backend; }
  catch (error) { await backend.close(); throw error; }
}

async function main() {
  const config = readConfig();
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
      console.error(`Kitsuvo MCP listening at http://127.0.0.1:${config.port}/mcp (Secure MCP Tunnel only).`);
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
