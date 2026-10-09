import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

// No public bind or arbitrary command-line arguments: the tunnel authenticates
// remote clients, while Kitsuvo keeps its own control API token local.
export function readConfig(env = process.env) {
  const port = Number(env.KITSUVO_MCP_PORT ?? 8787);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('KITSUVO_MCP_PORT must be an integer between 1 and 65535.');
  }
  return { port, binary: env.KITSUVO_BINARY || 'kitsuvo' };
}

export function createBridge(backend, { port = 8787 } = {}) {
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
    if (req.url !== '/mcp') {
      res.writeHead(404).end('Use /mcp.');
      return;
    }
    if (req.method !== 'POST') {
      res.writeHead(405, { Allow: 'POST' }).end('Stateless MCP uses POST.');
      return;
    }
    const server = new Server(
      { name: 'kitsuvo', title: 'Kitsuvo browser', version: '0.2.3' },
      { capabilities: { tools: {} }, instructions: backend.getInstructions?.() },
    );
    server.setRequestHandler(ListToolsRequestSchema, () => backend.listTools());
    server.setRequestHandler(CallToolRequestSchema, request => serialize(() =>
      backend.callTool(request.params, undefined, { timeout: 180_000 }),
    ));
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
  const transport = new StdioClientTransport({ command: config.binary, args: ['mcp'], stderr: 'inherit' });
  try {
    await backend.connect(transport);
    const bridge = createBridge(backend, config);
    bridge.on('error', async error => {
      console.error(error.message);
      await backend.close();
      process.exitCode = 1;
    });
    bridge.listen(config.port, '127.0.0.1', () => {
      console.error(`Kitsuvo MCP listening at http://127.0.0.1:${config.port}/mcp (Secure MCP Tunnel only).`);
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
