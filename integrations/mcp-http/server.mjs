import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport, getDefaultEnvironment } from '@modelcontextprotocol/sdk/client/stdio.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema, ListResourcesRequestSchema, ReadResourceRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { APP_URI, APP_MIME, appTools, browserHtml, callBrowserApp } from './browser-app.mjs';
import { serveEmbed, embedSdk } from './embed-server.mjs';

export function createAppServer(backend, serialize = operation => operation()) {
  const server = new Server(
    { name: 'kitsuvo', title: 'Kitsuvo browser', version: '0.2.3' },
    { capabilities: { tools: {}, resources: {} },
      instructions: `${backend.getInstructions?.() ?? ''}\nCall kitsuvo_browser to display the interactive browser inside chat. Native tools remain available for automation.` },
  );
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    const result = await backend.listTools();
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
  server.setRequestHandler(CallToolRequestSchema, request => serialize(() =>
    appTools.some(tool => tool.name === request.params.name)
      ? callBrowserApp(backend, request.params.name, request.params.arguments)
      : backend.callTool(request.params, undefined, { timeout: 180_000 }),
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
  return { port, binary: env.KITSUVO_BINARY || 'kitsuvo' };
}

export function createBridge(backend, { port = 8787, embed = false } = {}) {
  const hosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
  const origins = new Set([...hosts].map(host => `http://${host}`));
  let queue = Promise.resolve();
  const serialize = operation => {
    const result = queue.then(operation);
    queue = result.catch(() => {});
    return result;
  };
  return createServer(async (req, res) => {
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
    if (req.method !== 'POST') {
      res.writeHead(405, { Allow: 'POST' }).end('Stateless MCP uses POST.');
      return;
    }
    const server = createAppServer(backend, serialize);
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    res.on('close', () => { void server.close().catch(() => {}); });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res);
    } catch (error) {
      console.error('Kitsuvo MCP request failed:', error.message);
      if (!res.headersSent) res.writeHead(500).end('MCP bridge request failed.');
      else if (!res.writableEnded) res.end();
      await server.close();
    }
  });
}

async function main() {
  const config = readConfig();
  const backend = new Client({ name: 'kitsuvo-http-bridge', version: '0.2.3' });
  const transport = new StdioClientTransport({ command: config.binary, args: ['mcp'], stderr: 'inherit',
    env: { ...getDefaultEnvironment(), ...(process.env.KITSUVO_PROFILE_DIR ? { KITSUVO_PROFILE_DIR: process.env.KITSUVO_PROFILE_DIR } : {}) },
  });
  try {
    await backend.connect(transport);
    // Bundle once before accepting connections, so build errors fail at startup.
    await browserHtml();
    if (process.argv.includes('--embed')) await embedSdk();
    if (process.argv.includes('--stdio')) {
      let queue = Promise.resolve();
      const server = createAppServer(backend, operation => {
        const result = queue.then(operation);
        queue = result.catch(() => {});
        return result;
      });
      await server.connect(new StdioServerTransport());
      const stop = () => { void server.close(); void backend.close(); };
      server.onclose = () => { void backend.close(); };
      process.stdin.once('end', stop);
      process.once('SIGINT', stop);
      process.once('SIGTERM', stop);
      return;
    }
    const bridge = createBridge(backend, { ...config, embed: process.argv.includes('--embed') });
    bridge.on('error', async error => {
      console.error(error.message);
      await backend.close();
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
