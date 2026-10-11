import { randomUUID } from 'node:crypto';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { InitializeRequestSchema, JSONRPCRequestSchema } from '@modelcontextprotocol/sdk/types.js';

// Keep panel state collection atomic within a connection, without making
// another LLM wait for that connection's navigation or evaluation.
export function operationQueue(limit = 32) {
  let tail = Promise.resolve(), pending = 0, closed = false;
  return {
    run(operation) {
      if (closed || pending >= limit) return Promise.reject(new Error(closed ? 'MCP session closed.' : 'MCP session is busy. Retry after pending requests finish.'));
      pending++;
      const result = tail.then(() => {
        if (closed) throw new Error('MCP session closed.');
        return operation();
      });
      tail = result.catch(() => {}).finally(() => { pending--; });
      return result;
    },
    close() { closed = true; },
  };
}

const MAX_BODY = 1 << 20;
const reject = (res, status, message) => res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
  .end(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32000, message } }));

async function bodyOf(req, res) {
  const chunks = []; let size = 0;
  try {
    for await (const chunk of req.iterator({ destroyOnReturn: false })) {
      size += chunk.length;
      if (size > MAX_BODY) { req.resume(); reject(res, 413, 'MCP request is too large.'); return; }
      chunks.push(chunk);
    }
  } catch {
    if (!res.destroyed) reject(res, 400, 'Incomplete MCP request.');
    return;
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { reject(res, 400, 'Invalid JSON.'); }
}

export function sessionHandler(createBackend, createAppServer, { maxSessions = 16, idleMs = 600_000, maxPending = 32 } = {}) {
  for (const [key, value] of Object.entries({ maxSessions, idleMs, maxPending })) {
    if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${key} must be a positive integer.`);
  }
  const sessions = new Map();
  let stopping = false;

  function dispose(session) {
    if (session.closing) return session.closing;
    session.queue.close();
    // Reserve the slot until backend startup/cleanup finishes too.
    session.closing = Promise.resolve().then(async () => {
      await session.startup?.catch(() => {});
      await Promise.allSettled([session.server?.close(), session.backend?.close()]);
      sessions.delete(session.id);
    });
    return session.closing;
  }

  const sweep = () => {
    const now = Date.now();
    for (const session of sessions.values()) {
      if (!session.active && now - session.lastUsed >= idleMs) void dispose(session);
    }
  };
  const timer = setInterval(sweep, Math.min(idleMs, 30_000));
  timer.unref();

  return {
    async handle(req, res) {
      if (stopping) return reject(res, 503, 'MCP bridge is shutting down.');
      if (!['POST', 'DELETE'].includes(req.method)) {
        res.setHeader('Allow', 'POST, DELETE');
        return reject(res, 405, 'Use POST for MCP requests or DELETE to end a session.');
      }
      const id = req.headers['mcp-session-id'];
      let session = id && sessions.get(id);
      if (id && (!session || session.closing)) return reject(res, 404, 'MCP session not found. Initialize a new connection.');
      if (!id && req.method !== 'POST') return reject(res, 400, 'Mcp-Session-Id is required.');
      let body;
      if (req.method === 'POST') {
        if (req.headers['content-type']?.split(';')[0].trim() !== 'application/json') return reject(res, 415, 'Expected application/json.');
        const accept = req.headers.accept ?? '';
        if (!accept.includes('application/json') || !accept.includes('text/event-stream')) return reject(res, 406, 'Accept application/json and text/event-stream.');
        body = await bodyOf(req, res);
        if (res.writableEnded || res.destroyed) return;
      }
      if (!session) {
        if (!JSONRPCRequestSchema.safeParse(body).success || !InitializeRequestSchema.safeParse(body).success) {
          return reject(res, 400, 'Initialize an MCP connection before calling tools.');
        }
        if (sessions.size >= maxSessions) return reject(res, 503, 'MCP session limit reached. Close an existing connection and retry.');
        session = { id: randomUUID(), queue: operationQueue(maxPending), active: 0, lastUsed: Date.now(), initialized: false };
        sessions.set(session.id, session);
        // Reserve before awaiting: simultaneous initializations cannot exceed
        // the process limit. Late startup results are closed during shutdown.
        session.startup = (async () => {
          session.backend = await createBackend(body.params.clientInfo);
          const backendClosed = session.backend.onclose;
          session.backend.onclose = () => { backendClosed?.(); void dispose(session); };
          session.server = createAppServer(session.backend, operation => session.queue.run(operation));
          session.transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: () => session.id, enableJsonResponse: true,
            maxRequestBodySize: MAX_BODY,
            onsessioninitialized: () => { session.initialized = true; },
          });
          session.server.onclose = () => { void dispose(session); };
          await session.server.connect(session.transport);
        })();
      }
      session.active++;
      let released = false;
      const release = () => {
        if (released) return;
        released = true;
        session.active--; session.lastUsed = Date.now();
      };
      res.once('close', release);
      try {
        await session.startup;
        if (stopping || session.closing || res.destroyed) {
          if (!res.destroyed) reject(res, 503, 'MCP session is closing.');
          void dispose(session);
          return;
        }
        await session.transport.handleRequest(req, res, body);
        if (!session.initialized) void dispose(session);
      } catch (error) {
        console.error('Kitsuvo MCP session failed:', error.message);
        if (!res.headersSent) reject(res, 500, 'MCP session request failed.');
        else if (!res.writableEnded) res.end();
        void dispose(session);
      }
    },
    async close() {
      stopping = true; clearInterval(timer);
      await Promise.all([...sessions.values()].map(dispose));
    },
  };
}
