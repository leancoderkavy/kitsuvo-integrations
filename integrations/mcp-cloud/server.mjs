import express from 'express';
import { readFileSync } from 'node:fs';
const serverCard = JSON.parse(readFileSync(new URL('./server-card.json', import.meta.url), 'utf8'));
import { durableStore } from './durable-store.mjs';
import { operationQueue } from './operation-queue.mjs';
import { createSessions } from './protocol-sessions.mjs';
import { createServer } from 'node:http';
import { randomBytes, createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { WebSocketServer, WebSocket } from 'ws';
import { mcpAuthRouter } from '@modelcontextprotocol/sdk/server/auth/router.js';
import { requireBearerAuth } from '@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js';
import { InvalidGrantError, InvalidTokenError, InvalidScopeError, InvalidTargetError, InvalidClientMetadataError, TemporarilyUnavailableError } from '@modelcontextprotocol/sdk/server/auth/errors.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { ListToolsRequestSchema, CallToolRequestSchema, ListResourcesRequestSchema, ReadResourceRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { createPostHogTelemetry, noopTelemetry } from './posthog.mjs';

const nonce = () => randomBytes(32).toString('base64url');
const digest = value => createHash('sha256').update(value).digest('hex');
const now = () => Math.floor(Date.now() / 1000);
const scope = ['browser'];
const ttl = 600;
const maxRecords = 500;
const trim = map => { for (const [key, value] of map) if (value.expiresAt <= now()) map.delete(key); };
const display = value => JSON.stringify(value).replace(/[\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, char => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`);

export function createRelay({ origin, stateFile, telemetry = noopTelemetry }) {
  const issuer = new URL(origin);
  if (issuer.username || issuer.password || issuer.search || issuer.hash || issuer.pathname !== '/' ||
      (issuer.protocol !== 'https:' && !(issuer.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(issuer.hostname)))) {
    throw new Error('Relay origin must be an HTTPS origin, or explicit loopback HTTP for development.');
  }
  const resource = new URL('/mcp', issuer);
  const store = durableStore(stateFile, issuer.origin);
  const { clients, tokens, identities } = store;
  const requests = new Map(), codes = new Map(), browsers = new Map();
  const durable = id => [...identities.values()].some(item => item.browserId === id && item.expiresAt > now());
  const persist = () => store.save();
  function bounded(map, key, value) {
    if (map === identities) { for (const [key, item] of map) if (item.expiresAt <= now() && !browsers.has(item.browserId)) map.delete(key); }
    else trim(map);
    if (map.size >= maxRecords) throw new TemporarilyUnavailableError('Capacity reached; retry later.');
    map.set(key, value);
  }
  function checkResource(target) {
    if (target && target.href !== resource.href) throw new InvalidTargetError('Token is only for this MCP resource.');
  }
  function checkScopes(scopes = scope) {
    if (scopes.length !== 1 || scopes[0] !== 'browser') throw new InvalidScopeError('Only browser scope is supported.');
  }
  function record(map, value, client) {
    store.check();
    const item = map.get(digest(value));
    if (!item || item.expiresAt <= now() || (client && item.clientId !== client.client_id) || (!browsers.has(item.browserId) && !durable(item.browserId))) {
      throw new InvalidGrantError('Expired, revoked, disconnected or incorrect grant.');
    }
    return item;
  }
  function issue(clientId, browserId) {
    // Explicit reapproval can renew an installed identity after inactivity.
    const identity = [...identities.values()].find(item => item.browserId === browserId);
    if (identity && browsers.has(browserId)) identity.expiresAt = now() + 90 * 86400;
    const access = nonce(), refresh = nonce(), grantId = nonce();
    bounded(tokens, digest(access), { clientId, browserId, grantId, kind: 'access', expiresAt: now() + ttl });
    bounded(tokens, digest(refresh), { clientId, browserId, grantId, kind: 'refresh', expiresAt: now() + (durable(browserId) ? 90 * 86400 : 86400) });
    if (durable(browserId)) {
      clients.get(clientId).expiresAt = now() + 90 * 86400;
      for (const item of identities.values()) if (item.browserId === browserId) item.expiresAt = now() + 90 * 86400;
    }
    persist();
    return { access_token: access, refresh_token: refresh, token_type: 'Bearer', expires_in: ttl, scope: 'browser' };
  }
  function revokeGrant(grantId) {
    for (const [key, item] of tokens) if (item.grantId === grantId) tokens.delete(key);
  }
  const provider = {
    clientsStore: {
      getClient(id) { store.check(); trim(clients); return clients.get(id)?.client; },
      registerClient(client) {
        if (client.client_name && client.client_name.length > 256) throw new InvalidClientMetadataError('Client name is too long.');
        if (!client.redirect_uris?.length || client.redirect_uris.length > 5) throw new InvalidClientMetadataError('One to five redirect URIs required.');
        for (const uri of client.redirect_uris) {
          const url = new URL(uri);
          if (url.username || url.password || url.hash || (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)))) {
            throw new InvalidClientMetadataError('HTTPS or loopback HTTP redirects only.');
          }
        }
        const saved = { ...client, client_id: nonce(), client_id_issued_at: now() };
        bounded(clients, saved.client_id, { client: saved, expiresAt: now() + 86400 });
        persist(); return saved;
      },
    },
    async authorize(client, params, res) {
      checkResource(params.resource); checkScopes(params.scopes);
      trim(requests);
      const key = digest(JSON.stringify([client.client_id, params]));
      let request = [...requests.values()].find(item => item.key === key);
      if (!request) {
        request = { key, id: nonce(), clientId: client.client_id, params, expiresAt: now() + ttl };
        bounded(requests, request.id, request);
      }
      res.set({ 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff' });
      if (request.browserId) {
        if (!browsers.has(request.browserId)) throw new TemporarilyUnavailableError('Your browser disconnected.');
        const code = nonce();
        bounded(codes, digest(code), { ...request, expiresAt: now() + 60 });
        requests.delete(request.id);
        const redirect = new URL(params.redirectUri);
        redirect.searchParams.set('code', code);
        if (params.state) redirect.searchParams.set('state', params.state);
        res.redirect(redirect.href);
      } else {
        // Plain text has no executable content or third-party requests. Approval
        // happens in the connected browser's terminal, never from this page.
        res.type('text/plain').send(`Kitsuvo browser access\n\nClient: ${display(client.client_name || 'Unnamed client')}\nRedirect: ${display(params.redirectUri)}\nPermission: navigate, manage tabs, click, type, run page JavaScript, and read snapshots, reports and supported screenshots in your isolated Kitsuvo agent profile.\n\nIn your Kitsuvo cloud connector terminal, enter:\napprove ${request.id}\n\nReview the client details there and explicitly confirm. Then refresh this page.\nApproval expires in ten minutes. A temporary connector revokes access when closed. An installed background connector keeps approved access for up to 90 days of inactivity; use service.mjs revoke or disconnect this app to revoke it.\n`);
      }
    },
    async challengeForAuthorizationCode(client, code) { return record(codes, code, client).params.codeChallenge; },
    async exchangeAuthorizationCode(client, code, _verifier, redirectUri, target) {
      checkResource(target);
      const item = record(codes, code, client);
      if (redirectUri !== item.params.redirectUri) throw new InvalidGrantError('Redirect URI must match.');
      codes.delete(digest(code));
      return issue(client.client_id, item.browserId);
    },
    async exchangeRefreshToken(client, token, scopes, target) {
      checkResource(target); checkScopes(scopes);
      const item = record(tokens, token, client);
      if (item.kind !== 'refresh') throw new InvalidGrantError('Refresh token required.');
      revokeGrant(item.grantId);
      return issue(client.client_id, item.browserId);
    },
    async verifyAccessToken(token) {
      let item;
      try { item = record(tokens, token); } catch { throw new InvalidTokenError('Expired or revoked browser access.'); }
      if (item.kind !== 'access') throw new InvalidTokenError('Access token required.');
      return { token, clientId: item.clientId, scopes: scope, expiresAt: item.expiresAt, resource, extra: { browserId: item.browserId } };
    },
    async revokeToken(client, { token }) {
      const item = tokens.get(digest(token));
      if (item?.clientId === client.client_id) { revokeGrant(item.grantId); persist(); }
    },
  };
  const protocolSessions = createSessions({capacity:maxRecords});
  function revokeBrowser(id) {
    for (const map of [tokens, codes, requests]) for (const [key, item] of map) if (item.browserId === id) map.delete(key);
    protocolSessions.removeOwner(id); persist();
  }
  const app = express();
  app.disable('x-powered-by');
  // Fly's edge proxy is exactly one hop in front of us and appends the client IP to
  // X-Forwarded-For. Trust only that hop (never `true`, which is spoofable) so the
  // SDK's express-rate-limit buckets per client instead of per proxy IP (KAV-159).
  app.set('trust proxy', 1);
  app.get('/health', (_req, res) => res.json({ status: 'ok', service: 'kitsuvo-mcp-cloud', version: '0.1.0' }));
  app.use((req, res, next) => {
    if (req.headers.host !== issuer.host || (req.headers.origin && req.headers.origin !== issuer.origin)) return res.status(403).end('Untrusted Host or Origin.');
    res.setHeader('Cache-Control', 'no-store'); next();
  });
  app.post('/connector/revoke', (_req, res) => {
    const credential = _req.headers['x-kitsuvo-connector-key'];
    if (typeof credential !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(credential)) return res.status(403).end();
    try {
      store.check(); const identity = identities.get(digest(credential));
      if (!identity) return res.status(404).end();
      revokeBrowser(identity.browserId); return res.json({revoked:true});
    } catch { return res.status(503).end(); }
  });
  app.get('/.well-known/mcp/server-card.json', (_req, res) => res.json(serverCard));
  app.get('/.well-known/glama.json', (_req, res) => {
    const claim = process.env.KITSUVO_GLAMA_CLAIM;
    if (!claim || !/^glama_claim_[A-Za-z0-9]+$/.test(claim)) return res.status(404).end();
    return res.json({ $schema: 'https://glama.ai/mcp/schemas/connector.json', claim });
  });
  app.use(mcpAuthRouter({ provider, issuerUrl: issuer, resourceServerUrl: resource, scopesSupported: scope, resourceName: 'Your isolated Kitsuvo browser' }));
  const bearer = requireBearerAuth({ verifier: provider, requiredScopes: scope, expectedResource: resource, resourceMetadataUrl: new URL('/.well-known/oauth-protected-resource/mcp', issuer).href });
  app.get('/userinfo', bearer, (req, res) => res.json({ sub: req.auth.extra.browserId }));
  app.all('/mcp', bearer, express.json({ limit: '256kb' }), async (req, res) => {
    const browserId = req.auth.extra.browserId;
    const browser = { call: (...args) => { const active = browsers.get(browserId); if (!active) throw new Error('Browser offline'); return active.call(...args); } };
    if (!browsers.has(browserId)) return res.status(503).end('Your browser is disconnected.');
    try {
      await protocolSessions.handle(req,res,req.auth.clientId+':'+browserId,()=>{
        const server = new Server({name:'kitsuvo',version:'0.1.0'},{capabilities:{tools:{},resources:{}}});
        server.setRequestHandler(ListToolsRequestSchema,async (_,extra)=>{
          const result=await browser.call('tools/list',undefined,{signal:extra.signal});
          return {...result,tools:result.tools.map(tool=>({...tool,securitySchemes:[{type:'oauth2',scopes:scope}],_meta:{...tool._meta,securitySchemes:[{type:'oauth2',scopes:scope}]}}))};
        });
        server.setRequestHandler(CallToolRequestSchema,(request,extra)=>browser.call('tools/call',request.params,{signal:extra.signal}));
        server.setRequestHandler(ListResourcesRequestSchema,(_,extra)=>browser.call('resources/list',undefined,{signal:extra.signal}));
        server.setRequestHandler(ReadResourceRequestSchema,(request,extra)=>browser.call('resources/read',request.params,{signal:extra.signal}));
        return server;
      },req.body);
    } catch (error) {
      telemetry.captureException(error, { source: 'mcp-session' });
      if (!res.headersSent) res.status(502).end('Browser relay request failed.');
      else if (!res.writableEnded) res.end();
    }

  });
  app.use((error, req, res, _next) => {
    telemetry.captureException(error, { source: 'express', method: req.method, path: req.path });
    if (!res.headersSent) res.status(500).end('Internal server error.');
  });
  const http = createServer(app);
  http.app = app;
  const ws = new WebSocketServer({ noServer: true, maxPayload: 8 * 1024 * 1024 });
  const enrollments = new Map();
  http.on('upgrade', (req, socket, head) => {
    if (req.url !== '/connect' || req.headers.host !== issuer.host || req.headers.origin || browsers.size >= 50) {
      socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); return;
    }
    trim(enrollments);
    const address = req.socket.remoteAddress;
    const attempts = enrollments.get(address) || { count: 0, expiresAt: now() + 900 };
    if (attempts.count >= 20 || (!enrollments.has(address) && enrollments.size >= maxRecords)) {
      socket.end('HTTP/1.1 429 Too Many Requests\r\nConnection: close\r\n\r\n'); return;
    }
    attempts.count += 1; enrollments.set(address, attempts);
    let identity;
    const credential = req.headers['x-kitsuvo-connector-key'];
    if (credential !== undefined) {
      if (!stateFile || typeof credential !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(credential)) { socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); return; }
      try {
        store.check();
        for (const [key, item] of identities) if (item.expiresAt <= now() && !browsers.has(item.browserId)) identities.delete(key);
        const key = digest(credential);
        identity = identities.get(key);
        if (!identity) { identity = { browserId: nonce(), expiresAt: now() + 90 * 86400 }; bounded(identities, key, identity); persist(); }
        if (browsers.has(identity.browserId)) { socket.end('HTTP/1.1 409 Conflict\r\nConnection: close\r\n\r\n'); return; }
      } catch { socket.end('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n'); return; }
    }
    ws.handleUpgrade(req, socket, head, connection => ws.emit('connection', connection, identity));
  });
  ws.on('connection', (socket, identity) => {
    const id = identity?.browserId || nonce(), pending = new Map();
    const queue = operationQueue(); let alive = true;
    const send = value => { if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(value)); };
    const browser = { call(method, params, options) {
      return queue.run((signal,remainingMs) => new Promise((resolve, reject) => {
        if (socket.readyState !== WebSocket.OPEN) return reject(new Error('Disconnected'));
        const callId = nonce();
        const cancel = () => { pending.delete(callId); send({ type: 'cancel', id: callId }); reject(new Error('Browser request cancelled.')); };
        signal.addEventListener('abort', cancel, { once: true });
        pending.set(callId, { resolve, reject, cleanup: () => signal.removeEventListener('abort', cancel) });
        send({ type: 'call', id: callId, method, params, deadlineMs:remainingMs() });
      }), options);
    } };
    browsers.set(id, browser); send({ type: 'connected', durable: Boolean(identity) });
    socket.on('pong', () => { alive = true; });
    const heartbeat = setInterval(() => { if (!alive) return socket.terminate(); alive = false; socket.ping(); }, 30000);
    heartbeat.unref();
    socket.on('message', data => {
      try {
        const message = JSON.parse(data.toString());
        if (message.type === 'revoke' && identity) {
          revokeBrowser(id); send({ type: 'revoked' });
        } else if (message.type === 'review' || message.type === 'approve') {
          trim(requests);
          const request = requests.get(message.id);
          if (!request || request.browserId) return send({ type: 'rejected', message: 'Approval expired or already used.' });
          if (message.type === 'review') return send({ type: 'review', id: request.id, clientName: clients.get(request.clientId)?.client.client_name || 'Unnamed client', redirectUri: request.params.redirectUri, scope });
          request.browserId = id; send({ type: 'approved' });
        } else if (message.type === 'result') {
          const call = pending.get(message.id);
          if (!call) return;
          call.cleanup(); pending.delete(message.id);
          if (message.error) call.reject(new Error('Local browser rejected request.')); else call.resolve(message.result);
        } else socket.close(1008, 'Unknown protocol message');
      } catch (error) {
        telemetry.captureException(error, { source: 'websocket-message' });
        socket.close(1008, 'Invalid protocol message');
      }
    });
    socket.on('error', error => telemetry.captureException(error, { source: 'websocket' }));
    socket.on('close', () => {
      queue.close();
      clearInterval(heartbeat); browsers.delete(id);
      if (!identity) { protocolSessions.removeOwner(id); for (const [key, item] of tokens) if (item.browserId === id) tokens.delete(key); }
      for (const [key, item] of codes) if (item.browserId === id) codes.delete(key);
      for (const [key, item] of requests) if (item.browserId === id) requests.delete(key);
      for (const call of pending.values()) { call.cleanup(); call.reject(new Error('Disconnected')); }
      pending.clear();
    });
  });
  return { http, close() {
    protocolSessions.close();
    for (const socket of ws.clients) socket.terminate();
    ws.close();
    http.closeAllConnections();
    return new Promise(resolve => http.close(resolve)).then(async () => {
      try { await telemetry.shutdown?.(); } catch {}
    });
  } };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const origin = process.env.KITSUVO_CLOUD_ORIGIN;
  if (!origin) throw new Error('KITSUVO_CLOUD_ORIGIN is required.');
  const port = Number(process.env.PORT || 8080);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid PORT.');
  const telemetry = createPostHogTelemetry();
  const relay = createRelay({ origin, stateFile: process.env.KITSUVO_CLOUD_STATE_FILE, telemetry });
  relay.http.listen(port, '0.0.0.0', () => console.log(JSON.stringify({ event: 'listening', port })));
  let shuttingDown = false;
  const shutdown = async exitCode => {
    if (shuttingDown) return;
    shuttingDown = true;
    if (exitCode) process.exitCode = exitCode;
    await relay.close();
  };
  process.once('SIGTERM', () => { void shutdown(); });
  process.once('SIGINT', () => { void shutdown(); });
  process.once('unhandledRejection', error => telemetry.captureException(error, { source: 'unhandled-rejection' }));
  process.once('uncaughtException', error => {
    telemetry.captureException(error, { source: 'uncaught-exception' });
    void shutdown(1);
  });
}
