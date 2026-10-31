import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';

// Keep protocol cancellation scoped to the authenticated client, with bounded memory.
// Matches the per-session bridge's 1 MiB request cap (sessions.mjs).
// An owner group (the relay's browser) may hold only groupCapacity sessions; a
// new one evicts that group's least recently used session, never another's.
// groupCapacity may be a function of the group (the relay's Plus browsers hold more).
// With sourceOf (the relay's connector network), each source may hold only
// sourceCapacity sessions, and a full table evicts the least recently used
// session of the source holding the most, so a few networks cannot starve others.
export function createSessions({ capacity = 64, idleMs = 900000, maxRequestBodySize = 1 << 20, groupCapacity = Infinity, groupOf = owner => owner, sourceCapacity = Infinity, sourceOf = null } = {}) {
  const sessions = new Map(), creatingGroups = new Map(), creatingSources = new Map(); let creating = 0;
  const oldest = match => { let found; for (const item of sessions.values()) if (match(item) && (!found || item.touched < found.touched)) found = item; return found; };
  const heaviest = () => {
    const counts = new Map(creatingSources); let top, most = 0;
    for (const item of sessions.values()) counts.set(item.source, (counts.get(item.source) || 0) + 1);
    for (const [source, n] of counts) if (n > most) { most = n; top = source; }
    return oldest(item => item.source === top);
  };
  const remove = item => {
    if (item.transport.sessionId) sessions.delete(item.transport.sessionId);
    void item.server.close().catch(() => {});
  };
  // Idle time is monotonic, so a wall-clock step cannot drop every session.
  const sweep = () => {
    for (const item of sessions.values()) if (performance.now() - item.touched > idleMs) remove(item);
  };
  const timer = setInterval(sweep, Math.min(idleMs, 60000)); timer.unref();
  return {
    async handle(req, res, owner, makeServer, body) {
      const id = req.headers['mcp-session-id'];
      let item, group, source; let reserved = false;
      const release = () => {
        if (!reserved) return; reserved = false; creating--;
        for (const [map, key] of [[creatingGroups, group], [creatingSources, source]]) { if (!map.has(key)) continue; const count = map.get(key) - 1; if (count > 0) map.set(key, count); else map.delete(key); }
      };
      if (id) {
        item = sessions.get(id);
        if (!item || item.owner !== owner) { res.writeHead(404).end('Unknown MCP session.'); return; }
      } else {
        if (req.method !== 'POST') { res.writeHead(405, {Allow:'POST'}).end('Initialize MCP with POST.'); return; }
        sweep();
        group = groupOf(owner);
        const groupLimit = typeof groupCapacity === 'function' ? groupCapacity(group) : groupCapacity;
        const held = [...sessions.values()].filter(other => other.group === group).sort((a, b) => a.touched - b.touched);
        while (held.length && held.length + (creatingGroups.get(group) || 0) >= groupLimit) remove(held.shift());
        if (sourceOf) {
          source = sourceOf(owner);
          const inFlight = creatingSources.get(source) || 0;
          for (let victim; (victim = oldest(other => other.source === source)) && [...sessions.values()].filter(other => other.source === source).length + inFlight >= sourceCapacity;) remove(victim);
          // A full table yields the heaviest source's idlest session. Sessions
          // still initializing count toward their source but cannot be evicted.
          for (let victim; sessions.size + creating >= capacity && (victim = heaviest());) remove(victim);
        }
        const sourceFull = sourceOf && [...sessions.values()].filter(other => other.source === source).length + (creatingSources.get(source) || 0) >= sourceCapacity;
        if (sourceFull || sessions.size + creating >= capacity || (creatingGroups.get(group) || 0) >= groupLimit) { res.writeHead(503).end('MCP session capacity reached.'); return; }
        creating++; creatingGroups.set(group, (creatingGroups.get(group) || 0) + 1); reserved = true;
        if (sourceOf) creatingSources.set(source, (creatingSources.get(source) || 0) + 1);
        try {
          const server = makeServer();
          const transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: randomUUID, enableJsonResponse: true, maxRequestBodySize,
            onsessioninitialized: sessionId => sessions.set(sessionId, item),
          });
          item = {server, transport, owner, group, source, touched:performance.now()};
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
        } catch (error) { release(); throw error; }
      }
      item.touched = performance.now();
      const disconnected = () => { if (req.method === 'POST' && !res.writableFinished) remove(item); };
      res.once('close', disconnected);
      try { await item.transport.handleRequest(req, res, body); }
      catch (error) { remove(item); throw error; }
      finally { release(); if (!item.transport.sessionId) remove(item); }
    },
    removeOwner(owner) { for (const item of sessions.values()) if (item.owner === owner || item.owner.endsWith(':'+owner)) remove(item); },
    close() { clearInterval(timer); for (const item of sessions.values()) remove(item); sessions.clear(); },
  };
}
