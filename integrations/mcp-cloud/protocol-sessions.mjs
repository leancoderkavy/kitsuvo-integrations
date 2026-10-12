import { randomUUID } from 'node:crypto';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';

// Keep protocol cancellation scoped to the authenticated client, with bounded memory.
export function createSessions({ capacity = 64, idleMs = 900000 } = {}) {
  const sessions = new Map(); let creating = 0;
  const remove = item => {
    if (item.transport.sessionId) sessions.delete(item.transport.sessionId);
    void item.server.close().catch(() => {});
  };
  const sweep = () => {
    for (const item of sessions.values()) if (Date.now() - item.touched > idleMs) remove(item);
  };
  const timer = setInterval(sweep, Math.min(idleMs, 60000)); timer.unref();
  return {
    async handle(req, res, owner, makeServer, body) {
      const id = req.headers['mcp-session-id'];
      let item; let reserved = false;
      if (id) {
        item = sessions.get(id);
        if (!item || item.owner !== owner) { res.writeHead(404).end('Unknown MCP session.'); return; }
      } else {
        if (req.method !== 'POST') { res.writeHead(405, {Allow:'POST'}).end('Initialize MCP with POST.'); return; }
        sweep();
        if (sessions.size + creating >= capacity) { res.writeHead(503).end('MCP session capacity reached.'); return; }
        creating++; reserved = true;
        try {
          const server = makeServer();
          const transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: randomUUID, enableJsonResponse: true,
            onsessioninitialized: sessionId => sessions.set(sessionId, item),
          });
          item = {server, transport, owner, touched:Date.now()};
          server.onclose = () => { if (transport.sessionId) sessions.delete(transport.sessionId); };
          await server.connect(transport);
          // The SDK suppresses handler replies after cancellation. Close the
          // original JSON response too, so cancelled POSTs cannot accumulate.
          const receive = transport.onmessage;
          transport.onmessage = (message, extra) => {
            receive(message, extra);
            const cancelledId = message.method === 'notifications/cancelled' && message.params?.requestId;
            if (typeof cancelledId === 'number' || typeof cancelledId === 'string') {
              void transport.send({jsonrpc:'2.0', id:cancelledId, error:{code:-32000, message:'Request cancelled. A dispatched mutation may have completed; inspect state before retrying.'}}).catch(() => {});
            }
          };
        } catch (error) { creating--; throw error; }
      }
      item.touched = Date.now();
      const disconnected = () => { if (req.method === 'POST' && !res.writableFinished) remove(item); };
      res.once('close', disconnected);
      try { await item.transport.handleRequest(req, res, body); }
      catch (error) { remove(item); throw error; }
      finally { if (reserved) creating--; if (!item.transport.sessionId) remove(item); }
    },
    removeOwner(owner) { for (const item of sessions.values()) if (item.owner === owner || item.owner.endsWith(':'+owner)) remove(item); },
    close() { clearInterval(timer); for (const item of sessions.values()) remove(item); sessions.clear(); },
  };
}
