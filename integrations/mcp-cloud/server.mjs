import express from 'express';
import { readFileSync } from 'node:fs';
const serverCard = JSON.parse(readFileSync(new URL('./server-card.json', import.meta.url), 'utf8'));
// server-card.json is the relay's single version source: /health, MCP serverInfo
// and the public directory card all report serverCard.serverInfo.version.
const relayVersion = serverCard.serverInfo.version;
// Read once: every MCP session used to read and re-encode the icon synchronously.
const icons = [{ src: `data:image/png;base64,${readFileSync(new URL('./icon-256.png', import.meta.url)).toString('base64')}`, mimeType: 'image/png', sizes: ['256x256'] }];
import { durableStore } from './durable-store.mjs';
import { operationQueue } from './operation-queue.mjs';
import { createSessions } from './protocol-sessions.mjs';
import { createServer } from 'node:http';
import { isIP } from 'node:net';
import { ipKeyGenerator } from 'express-rate-limit';
import { randomBytes, createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';
import { WebSocketServer, WebSocket } from 'ws';
import { mcpAuthRouter } from '@modelcontextprotocol/sdk/server/auth/router.js';
import { requireBearerAuth } from '@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js';
import { InvalidGrantError, InvalidTokenError, InvalidScopeError, InvalidTargetError, InvalidClientMetadataError, TemporarilyUnavailableError } from '@modelcontextprotocol/sdk/server/auth/errors.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { ListToolsRequestSchema, CallToolRequestSchema, ListResourcesRequestSchema, ReadResourceRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { createPostHogTelemetry, noopTelemetry } from './posthog.mjs';

const nonce = () => randomBytes(32).toString('base64url');
const digest = value => createHash('sha256').update(value).digest('hex');
const scope = ['browser'];
// SDK 1.32 parses the registered schema before its own tools/call validation,
// so malformed params surface as -32603. Register a method-only schema and let
// the SDK's wrapper reject bad params with -32602 (Invalid params).
const ToolCallRequestSchema = CallToolRequestSchema.pick({ method: true }).passthrough();
class BrowserRejection extends Error { constructor(detail) { super('Local browser rejected request.'); this.detail = detail; } }
const ttl = 600;
// Unapproved registrations are discarded after a day; advertised confidential
// secret expiry must match so clients re-register instead of failing later.
const clientTtl = 86400;
const maxRecords = 500;
// Abuse limits. Global capacity is split so anonymous (temporary) connectors
// cannot starve installed ones, and per-source caps stop a few addresses from
// holding every slot. Sources are IPv4 addresses or IPv6 /56 prefixes.
export const limits = Object.freeze({
  installedConnectors: 50, installedPerSource: 5,
  temporaryConnectors: 25, temporaryPerSource: 3,
  pendingConnectors: 60, pendingPerSource: 3,
  tokenRecords: 5000, grantsPerBrowser: 8, grantsPerClient: 4,
  pendingRequestsPerSource: 10, unapprovedClientsPerSource: 10,
  pendingMessageBytes: 16 * 1024, connectorMessageBytes: 8 * 1024 * 1024,
  // Registrations are persisted; 500 records must stay well inside the store's
  // 4 MiB load limit, or a full registry could stop the relay from restarting.
  clientMetadataBytes: 4 * 1024,
  // Global MCP sessions are maxRecords; one browser's clients cannot hold them all,
  // nor can one connector network. A full table evicts the heaviest network's
  // least recently used session instead of refusing everyone else.
  sessionsPerBrowser: 16, sessionsPerSource: 64,
});
const display = value => JSON.stringify(value).replace(/[\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, char => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`);

// `clock` exists for tests that simulate days of refresh cycles: `wall` is
// epoch milliseconds, `monotonic` a performance.now()-style reading.
const systemClock = { wall: () => Date.now(), monotonic: () => performance.now() };
export function createRelay({ origin, stateFile, telemetry = noopTelemetry, trustedProxyHops = 0, clock = systemClock }) {
  if (![0, 1].includes(trustedProxyHops)) throw new Error('Configure zero or one trusted proxy hop.');
  // Expiry uses wall time read once at startup, advanced by the monotonic clock.
  // An NTP step or manual clock change while running can then neither expire
  // and prune every grant at once (a forward jump would also persist the loss)
  // nor extend them. Tokens carry relative lifetimes (expires_in), so client
  // clock skew does not matter; persisted expiries are compared at startup.
  const anchor = clock.wall() - clock.monotonic();
  const now = () => Math.floor((anchor + clock.monotonic()) / 1000);
  const trim = map => { for (const [key, value] of map) if (value.expiresAt <= now()) map.delete(key); };
  const issuer = new URL(origin);
  if (issuer.username || issuer.password || issuer.search || issuer.hash || issuer.pathname !== '/' ||
      (issuer.protocol !== 'https:' && !(issuer.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(issuer.hostname)))) {
    throw new Error('Relay origin must be an HTTPS origin, or explicit loopback HTTP for development.');
  }
  const resource = new URL('/mcp', issuer);
  const store = durableStore(stateFile, issuer.origin, { tokens: limits.tokenRecords }, { now: clock.wall });
  const { clients, tokens, identities } = store;
  // Earlier versions persisted unapproved handshakes. Only an unexpired grant
  // justifies restoring a disconnected identity; orphan records get no priority.
  let pruned=false;
  for(const [key,identity] of identities){
    if(identity.expiresAt<=now() || ![...tokens.values()].some(token=>token.browserId===identity.browserId && token.expiresAt>now())){identities.delete(key);pruned=true;}
  }
  if(pruned)store.persist().catch(() => {});
  const requests = new Map(), codes = new Map(), browsers = new Map();
  const pendingIdentities = new Map();
  // In-memory only: which source registered a client that has no grant yet.
  const clientSources = new Map(), registering = new Map();
  const durable = id => [...identities.values()].some(item => item.browserId === id && item.expiresAt > now());
  // Resolves once a document containing every mutation made so far is durable.
  // Issued tokens and revocations are acknowledged only after it resolves.
  const persist = () => store.persist();
  function bounded(map, key, value, capacity = maxRecords) {
    if (map === identities) { for (const [key, item] of map) if (item.expiresAt <= now() && !browsers.has(item.browserId)) map.delete(key); }
    else trim(map);
    if (map.size >= capacity) throw new TemporarilyUnavailableError('Capacity reached; retry later.');
    map.set(key, value);
  }
  function checkResource(target) {
    if (target && target.href !== resource.href) throw new InvalidTargetError('Token is only for this MCP resource.');
  }
  function checkScopes(scopes) {
    // The SDK passes [] when the client omits `scope`; default to browser.
    if (!scopes?.length) scopes = scope;
    if (scopes.length !== 1 || scopes[0] !== 'browser') throw new InvalidScopeError('Only browser scope is supported.');
  }
  function record(map, value, client) {
    store.check();
    const item = map.get(digest(value));
    if (!item || item.used || item.expiresAt <= now() || (client && item.clientId !== client.client_id) || (!browsers.has(item.browserId) && !durable(item.browserId))) {
      throw new InvalidGrantError('Expired, revoked, disconnected or incorrect grant.');
    }
    return item;
  }
  // Grant families in least-recently-issued order (rotation moves a family last).
  function families(match) {
    const order = new Map();
    for (const item of tokens.values()) if (match(item)) { order.delete(item.grantId); order.set(item.grantId, true); }
    return [...order.keys()];
  }
  function makeRoom(clientId, browserId, grantId) {
    trim(tokens);
    // One browser or client cannot crowd out everyone else: it loses its own oldest grant.
    // A refresh renews its own family, which is not a new grant and needs no room;
    // counting it made every rotation at the cap revoke another live grant.
    for (const [match, cap] of [[item => item.browserId === browserId, limits.grantsPerBrowser], [item => item.clientId === clientId, limits.grantsPerClient]]) {
      const owned = families(item => item.grantId !== grantId && match(item));
      while (owned.length >= cap) revokeGrant(owned.shift());
    }
    // Abandoned grants of offline browsers yield to active users before refusing.
    if (tokens.size + 2 > limits.tokenRecords) {
      for (const grantId of families(item => !browsers.has(item.browserId))) {
        revokeGrant(grantId);
        if (tokens.size + 2 <= limits.tokenRecords) break;
      }
    }
  }
  async function issue(clientId, browserId, grantId = nonce()) {
    // Explicit reapproval can renew an installed identity after inactivity.
    const identity = [...identities.values()].find(item => item.browserId === browserId);
    if (identity && browsers.has(browserId)) identity.expiresAt = now() + 90 * 86400;
    clientSources.delete(clientId);
    makeRoom(clientId, browserId, grantId);
    const access = nonce(), refresh = nonce();
    bounded(tokens, digest(access), { clientId, browserId, grantId, kind: 'access', expiresAt: now() + ttl }, limits.tokenRecords);
    bounded(tokens, digest(refresh), { clientId, browserId, grantId, kind: 'refresh', expiresAt: now() + (durable(browserId) ? 90 * 86400 : 86400) }, limits.tokenRecords);
    if (durable(browserId)) {
      const saved = clients.get(clientId);
      saved.expiresAt = now() + 90 * 86400;
      // Keep any confidential secret valid for exactly as long as the record.
      if (saved.client.client_secret_expires_at) saved.client.client_secret_expires_at = saved.expiresAt;
      for (const item of identities.values()) if (item.browserId === browserId) item.expiresAt = now() + 90 * 86400;
    } else {
      // A temporary connector's client must outlive its one-day refresh token,
      // or an actively refreshing session failed exactly a day after it
      // registered. Renewed at most hourly, so refreshes rarely cause a write.
      const saved = clients.get(clientId);
      if (saved && saved.expiresAt < now() + clientTtl - 3600) {
        saved.expiresAt = now() + clientTtl;
        if (saved.client.client_secret_expires_at) saved.client.client_secret_expires_at = saved.expiresAt;
      }
    }
    await persist();
    return { access_token: access, refresh_token: refresh, token_type: 'Bearer', expires_in: ttl, scope: 'browser' };
  }
  function revokeGrant(grantId) {
    for (const [key, item] of tokens) if (item.grantId === grantId) tokens.delete(key);
  }
  // OAuth 2.1 public clients: replaying a spent authorization code or rotated
  // refresh token signals theft, so the whole grant family is revoked.
  // Detection, validation and marking a code or refresh token spent stay
  // synchronous, so two concurrent exchanges cannot both pass the check. A
  // replay returns a promise that rejects once the revocation is durable.
  function replayed(map, value, client) {
    const item = map.get(digest(value));
    if (!item?.used || item.clientId !== client.client_id) return;
    if (item.grantId) revokeGrant(item.grantId);
    map.delete(digest(value));
    return persist().then(() => { throw new InvalidGrantError('Grant reuse detected; access was revoked.'); });
  }
  const provider = {
    clientsStore: {
      getClient(id) { store.check(); trim(clients); return clients.get(id)?.client; },
      async registerClient(client) {
        if (client.client_name && client.client_name.length > 256) throw new InvalidClientMetadataError('Client name is too long.');
        if (!client.redirect_uris?.length || client.redirect_uris.length > 5) throw new InvalidClientMetadataError('One to five redirect URIs required.');
        for (const uri of client.redirect_uris) {
          const url = new URL(uri);
          if (url.username || url.password || url.hash || (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)))) {
            throw new InvalidClientMetadataError('HTTPS or loopback HTTP redirects only.');
          }
        }
        if (Buffer.byteLength(JSON.stringify(client)) > limits.clientMetadataBytes) throw new InvalidClientMetadataError('Client metadata is too large.');
        const saved = { ...client, client_id: nonce(), client_id_issued_at: now() };
        bounded(clients, saved.client_id, { client: saved, expiresAt: saved.client_id_issued_at + clientTtl });
        await persist(); return saved;
      },
    },
    async authorize(client, params, res) {
      checkResource(params.resource); checkScopes(params.scopes);
      trim(requests);
      const key = digest(JSON.stringify([client.client_id, params]));
      let request = [...requests.values()].find(item => item.key === key);
      if (!request) {
        const source = ipKeyGenerator(res.req.ip || '');
        if ([...requests.values()].filter(item => item.source === source && !item.browserId).length >= limits.pendingRequestsPerSource) {
          throw new TemporarilyUnavailableError('Too many pending approvals from this network; retry later.');
        }
        request = { key, id: nonce(), clientId: client.client_id, params, source, expiresAt: now() + ttl };
        bounded(requests, request.id, request);
      }
      res.set({ 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff', 'Content-Language': 'en' });
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
    async challengeForAuthorizationCode(client, code) { return replayed(codes, code, client) ?? record(codes, code, client).params.codeChallenge; },
    async exchangeAuthorizationCode(client, code, _verifier, redirectUri, target) {
      checkResource(target);
      const replay = replayed(codes, code, client); if (replay) return replay;
      const item = record(codes, code, client);
      if (redirectUri !== item.params.redirectUri) throw new InvalidGrantError('Redirect URI must match.');
      // Keep a spent marker (memory only) so a replay can revoke what it issued.
      const grantId = nonce();
      codes.set(digest(code), { clientId: client.client_id, browserId: item.browserId, grantId, used: true, expiresAt: now() + ttl });
      return issue(client.client_id, item.browserId, grantId);
    },
    async exchangeRefreshToken(client, token, scopes, target) {
      checkResource(target); checkScopes(scopes);
      store.check(); const replay = replayed(tokens, token, client); if (replay) return replay;
      const item = record(tokens, token, client);
      if (item.kind !== 'refresh') throw new InvalidGrantError('Refresh token required.');
      // Rotate within the family: live tokens go, the spent refresh token stays
      // as a marker until its own expiry. Only the two newest markers are kept.
      const markers = [];
      for (const [key, other] of tokens) if (other.grantId === item.grantId) { if (other.used) markers.push(key); else tokens.delete(key); }
      for (const key of markers.slice(0, -1)) tokens.delete(key);
      tokens.set(digest(token), { ...item, used: true });
      return issue(client.client_id, item.browserId, item.grantId);
    },
    async verifyAccessToken(token) {
      let item;
      try { item = record(tokens, token); } catch { throw new InvalidTokenError('Expired or revoked browser access.'); }
      if (item.kind !== 'access') throw new InvalidTokenError('Access token required.');
      // The SDK middleware compares expiresAt with the wall clock; report the
      // remaining monotonic lifetime in that frame.
      return { token, clientId: item.clientId, scopes: scope, expiresAt: Math.floor(clock.wall() / 1000) + item.expiresAt - now(), resource, extra: { browserId: item.browserId } };
    },
    async revokeToken(client, { token }) {
      const item = tokens.get(digest(token));
      if (item?.clientId === client.client_id) { revokeGrant(item.grantId); await persist(); }
    },
  };
  // Session owners are `${clientId}:${browserId}`; group them by browser, and
  // by the browser connector's network (IPv4 address or IPv6 /56). MCP clients
  // such as hosted chat apps share egress addresses, so their request IP is not
  // a fair key; the connector's network is the user's.
  const browserOf = owner => owner.slice(owner.lastIndexOf(':') + 1);
  const protocolSessions = createSessions({capacity:maxRecords, groupCapacity:limits.sessionsPerBrowser, groupOf:browserOf,
    sourceCapacity:limits.sessionsPerSource, sourceOf:owner => browsers.get(browserOf(owner))?.source ?? browserOf(owner)});
  function revokeBrowser(id) {
    for (const map of [tokens, codes, requests]) for (const [key, item] of map) if (item.browserId === id) map.delete(key);
    protocolSessions.removeOwner(id); return persist();
  }
  const app = express();
  app.disable('x-powered-by');
  // Direct listeners ignore forwarding headers. Fly explicitly enables one
  // trusted edge hop; HTTP and WebSocket admission both use its rightmost IP.
  app.set('trust proxy', trustedProxyHops);
  let draining = false;
  app.use((req, res, next) => {
    // Every relay response is data or plain text: nothing may be framed,
    // sniffed as markup, run scripts or leak a referrer.
    res.set({ 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY',
      'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'" });
    if (issuer.protocol === 'https:') res.set('Strict-Transport-Security', 'max-age=31536000');
    next();
  });
  app.get('/health', (_req, res) => draining ? res.status(503).json({ status: 'draining' }) : res.json({ status: 'ok', service: 'kitsuvo-mcp-cloud', version: relayVersion }));
  app.use((req, res, next) => {
    if (req.headers.host !== issuer.host || (req.headers.origin && req.headers.origin !== issuer.origin)) return res.status(403).type('text/plain').end('Untrusted Host or Origin.');
    res.setHeader('Cache-Control', 'no-store');
    // During shutdown, requests on kept-alive sockets get a retryable answer.
    if (draining) return res.status(503).set({ 'Retry-After': '5', Connection: 'close' }).type('text/plain').end('Relay restarting; retry shortly.');
    next();
  });
  app.post('/connector/revoke', async (_req, res) => {
    const credential = _req.headers['x-kitsuvo-connector-key'];
    if (typeof credential !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(credential)) return res.status(403).end();
    try {
      store.check(); const identity = identities.get(digest(credential));
      if (!identity) return res.status(404).end();
      await revokeBrowser(identity.browserId); return res.json({revoked:true});
    } catch { return res.status(503).end(); }
  });
  // Unapproved registrations live for a day; cap how many one source holds.
  app.post('/register', (req, res, next) => {
    const source = ipKeyGenerator(req.ip || '');
    for (const [id, owner] of clientSources) if (!clients.has(id) || clients.get(id).expiresAt <= now()) clientSources.delete(id);
    const held = [...clientSources.values()].filter(owner => owner === source).length + (registering.get(source) || 0);
    if (held >= limits.unapprovedClientsPerSource) {
      return res.status(429).json({ error: 'temporarily_unavailable', error_description: 'Too many unapproved registrations from this network; retry later.' });
    }
    registering.set(source, (registering.get(source) || 0) + 1);
    res.once('close', () => { const count = registering.get(source) - 1; if (count > 0) registering.set(source, count); else registering.delete(source); });
    const json = res.json.bind(res);
    res.json = body => { if (res.statusCode === 201 && typeof body?.client_id === 'string') clientSources.set(body.client_id, source); return json(body); };
    next();
  });
  app.get('/.well-known/mcp/server-card.json', (_req, res) => res.json(serverCard));
  app.get('/.well-known/glama.json', (_req, res) => {
    const claim = process.env.KITSUVO_GLAMA_CLAIM;
    if (!claim || !/^glama_claim_[A-Za-z0-9]+$/.test(claim)) return res.status(404).end();
    return res.json({ $schema: 'https://glama.ai/mcp/schemas/connector.json', claim });
  });
  app.use(mcpAuthRouter({ provider, issuerUrl: issuer, resourceServerUrl: resource, scopesSupported: scope, resourceName: 'Your isolated Kitsuvo browser', clientRegistrationOptions: { clientSecretExpirySeconds: clientTtl } }));
  const bearer = requireBearerAuth({ verifier: provider, requiredScopes: scope, expectedResource: resource, resourceMetadataUrl: new URL('/.well-known/oauth-protected-resource/mcp', issuer).href });
  app.get('/userinfo', bearer, (req, res) => res.json({ sub: req.auth.extra.browserId }));
  app.all('/mcp', bearer, express.json({ limit: '256kb' }), async (req, res) => {
    const browserId = req.auth.extra.browserId;
    const browser = { call: (method, params, extra) => {
      const active = browsers.get(browserId); if (!active) throw new Error('Browser offline');
      return active.call(method, params, { signal: extra.signal, authorize: () => {
        // Sessions survive token rotation. Check this message's credential at
        // dispatch, after queueing, never the session's initialization token.
        const grant = record(tokens, extra.authInfo?.token || '');
        if (grant.kind !== 'access' || grant.browserId !== browserId || grant.clientId !== extra.authInfo?.clientId) throw new InvalidTokenError('Expired or revoked browser access.');
      } });
    } };
    if (!browsers.has(browserId)) return res.status(503).end('Your browser is disconnected.');
    try {
      await protocolSessions.handle(req,res,req.auth.clientId+':'+browserId,()=>{
        const server = new Server({name:'kitsuvo',title:'Kitsuvo',version:relayVersion,icons},{capabilities:{tools:{},resources:{}}});
        server.setRequestHandler(ListToolsRequestSchema,async (_,extra)=>{
          const result=await browser.call('tools/list',undefined,extra);
          return {...result,tools:result.tools.map(tool=>({...tool,securitySchemes:[{type:'oauth2',scopes:scope}],_meta:{...tool._meta,securitySchemes:[{type:'oauth2',scopes:scope}]}}))};
        });
        // A refusal from the local browser is a tool failure the model can read, like the HTTP bridge.
        server.setRequestHandler(ToolCallRequestSchema,(request,extra)=>browser.call('tools/call',request.params,extra)
          .catch(error=>{ if(!(error instanceof BrowserRejection)) throw error; return {content:[{type:'text',text:error.detail}],isError:true}; }));
        server.setRequestHandler(ListResourcesRequestSchema,(_,extra)=>browser.call('resources/list',undefined,extra));
        server.setRequestHandler(ReadResourceRequestSchema,(request,extra)=>browser.call('resources/read',request.params,extra));
        return server;
      },req.body);
    } catch (error) {
      telemetry.captureException(error, { source: 'mcp-session' });
      if (!res.headersSent) res.status(502).end('Browser relay request failed.');
      else if (!res.writableEnded) res.end();
    }

  });
  // Express's default 404 page replaces the security headers above.
  app.use((_req, res) => { res.status(404).type('text/plain').end('Not found.'); });
  app.use((error, req, res, _next) => {
    // Malformed or oversized request bodies are client errors, not crashes.
    if (error?.type === 'entity.parse.failed' || error?.type === 'entity.too.large' || error?.status === 400 || error?.status === 413) {
      if (!res.headersSent) res.status(error.status === 413 ? 413 : 400).json({ error: 'invalid_request', error_description: error.status === 413 ? 'Request body too large.' : 'Malformed request body.' });
      return;
    }
    telemetry.captureException(error, { source: 'express', method: req.method, path: req.path });
    if (!res.headersSent) res.status(500).end('Internal server error.');
  });
  const http = createServer(app);
  http.app = app;
  // Requests that do work (not long-lived GET event streams) are drained on shutdown.
  let working = 0; const idleWaiters = new Set();
  http.on('request', (req, res) => {
    if (req.method === 'GET') return;
    working++;
    res.once('close', () => { if (--working === 0) for (const resolve of idleWaiters) resolve(); });
  });
  const ws = new WebSocketServer({ noServer: true, maxPayload: limits.connectorMessageBytes });
  const enrollmentBuckets = new Map(), reconnectBuckets = new Map();
  http.on('upgrade', (req, socket, head) => {
    if (draining) { socket.end('HTTP/1.1 503 Service Unavailable\r\nRetry-After: 5\r\nConnection: close\r\n\r\n'); return; }
    if (req.url !== '/connect' || req.headers.host !== issuer.host || req.headers.origin) {
      socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); return;
    }
    trim(enrollmentBuckets);trim(reconnectBuckets);
    // Match Express's one-hop policy: only the rightmost forwarded address was
    // appended by the trusted edge. Direct deployments never trust this header.
    const forwarded = req.headers['x-forwarded-for'];
    const address = trustedProxyHops === 1 && typeof forwarded === 'string'
      ? forwarded.split(',').at(-1).trim() : req.socket.remoteAddress;
    if (!isIP(address || '')) { socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n'); return; }
    let identity, identityKey;
    const credential = req.headers['x-kitsuvo-connector-key'];
    if (credential !== undefined) {
      if (!stateFile || typeof credential !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(credential)) { socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); return; }
      try {
        store.check();
        for (const [key, item] of identities) if (item.expiresAt <= now() && !browsers.has(item.browserId)) identities.delete(key);
        identityKey = digest(credential);
        identity = identities.get(identityKey);
        if (identity && browsers.has(identity.browserId) || pendingIdentities.has(identityKey)) { socket.end('HTTP/1.1 409 Conflict\r\nConnection: close\r\n\r\n'); return; }
      } catch { socket.end('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n'); return; }
    }
    // Known connectors have a separate reconnect budget. Anonymous onboarding
    // cannot consume their slots or throttle them through its smaller budget.
    const established = Boolean(identity), enrollments=established?reconnectBuckets:enrollmentBuckets, bucket=ipKeyGenerator(address);
    const attempts = enrollments.get(bucket) || { count: 0, expiresAt: now() + 900 };
    const full = established ? capacityFull(true, bucket) : pendingFull(bucket);
    if (attempts.count >= (established ? 120 : 20) || (!enrollments.has(bucket) && enrollments.size >= maxRecords) || full) {
      socket.end('HTTP/1.1 429 Too Many Requests\r\nConnection: close\r\n\r\n'); return;
    }
    attempts.count += 1; enrollments.set(bucket, attempts);
    // No identity is persisted before a valid handshake AND explicit approval.
    ws.handleUpgrade(req, socket, head, connection => {
      const candidate = identity || (identityKey ? { browserId: nonce(), expiresAt: now() + ttl } : undefined);
      if (identityKey && !established) pendingIdentities.set(identityKey, candidate);
      ws.emit('connection', connection, candidate, identityKey, established, bucket);
    });
  });
  // Installed (keyed) and temporary (anonymous) connectors have separate
  // global budgets, and each source may hold only a few slots of each kind.
  const count = match => { let n = 0; for (const b of browsers.values()) if (match(b)) n++; return n; };
  function capacityFull(installed, source) {
    return count(b => b.established && b.installed === installed) >= (installed ? limits.installedConnectors : limits.temporaryConnectors)
      || count(b => b.established && b.installed === installed && b.source === source) >= (installed ? limits.installedPerSource : limits.temporaryPerSource);
  }
  function pendingFull(source) {
    return count(b => !b.established) >= limits.pendingConnectors || count(b => !b.established && b.source === source) >= limits.pendingPerSource;
  }
  // ws 8 has no public per-socket limit; adjust its receiver when available and
  // always enforce the pre-approval limit on delivered messages too.
  const messageLimit = (socket, bytes) => { if (Number.isInteger(socket._receiver?._maxPayload)) socket._receiver._maxPayload = bytes; };
  ws.on('connection', (socket, identity, identityKey, established, source) => {
    const id = identity?.browserId || nonce(), pending = new Map();
    const queue = operationQueue(); let alive = true;
    const send = value => { if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(value)); };
    const browser = { established, installed: Boolean(identityKey), source, call(method, params, options) {
      return queue.run((signal,remainingMs) => new Promise((resolve, reject) => {
        options.authorize();
        if (socket.readyState !== WebSocket.OPEN) return reject(new Error('Disconnected'));
        const callId = nonce();
        const cancel = () => { pending.delete(callId); send({ type: 'cancel', id: callId }); reject(new Error('Browser request cancelled.')); };
        signal.addEventListener('abort', cancel, { once: true });
        pending.set(callId, { resolve, reject, cleanup: () => signal.removeEventListener('abort', cancel) });
        send({ type: 'call', id: callId, method, params, deadlineMs:remainingMs() });
      }), options);
    } };
    if (!established) messageLimit(socket, limits.pendingMessageBytes);
    browsers.set(id, browser); send({ type: 'connected', durable: established });
    // Abandoned enrollment is short-lived, even if a client keeps answering pings.
    const enrollmentTimer = established ? undefined : setTimeout(() => socket.close(1008, 'Enrollment expired'), ttl * 1000);
    enrollmentTimer?.unref();
    socket.on('pong', () => { alive = true; });
    const heartbeat = setInterval(() => { if (!alive) return socket.terminate(); alive = false; socket.ping(); }, 30000);
    heartbeat.unref();
    // Review, approve and revoke may wait for a durable write; they run one at a
    // time per connector, in arrival order, so a second approval cannot race the
    // first. Call results never wait behind them.
    let control = Promise.resolve();
    const invalid = error => { telemetry.captureException(error, { source: 'websocket-message' }); socket.close(1008, 'Invalid protocol message'); };
    async function controlMessage(message) {
      if (socket.readyState !== WebSocket.OPEN) return;
      if (message.type === 'revoke') {
        // Acknowledged only once the revocation is durable; a failed write
        // closes the socket instead, so the connector reports a failure.
        try { await revokeBrowser(id); } catch { return socket.close(1011, 'Revocation could not be saved'); }
        return send({ type: 'revoked' });
      }
      trim(requests);
      const request = requests.get(message.id);
      if (!request || request.browserId) return send({ type: 'rejected', message: 'Approval expired or already used.' });
      if (message.type === 'review') return send({ type: 'review', id: request.id, clientName: clients.get(request.clientId)?.client.client_name || 'Unnamed client', redirectUri: request.params.redirectUri, scope });
      if (!browser.established && capacityFull(browser.installed, source)) return send({ type: 'rejected', id: message.id, message: 'Connector capacity reached. Retry later.' });
      if (identity && !browser.established) {
        identity.expiresAt = now() + 90 * 86400;
        bounded(identities, identityKey, identity);
        try { await persist(); } catch (error) { identities.delete(identityKey); throw error; }
        if (socket.readyState !== WebSocket.OPEN) return;
        browser.established = true; pendingIdentities.delete(identityKey); clearTimeout(enrollmentTimer);
        messageLimit(socket, limits.connectorMessageBytes);
        send({ type: 'connected', durable: true });
      } else if (!browser.established) {
        browser.established = true; clearTimeout(enrollmentTimer);
        messageLimit(socket, limits.connectorMessageBytes);
      }
      request.browserId = id; send({ type: 'approved' });
    }
    socket.on('message', (data, binary) => {
      if (!browser.established && (binary || data.length > limits.pendingMessageBytes)) return socket.close(1009, 'Message too large before approval');
      try {
        const message = JSON.parse(data.toString());
        if ((message.type === 'revoke' && identity) || message.type === 'review' || message.type === 'approve') {
          control = control.then(() => controlMessage(message)).catch(invalid);
        } else if (message.type === 'result') {
          const call = pending.get(message.id);
          if (!call) return;
          call.cleanup(); pending.delete(message.id);
          if (message.error) call.reject(new BrowserRejection(typeof message.error === 'string' && message.error.trim() ? message.error.slice(0, 1000) : 'Local browser rejected request.')); else call.resolve(message.result);
        } else socket.close(1008, 'Unknown protocol message');
      } catch (error) { invalid(error); }
    });
    socket.on('error', error => telemetry.captureException(error, { source: 'websocket' }));
    socket.on('close', () => {
      queue.close();
      clearTimeout(enrollmentTimer);
      if (identityKey) pendingIdentities.delete(identityKey);
      clearInterval(heartbeat); browsers.delete(id);
      if (!durable(id)) { protocolSessions.removeOwner(id); for (const [key, item] of tokens) if (item.browserId === id) tokens.delete(key); }
      for (const [key, item] of codes) if (item.browserId === id) codes.delete(key);
      for (const [key, item] of requests) if (item.browserId === id) requests.delete(key);
      for (const call of pending.values()) { call.cleanup(); call.reject(new Error('Disconnected')); }
      pending.clear();
    });
  });
  // Waits for any write in flight, then writes the final state once.
  const flush = () => store.flush().catch(() => {});
  function close() {
    draining = true;
    protocolSessions.close();
    for (const socket of ws.clients) socket.terminate();
    ws.close();
    http.closeAllConnections();
    return new Promise(resolve => http.close(resolve)).then(async () => {
      await flush();
      try { await telemetry.shutdown?.(); } catch {}
    });
  }
  // SIGTERM path: stop accepting, let in-flight HTTP finish for up to graceMs,
  // then tell connectors the relay is restarting (1012) so installed ones
  // reconnect, flush authorization state and close everything that remains.
  async function shutdown({ graceMs = 10000, socketMs = 2000 } = {}) {
    draining = true;
    http.close();
    // Kept-alive sockets become idle once their response is sent; close them then.
    http.closeIdleConnections();
    const idle = setInterval(() => http.closeIdleConnections(), 50); idle.unref();
    const wait = ms => new Promise(resolve => { const timer = setTimeout(resolve, ms); timer.unref(); });
    let drained;
    const settled = working === 0 ? Promise.resolve() : new Promise(resolve => { drained = resolve; idleWaiters.add(resolve); });
    await Promise.race([settled, wait(graceMs)]); clearInterval(idle); idleWaiters.delete(drained);
    const sockets = [...ws.clients];
    for (const socket of sockets) socket.close(1012, 'Relay restarting');
    await Promise.race([Promise.all(sockets.map(socket => socket.readyState === WebSocket.CLOSED ? undefined : new Promise(resolve => socket.once('close', resolve)))), wait(socketMs)]);
    return close();
  }
  return { http, close, shutdown };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const origin = process.env.KITSUVO_CLOUD_ORIGIN;
  if (!origin) throw new Error('KITSUVO_CLOUD_ORIGIN is required.');
  const port = Number(process.env.PORT || 8080);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid PORT.');
  const telemetry = createPostHogTelemetry();
  const relay = createRelay({ origin, stateFile: process.env.KITSUVO_CLOUD_STATE_FILE, telemetry, trustedProxyHops: Number(process.env.KITSUVO_TRUST_PROXY_HOPS || 0) });
  relay.http.listen(port, '0.0.0.0', () => console.log(JSON.stringify({ event: 'listening', port })));
  let shuttingDown = false;
  const graceMs = Number(process.env.KITSUVO_SHUTDOWN_GRACE_MS || 10000);
  const shutdown = async exitCode => {
    if (shuttingDown) return;
    shuttingDown = true;
    if (exitCode) process.exitCode = exitCode;
    console.log(JSON.stringify({ event: 'draining', graceMs }));
    try { await (exitCode ? relay.close() : relay.shutdown({ graceMs })); }
    finally { console.log(JSON.stringify({ event: 'stopped' })); process.exit(); }
  };
  process.once('SIGTERM', () => { void shutdown(); });
  process.once('SIGINT', () => { void shutdown(); });
  process.once('unhandledRejection', error => telemetry.captureException(error, { source: 'unhandled-rejection' }));
  process.once('uncaughtException', error => {
    telemetry.captureException(error, { source: 'uncaught-exception' });
    void shutdown(1);
  });
}
